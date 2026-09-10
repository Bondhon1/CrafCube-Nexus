import { useCallback, useEffect, useState } from 'react';
import type { CalibrationSample, JobAccuracy } from '@crafcube/types';
import { calibrationFactor } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { Figure } from '@/components/analytics';

/** §84 refuses to offer a correction below this many completed jobs. */
const MINIMUM_SAMPLES = 3;

export function Calibration() {
  const { activeOrg } = useSession();

  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const [jobs, setJobs] = useState<JobAccuracy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [groups, accuracy] = await Promise.all([
      supabase.from('calibration_samples').select('*')
        .eq('organization_id', activeOrg.id).order('samples', { ascending: false }),
      supabase.from('job_accuracy').select('*')
        .eq('organization_id', activeOrg.id)
        .order('finished_at', { ascending: false, nullsFirst: false }).limit(30),
    ]);
    if (groups.error) setError(groups.error.message);
    else setSamples((groups.data ?? []) as CalibrationSample[]);
    if (!accuracy.error) setJobs((accuracy.data ?? []) as JobAccuracy[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const usable = samples.filter((s) => s.samples >= MINIMUM_SAMPLES);
  const materialErrors = jobs.map((j) => j.material_error_percent);
  const timeErrors = jobs.map((j) => j.time_error_percent);
  const overallMaterial = calibrationFactor(materialErrors, MINIMUM_SAMPLES);
  const overallTime = calibrationFactor(timeErrors, MINIMUM_SAMPLES);

  return (
    <div>
      <PageHeader
        title="Calibration"
        subtitle="What estimates have historically got wrong, per printer and material (§84)."
      />

      <ErrorNote message={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Figure
          label="Filament correction"
          value={overallMaterial === null ? '—' : `× ${overallMaterial.toFixed(3)}`}
          hint={overallMaterial === null
            ? `needs ${MINIMUM_SAMPLES} completed jobs with actuals`
            : 'multiply a slicer estimate by this'}
          tone={overallMaterial === null ? 'muted' : 'neutral'}
        />
        <Figure
          label="Time correction"
          value={overallTime === null ? '—' : `× ${overallTime.toFixed(3)}`}
          hint={overallTime === null
            ? `needs ${MINIMUM_SAMPLES} completed jobs with actuals`
            : 'multiply a slicer time estimate by this'}
          tone={overallTime === null ? 'muted' : 'neutral'}
        />
        <Figure label="Groups with enough data" value={`${usable.length} / ${samples.length}`}
                tone="muted" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Per printer and material</h2>
        <Panel>
          <Table head={<><Th>Printer</Th><Th>Material</Th><Th right>Samples</Th>
            <Th right>Filament error</Th><Th right>Time error</Th>
            <Th right>Suggested factor</Th></>}>
            {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {!loading && samples.length === 0 && (
              <EmptyRow colSpan={6}>
                No completed jobs with recorded actuals yet. Calibration is built from the gap
                between what was estimated and what was measured.
              </EmptyRow>
            )}
            {samples.map((s) => {
              const enough = s.samples >= MINIMUM_SAMPLES;
              const factor = enough && s.material_error_percent !== null
                ? 1 + Number(s.material_error_percent) / 100
                : null;
              return (
                <Row key={`${s.printer_id}-${s.material_id ?? 'none'}`}>
                  <Td className="text-slate-200">{s.printer_name}</Td>
                  <Td className="text-slate-400">{s.material_name ?? 'Unspecified'}</Td>
                  <Td right>
                    {enough
                      ? <span className="text-slate-300">{s.samples}</span>
                      : <Badge tone="slate">{s.samples} — too few</Badge>}
                  </Td>
                  <Td right className="text-slate-300">
                    <Signed value={s.material_error_percent} />
                  </Td>
                  <Td right className="text-slate-300">
                    <Signed value={s.time_error_percent} />
                  </Td>
                  <Td right className="tabular text-mint">
                    {factor === null ? <span className="text-slate-600">—</span>
                      : `× ${factor.toFixed(3)}`}
                  </Td>
                </Row>
              );
            })}
          </Table>
        </Panel>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Recent jobs (§83)</h2>
        <Panel>
          <Table head={<><Th>Job</Th><Th>Printer</Th><Th right>Estimated</Th>
            <Th right>Actual</Th><Th right>Material error</Th><Th right>Time error</Th></>}>
            {jobs.length === 0 && (
              <EmptyRow colSpan={6}>No completed jobs with actuals yet.</EmptyRow>
            )}
            {jobs.map((j) => (
              <Row key={j.job_id}>
                <Td className="font-mono text-xs text-slate-400">{j.code}</Td>
                <Td className="text-slate-400">{j.printer_name ?? '—'}</Td>
                <Td right className="text-slate-500">
                  {Number(j.estimated_grams).toFixed(1)} g
                </Td>
                <Td right className="text-slate-300">
                  {j.actual_grams === null ? '—' : `${Number(j.actual_grams).toFixed(1)} g`}
                </Td>
                <Td right><Signed value={j.material_error_percent} /></Td>
                <Td right><Signed value={j.time_error_percent} /></Td>
              </Row>
            ))}
          </Table>
        </Panel>
      </section>

      <p className="mt-4 text-xs text-slate-600">
        Nothing here is applied automatically. §84 requires corrections to be configurable and
        reversible, and a factor drawn from a handful of prints would bake one unusual job into
        every future estimate — which is why groups below {MINIMUM_SAMPLES} samples suggest
        nothing at all.
      </p>
    </div>
  );
}

/** A signed percentage: over-estimates and under-estimates read differently. */
function Signed({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600">—</span>;
  const n = Number(value);
  const tone = Math.abs(n) <= 5 ? 'text-slate-400'
    : Math.abs(n) <= 15 ? 'text-amber-300' : 'text-red-400';
  return <span className={`tabular ${tone}`}>{n > 0 ? '+' : ''}{n.toFixed(1)}%</span>;
}
