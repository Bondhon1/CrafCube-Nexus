import { Badge } from '@/components/ui';

/**
 * Analysis result display (design doc §81).
 *
 * Measurement and printability only. This used to carry a "rough material
 * estimate" from geometry alone; it read like a figure without being one, so
 * filament and time now come from a real slice or not at all.
 */
export function AnalysisPanel({ analysis }: { analysis: GeometryAnalysis }) {
  const { geometry: g, bed_fit: fit } = analysis;
  const d = g.dimensions;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <p className="label mb-0">Geometry analysis</p>
        <Badge tone={g.is_watertight ? 'mint' : 'amber'}>
          {g.is_watertight ? 'Mesh valid' : 'Mesh not watertight'}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Metric label="Dimensions" value={`${d.width_mm} × ${d.depth_mm} × ${d.height_mm}`} unit="mm" />
        <Metric label="Volume" value={g.volume_cm3.toLocaleString()} unit="cm³" />
        <Metric label="Triangles" value={g.triangle_count.toLocaleString()} />
        <Metric label="Overhang" value={`${(g.overhang_area_ratio * 100).toFixed(0)}`} unit="%" />
      </div>

      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          fit.fits
            ? 'border-mint/25 bg-mint/5 text-slate-300'
            : fit.fits_after_rotation
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
              : 'border-red-500/30 bg-red-500/5 text-red-300'
        }`}
      >
        {fit.message}
      </div>

      <p className="text-xs text-slate-500">
        Weight and print time are measured by slicing, on the job that will print it.
      </p>

      {(g.warnings.length > 0 || g.notes.length > 0) && (
        <ul className="space-y-1.5 text-sm">
          {g.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-amber-200">
              <span aria-hidden="true">⚠</span>
              <span>{w}</span>
            </li>
          ))}
          {g.notes.map((n) => (
            <li key={n} className="flex gap-2 text-slate-500">
              <span aria-hidden="true" className="text-mint">✓</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">
        {value}
        {unit && <span className="ml-1 text-xs text-slate-500">{unit}</span>}
      </p>
    </div>
  );
}

export function EngineNotice({ status }: { status: EngineStatus | null }) {
  if (!status || status.state === 'ready') return null;

  if (status.state === 'starting') {
    return <p className="text-xs text-slate-500">Starting the local analysis engine…</p>;
  }

  return (
    <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3 text-xs text-slate-500">
      <span className="text-slate-400">Local analysis engine unavailable.</span>{' '}
      Uploads still work; dimensions and volume will be filled in once it runs.
      {status.error && <span className="mt-1 block font-mono text-[11px]">{status.error}</span>}
    </div>
  );
}
