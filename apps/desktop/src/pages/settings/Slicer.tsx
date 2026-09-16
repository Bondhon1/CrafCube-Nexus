import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Panel, Badge, ErrorNote } from '@/components/ui';
import { Figure, NotEnoughData } from '@/components/analytics';

/**
 * §41-§42: what the local engine found on this machine.
 *
 * Read-only on purpose. Slicer discovery walks the known install locations and
 * the bundled `tools/orca` directory; letting someone type a path here would
 * produce a setting that silently disagrees with what actually runs.
 */
export function Slicer() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = window.nexus?.engine;
    if (!bridge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setStatus(await bridge.status());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function start() {
    const bridge = window.nexus?.engine;
    if (!bridge) return;
    setStarting(true);
    setError(null);
    try {
      await bridge.start();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStarting(false);
  }

  if (!window.nexus) {
    return (
      <div>
        <PageHeader title="Slicer" />
        <NotEnoughData>
          The local engine only exists in the desktop app.
        </NotEnoughData>
      </div>
    );
  }

  const slicers = status?.capabilities?.slicers ?? [];
  const canSlice = status?.capabilities?.slicing ?? false;

  return (
    <div>
      <PageHeader
        title="Slicer"
        subtitle="The local analysis engine and the slicers it can drive (§37, §41)."
        actions={(
          <>
            <button onClick={() => void refresh()} className="btn-ghost">Refresh</button>
            {status?.state !== 'ready' && (
              <button onClick={() => void start()} disabled={starting} className="btn-primary">
                {starting ? 'Starting…' : 'Start engine'}
              </button>
            )}
          </>
        )}
      />

      <ErrorNote message={error ?? status?.error ?? null} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Figure
          label="Engine"
          value={loading ? '…' : status?.state ?? 'unknown'}
          hint={status?.baseUrl}
          tone={status?.state === 'ready' ? 'good'
            : status?.state === 'unavailable' ? 'bad' : 'muted'}
        />
        <Figure
          label="Slicing"
          value={canSlice ? 'Available' : 'Unavailable'}
          hint={canSlice
            ? 'weight and time measured from real G-code'
            : 'without it, jobs have no weight or time at all'}
          tone={canSlice ? 'good' : 'warn'}
        />
        <Figure label="Slicers found" value={String(slicers.length)} tone="muted" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Detected slicers</h2>
        {slicers.length === 0 ? (
          <NotEnoughData>
            No slicer found. Install OrcaSlicer or Anycubic Slicer Next, or drop a portable
            OrcaSlicer into <code className="font-mono text-mint">tools/orca</code> next to the
            project — the engine looks there too.
          </NotEnoughData>
        ) : (
          <div className="space-y-2">
            {slicers.map((s) => (
              <div key={s.executable} className="card flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">{s.name}</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">
                    {s.executable}
                  </p>
                </div>
                <Badge tone="mint">Ready</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Analysis levels (§4)</h2>
        <Panel>
          <div className="divide-y divide-line/60">
            {Object.entries(status?.capabilities?.analysis_levels ?? {}).map(([level, note]) => (
              <div key={level} className="flex items-baseline gap-4 px-4 py-3">
                <span className="w-6 shrink-0 font-mono text-sm text-mint">{level}</span>
                <span className="text-sm text-slate-400">{note}</span>
              </div>
            ))}
            {!status?.capabilities && (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Start the engine to see what it can do.
              </p>
            )}
          </div>
        </Panel>
      </section>

      <p className="mt-4 text-xs text-slate-600">
        Paths are discovered, not configured. A stale path typed into a settings screen is how a
        fixed install ends up looking broken — and how a running engine from a previous session
        ends up answering for a version you no longer have.
      </p>
    </div>
  );
}
