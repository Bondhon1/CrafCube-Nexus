import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { Badge, EmptyRow, ErrorNote, Field, Modal, PageHeader, Panel, Row, Table, Td, Th } from '@/components/ui';

interface IntegrationKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * Keys that let another app — Flexi Name Studio — record builds here.
 *
 * A key can do exactly one thing: add custom builds. It cannot read anything,
 * so it is safe on a hosted studio in a way a user password or the service
 * key never would be. Only its hash is stored; the key is shown once.
 */
export function Integrations() {
  const { activeOrg, can } = useSession();
  const admin = can('users.manage');

  const [keys, setKeys] = useState<IntegrationKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase.from('integration_keys')
      .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
      .eq('organization_id', activeOrg.id).order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setKeys((data ?? []) as IntegrationKey[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function revoke(key: IntegrationKey) {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;
    const { error: err } = await supabase.rpc('revoke_integration_key', { p_id: key.id });
    if (err) setError(err.message);
    await load();
  }

  if (!admin) {
    return (
      <div>
        <PageHeader title="Integrations" />
        <Panel><p className="px-4 py-10 text-center text-sm text-slate-500">Only an admin can manage integration keys.</p></Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Let Flexi Name Studio send its builds here. Each key can only add custom builds, and can be revoked at any time."
        actions={<button onClick={() => setCreating(true)} className="btn-primary">New key</button>}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table head={<><Th>Name</Th><Th>Key</Th><Th>Created</Th><Th>Last used</Th><Th>Status</Th><Th /></>}>
          {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
          {!loading && keys.length === 0 && <EmptyRow colSpan={6}>No keys yet.</EmptyRow>}
          {keys.map((k) => (
            <Row key={k.id}>
              <Td className="text-slate-200">{k.name}</Td>
              <Td className="font-mono text-xs text-slate-500">{k.key_prefix}…</Td>
              <Td className="text-slate-500">{new Date(k.created_at).toLocaleDateString()}</Td>
              <Td className="text-slate-500">
                {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}
              </Td>
              <Td>
                {k.revoked_at ? <Badge>Revoked</Badge> : <Badge tone="mint">Active</Badge>}
              </Td>
              <Td right>
                {!k.revoked_at && (
                  <button onClick={() => void revoke(k)} className="text-xs text-red-400 hover:text-red-300">
                    Revoke
                  </button>
                )}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {creating && (
        <CreateKeyModal onClose={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

function CreateKeyModal({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useSession();
  const [name, setName] = useState('Flexi Name Studio');
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('create_integration_key', {
      p_org: activeOrg.id, p_name: name.trim(),
    });
    if (err) setError(err.message);
    else setKey(data as string);
    setBusy(false);
  }

  // What the studio needs. The URL and anon key are public by design — they
  // already ship inside this app — and can do nothing without the key.
  const env = key ? [
    `NEXUS_SUPABASE_URL=${import.meta.env.VITE_SUPABASE_URL ?? ''}`,
    `NEXUS_SUPABASE_ANON_KEY=${import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''}`,
    `NEXUS_INGEST_KEY=${key}`,
  ].join('\n') : '';

  return (
    <Modal title={key ? 'Key created' : 'New integration key'} onClose={onClose} width="w-[min(620px,92vw)]">
      {!key ? (
        <form onSubmit={create} className="space-y-4">
          <ErrorNote message={error} />
          <Field label="Name" hint="So you can tell keys apart later.">
            <input required className="field" value={name} maxLength={80}
                   onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            This is the only time the key is shown. Only its hash is kept, so it cannot be
            recovered — if it is lost, revoke it and make another.
          </p>
          <p className="text-sm text-slate-400">
            Set these on the machine or host running Flexi Name Studio, then restart it. Every
            build it makes will appear under Models → Custom builds.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-xs text-slate-300">
            {env}
          </pre>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => {
              void navigator.clipboard.writeText(env).then(() => setCopied(true));
            }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={onClose} className="btn-primary">Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
