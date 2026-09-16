import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Panel, Badge, ErrorNote } from '@/components/ui';
import { Figure, NotEnoughData } from '@/components/analytics';
import { downloadPercent, useSlicerSetup } from '@/lib/slicerSetup';

const SOURCE_LABEL: Record<string, string> = {
  installed: 'Installed',
  configured: 'Configured',
  downloaded: 'Downloaded by the app',
  bundled: 'Development copy',
};

/** Where the one slicer the app actually uses came from, and the download if any. */
function SetupCard({ setup, onRetry }: { setup: SlicerSetup | null; onRetry: () => void }) {
  if (!setup) return null;
  const percent = downloadPercent(setup);
  const busy = setup.phase === 'checking' || setup.phase === 'downloading'
    || setup.phase === 'verifying' || setup.phase === 'extracting';

  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(0);

  return (
    <div className="card mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100">
            {setup.phase === 'installed' && `Using your ${setup.name}`}
            {setup.phase === 'ready' && `Using ${setup.name}`}
            {setup.phase === 'checking' && 'Looking for a slicer on this computer…'}
            {setup.phase === 'downloading' && 'Downloading OrcaSlicer'}
            {setup.phase === 'verifying' && 'Verifying the download'}
            {setup.phase === 'extracting' && 'Unpacking OrcaSlicer'}
            {setup.phase === 'failed' && 'Slicer setup did not finish'}
            {setup.phase === 'unsupported' && 'Install a slicer to enable costing'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {setup.phase === 'installed'
              && 'Found on this computer, so nothing was downloaded.'}
            {setup.phase === 'ready'
              && 'Every weight and print time in the app is measured by this slicer.'}
            {setup.phase === 'checking'
              && 'An OrcaSlicer or Anycubic Slicer Next you already have is always used first.'}
            {setup.phase === 'downloading'
              && `${mb(setup.received)} of ${mb(setup.total)} MB. The app stays usable while this `
               + 'runs; if it is interrupted it resumes where it stopped.'}
            {setup.phase === 'verifying'
              && 'Checking the file against its published checksum before anything runs.'}
            {setup.phase === 'extracting' && 'Almost done.'}
            {setup.phase === 'failed' && setup.error}
            {setup.phase === 'unsupported' && setup.reason}
          </p>
        </div>
        {setup.phase === 'installed' && <Badge tone="mint">Your slicer</Badge>}
        {setup.phase === 'ready' && <Badge tone="mint">Ready</Badge>}
        {setup.phase === 'failed' && (
          <button onClick={onRetry} className="btn-primary shrink-0">Retry</button>
        )}
      </div>

      {busy && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full bg-mint transition-[width] duration-300 ${
              percent === null ? 'w-1/3 animate-pulse' : ''}`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * §41-§42: what the local engine found on this machine.
 *
 * Read-only on purpose. Discovery reads the registry, PATH and the usual
 * folders, then the app's own download; letting someone type a path here would
 * produce a setting that silently disagrees with what actually runs.
 */
export function Slicer() {
  const setup = useSlicerSetup();
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
  useEffect(() => {
    if (setup?.phase === 'ready' || setup?.phase === 'installed') void refresh();
  }, [setup?.phase, refresh]);

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

      <SetupCard setup={setup} onRetry={() => void window.nexus?.slicer.retry()} />

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
            None yet. If you install OrcaSlicer or Anycubic Slicer Next it will be found and
            used instead of downloading one.
          </NotEnoughData>
        ) : (
          <div className="space-y-2">
            {slicers.map((s, index) => (
              <div key={s.executable} className="card flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">{s.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {SOURCE_LABEL[s.source] ?? s.source}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-600">
                    {s.executable}
                  </p>
                </div>
                {/* Only the first is used; the rest are fallbacks. */}
                <Badge tone={index === 0 ? 'mint' : 'slate'}>
                  {index === 0 ? 'In use' : 'Fallback'}
                </Badge>
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
