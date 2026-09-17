import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomBuild, CustomBuildStatus, CustomDesign, StoredSlice } from '@crafcube/types';
import {
  CUSTOM_BUILD_SOURCE_LABELS, formatDuration, isProductCode, normalizeProductCode, wastePercent,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Grams, Modal, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { NewJobModal } from '@/pages/production/NewJobModal';

const STATUS_TONE: Record<CustomBuildStatus, 'mint' | 'amber' | 'slate'> = {
  new: 'amber',
  queued: 'mint',
  printed: 'slate',
  archived: 'slate',
};

const STATUS_LABEL: Record<CustomBuildStatus, string> = {
  new: 'New',
  queued: 'Queued',
  printed: 'Printed',
  archived: 'Archived',
};

/**
 * One-off designs, each sold under one product code, with every customer's
 * styled build grouped under its design. Builds are kept as a description and
 * a slice, never as a model file.
 *
 * Builds from Flexi Name Studio arrive here on their own; the first build of
 * a design the studio has not sent before creates that design with the next
 * free code, which can be changed here.
 */
export function CustomBuilds() {
  const { activeOrg, can } = useSession();
  const editable = can('sales.write') || can('production.write');

  const [designs, setDesigns] = useState<CustomDesign[]>([]);
  const [builds, setBuilds] = useState<CustomBuild[]>([]);
  const [slices, setSlices] = useState<StoredSlice[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomDesign | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    let designQuery = supabase.from('custom_designs').select('*')
      .eq('organization_id', activeOrg.id).order('product_code');
    let buildQuery = supabase.from('custom_builds').select('*')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false }).limit(500);
    if (!showArchived) {
      designQuery = designQuery.eq('archived', false);
      buildQuery = buildQuery.neq('status', 'archived');
    }
    const [d, b] = await Promise.all([designQuery, buildQuery]);
    if (d.error || b.error) {
      setError((d.error ?? b.error)!.message);
      setLoading(false);
      return;
    }

    const rows = (b.data ?? []) as CustomBuild[];
    setDesigns((d.data ?? []) as CustomDesign[]);
    setBuilds(rows);
    const hashes = [...new Set(rows.map((r) => r.file_sha256).filter(Boolean))] as string[];
    if (hashes.length > 0) {
      const { data: stored } = await supabase.from('slice_results').select('*')
        .eq('organization_id', activeOrg.id).in('file_sha256', hashes)
        .order('sliced_at', { ascending: false });
      setSlices((stored ?? []) as StoredSlice[]);
    } else {
      setSlices([]);
    }
    setLoading(false);
  }, [activeOrg, showArchived]);

  useEffect(() => { void load(); }, [load]);

  /** The most recent slice of each file, whichever printer it was for. */
  const latestSlice = useMemo(() => {
    const out = new Map<string, StoredSlice>();
    for (const s of slices) if (!out.has(s.file_sha256)) out.set(s.file_sha256, s);
    return out;
  }, [slices]);

  const buildsByDesign = useMemo(() => {
    const out = new Map<string, CustomBuild[]>();
    for (const b of builds) out.set(b.design_id, [...(out.get(b.design_id) ?? []), b]);
    return out;
  }, [builds]);

  async function archiveBuild(build: CustomBuild) {
    setError(null);
    const { error: err } = await supabase.from('custom_builds')
      .update({ status: build.status === 'archived' ? 'new' : 'archived' }).eq('id', build.id);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Custom builds"
        subtitle="One-off designs, each under one product code. Customer builds are kept as a description and a slice; their model files are never stored."
        actions={(
          <>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            {editable && (
              <button onClick={() => setEditing('new')} className="btn-primary">New design</button>
            )}
          </>
        )}
      />

      <ErrorNote message={error} />

      {loading && <Panel><p className="px-4 py-10 text-center text-sm text-slate-500">Loading…</p></Panel>}
      {!loading && designs.length === 0 && (
        <Panel>
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            No designs yet. Add one here, or build something in Flexi Name Studio - its design
            is created on the first build.
          </p>
        </Panel>
      )}

      <div className="space-y-4">
        {designs.map((design) => {
          const rows = buildsByDesign.get(design.id) ?? [];
          return (
            <Panel key={design.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="rounded border border-mint/30 bg-mint/10 px-2 py-0.5 font-mono text-xs text-mint">
                    {design.product_code}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {design.name}
                      {design.archived && <span className="ml-2 text-xs font-normal text-slate-600">archived</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {CUSTOM_BUILD_SOURCE_LABELS[design.source]} · {rows.length} build{rows.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {editable && (
                  <button onClick={() => setEditing(design)} className="text-xs text-slate-400 hover:text-slate-200">
                    Edit
                  </button>
                )}
              </div>
              <Table head={<><Th>Build</Th><Th>Colours</Th><Th right>Filament</Th>
                <Th right>Waste</Th><Th right>Time</Th><Th>Status</Th><Th /></>}>
                {rows.length === 0 && <EmptyRow colSpan={7}>No builds of this design yet.</EmptyRow>}
                {rows.map((b) => {
                  const s = b.file_sha256 ? latestSlice.get(b.file_sha256) : undefined;
                  const share = s ? wastePercent(s) : null;
                  const text = typeof b.params?.text === 'string' ? b.params.text : null;
                  return (
                    <Row key={b.id}>
                      <Td>
                        <p className="font-medium text-slate-200">{b.title}</p>
                        <p className="text-xs text-slate-600">
                          {text && text !== b.title ? `“${text}” · ` : ''}
                          {new Date(b.created_at).toLocaleDateString()}
                        </p>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          {b.colours.map((c, i) => (
                            <span key={i} className="h-3.5 w-3.5 rounded-full border border-white/20"
                                  style={{ background: c.hex }} title={c.name ?? c.hex} />
                          ))}
                        </div>
                      </Td>
                      <Td right className="text-slate-300">
                        {s ? <Grams value={s.total_grams} /> : <span className="text-slate-600">not sliced</span>}
                      </Td>
                      <Td right>
                        {s && share !== null && share > 0
                          ? <span className="text-amber-300">{share}%</span>
                          : <span className="text-slate-600">—</span>}
                      </Td>
                      <Td right className="text-slate-400">{s ? formatDuration(s.print_seconds) : '—'}</Td>
                      <Td><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge></Td>
                      <Td right>
                        {editable && (
                          <div className="flex justify-end gap-3 whitespace-nowrap text-xs">
                            {b.status !== 'archived' && (
                              <button onClick={() => setQueueing(b.id)} className="text-mint hover:text-mint-500">
                                Queue job
                              </button>
                            )}
                            <button onClick={() => void archiveBuild(b)} className="text-slate-500 hover:text-slate-300">
                              {b.status === 'archived' ? 'Restore' : 'Archive'}
                            </button>
                          </div>
                        )}
                      </Td>
                    </Row>
                  );
                })}
              </Table>
            </Panel>
          );
        })}
      </div>

      {queueing && (
        <NewJobModal
          initialBuildId={queueing}
          onClose={() => setQueueing(null)}
          onSaved={() => { setQueueing(null); void load(); }}
        />
      )}
      {editing && (
        <DesignModal
          design={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

/** Create a design, or change one's name, code or archived state. */
export function DesignModal({
  design, onClose, onSaved,
}: {
  design: CustomDesign | null;
  onClose: () => void;
  onSaved: (design: CustomDesign) => void;
}) {
  const { activeOrg } = useSession();
  const [code, setCode] = useState(design?.product_code ?? '');
  const [name, setName] = useState(design?.name ?? '');
  const [description, setDescription] = useState(design?.description ?? '');
  const [archived, setArchived] = useState(design?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (design || !activeOrg) return;
    void supabase.rpc('next_product_code', { p_org: activeOrg.id })
      .then(({ data }) => { if (typeof data === 'string') setCode((c) => c || data); });
  }, [design, activeOrg]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    if (code.trim() && !isProductCode(code)) {
      setError('A product code is 1-4 letters then 3-6 digits, like C0001.');
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      product_code: normalizeProductCode(code),
      name: name.trim(),
      description: description.trim() || null,
      archived,
    };
    const { data, error: err } = design
      ? await supabase.from('custom_designs').update(fields).eq('id', design.id).select().single()
      : await supabase.from('custom_designs')
        .insert({ ...fields, organization_id: activeOrg.id, source: 'manual' }).select().single();
    setBusy(false);
    if (err) setError(err.message);
    else onSaved(data as CustomDesign);
  }

  return (
    <Modal title={design ? `Edit ${design.product_code}` : 'New design'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
          <Field label="Product code">
            <input className="field font-mono uppercase" value={code} placeholder="C0001"
                   onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name">
            <input required autoFocus className="field" value={name} maxLength={160}
                   placeholder="Flexi name keychain" onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="field h-16 resize-none" value={description}
                    onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {design && (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived - hidden from new orders and jobs
          </label>
        )}
        {design?.source === 'flexi-name-studio' && (
          <p className="text-xs text-slate-500">
            The studio finds this design by its own name for it, so changing the code or name
            here does not break the link.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
            {busy ? 'Saving…' : design ? 'Save' : 'Create design'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
