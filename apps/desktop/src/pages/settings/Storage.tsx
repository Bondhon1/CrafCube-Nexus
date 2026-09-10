import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatBytes, objectStore } from '@/lib/storage';
import { useSession } from '@/app/SessionProvider';
import {
  EmptyRow, ErrorNote, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { Figure } from '@/components/analytics';

interface FileRow {
  id: string;
  kind: string;
  filename: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  created_at: string;
}

export function Storage() {
  const { activeOrg } = useSession();

  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('model_files')
      .select('id, kind, filename, byte_size, sha256, storage_key, created_at')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    else setFiles((data ?? []) as FileRow[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const totalBytes = files.reduce((sum, f) => sum + Number(f.byte_size), 0);
  // §78: the same bytes uploaded twice share one object, so distinct hashes are
  // what is actually stored.
  const distinct = new Set(files.map((f) => f.sha256)).size;
  const duplicates = files.length - distinct;

  async function checkAccess() {
    if (files.length === 0) return;
    setProbing(true);
    setProbe(null);
    setError(null);
    try {
      const url = await objectStore.signedUrl(files[0].storage_key, 60);
      setProbe(`Signed a 60-second URL for ${files[0].filename} — the backend is reachable.`);
      // The URL itself is deliberately not shown: §77 treats these as
      // short-lived credentials, not something to copy out of a settings page.
      void url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setProbing(false);
  }

  return (
    <div>
      <PageHeader
        title="Storage"
        subtitle="Where model files live, and how much of it you are using (§44, §77)."
        actions={(
          <button onClick={() => void checkAccess()} disabled={probing || files.length === 0}
                  className="btn-ghost">
            {probing ? 'Checking…' : 'Check access'}
          </button>
        )}
      />

      <ErrorNote message={error} />
      {probe && (
        <p className="mb-4 rounded-md border border-mint/30 bg-mint/10 px-3 py-2 text-sm text-mint">
          {probe}
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Backend" value={objectStore.name}
                hint={`up to ${formatBytes(objectStore.maxFileBytes)} per file`} />
        <Figure label="Files" value={String(files.length)} tone="muted" />
        <Figure label="Stored" value={formatBytes(totalBytes)} />
        <Figure label="Deduplicated" value={String(duplicates)}
                hint={duplicates === 0
                  ? 'no repeated uploads yet'
                  : 'identical bytes reusing one object'}
                tone="muted" />
      </div>

      <Panel>
        <Table head={<><Th>File</Th><Th>Kind</Th><Th right>Size</Th><Th>Hash</Th>
          <Th right>Uploaded</Th></>}>
          {loading && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
          {!loading && files.length === 0 && (
            <EmptyRow colSpan={5}>Nothing uploaded yet.</EmptyRow>
          )}
          {files.map((f) => (
            <Row key={f.id}>
              <Td className="text-slate-200">{f.filename}</Td>
              <Td className="text-slate-500">{f.kind}</Td>
              <Td right className="text-slate-400">{formatBytes(Number(f.byte_size))}</Td>
              <Td className="font-mono text-[11px] text-slate-600">
                {f.sha256.slice(0, 12)}…
              </Td>
              <Td right className="whitespace-nowrap text-slate-500">
                {new Date(f.created_at).toLocaleDateString()}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      <p className="mt-4 text-xs text-slate-600">
        Objects are private and reached only through short-lived signed URLs (§77). The backend
        is chosen by <code className="font-mono text-mint">VITE_STORAGE_BACKEND</code> at build
        time rather than here — the Backblaze key lives in a Supabase Edge Function secret and
        must never reach the desktop bundle, because Vite inlines every{' '}
        <code className="font-mono text-mint">VITE_*</code> variable into the shipped app.
      </p>
    </div>
  );
}
