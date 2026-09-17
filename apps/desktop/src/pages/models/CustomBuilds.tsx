import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomBuild, CustomBuildStatus, StoredSlice } from '@crafcube/types';
import { CUSTOM_BUILD_SOURCE_LABELS, formatDuration, wastePercent } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { Badge, EmptyRow, ErrorNote, Grams, PageHeader, Panel, Row, Table, Td, Th } from '@/components/ui';
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
 * One-off designs — a name keychain for one customer — kept as a description
 * and a slice, never as a model file.
 *
 * Builds from Flexi Name Studio arrive here on their own. The first time one
 * is queued its file is dropped in once to slice; after that its numbers are
 * stored and the file is no longer needed.
 */
export function CustomBuilds() {
  const { activeOrg, can } = useSession();
  const editable = can('sales.write') || can('production.write');

  const [builds, setBuilds] = useState<CustomBuild[]>([]);
  const [slices, setSlices] = useState<StoredSlice[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    let query = supabase.from('custom_builds').select('*')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false }).limit(200);
    if (!showArchived) query = query.neq('status', 'archived');
    const { data, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }

    const rows = (data ?? []) as CustomBuild[];
    setBuilds(rows);
    const hashes = [...new Set(rows.map((b) => b.file_sha256).filter(Boolean))] as string[];
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

  async function archive(build: CustomBuild) {
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
        subtitle="One-off designs kept as a description and a slice. Their model files are never stored."
        actions={(
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table head={<><Th>Build</Th><Th>From</Th><Th>Colours</Th><Th right>Filament</Th>
          <Th right>Waste</Th><Th right>Time</Th><Th>Status</Th><Th /></>}>
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && builds.length === 0 && (
            <EmptyRow colSpan={8}>
              Nothing yet. Builds sent from Flexi Name Studio appear here, and so does anything
              queued from the job form as a custom one-off.
            </EmptyRow>
          )}
          {builds.map((b) => {
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
                <Td className="text-xs text-slate-400">{CUSTOM_BUILD_SOURCE_LABELS[b.source]}</Td>
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
                      <button onClick={() => void archive(b)} className="text-slate-500 hover:text-slate-300">
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

      {queueing && (
        <NewJobModal
          initialBuildId={queueing}
          onClose={() => setQueueing(null)}
          onSaved={() => { setQueueing(null); void load(); }}
        />
      )}
    </div>
  );
}
