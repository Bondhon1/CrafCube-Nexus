import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FilamentSpool, JobAccuracy, Model, PrintJob, PrintJobStatus, Printer,
} from '@crafcube/types';
import {
  JOB_STATUS_LABELS, NEXT_STATUSES, calibrationFactor, formatDuration, isTerminal,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Grams, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface JobRow extends PrintJob {
  printer: Pick<Printer, 'id' | 'name'> | null;
  spool: Pick<FilamentSpool, 'id' | 'code'> | null;
}

const STATUS_TONE: Record<PrintJobStatus, 'mint' | 'amber' | 'red' | 'slate'> = {
  QUEUED: 'slate',
  SCHEDULED: 'slate',
  PREPARING: 'amber',
  PRINTING: 'mint',
  PAUSED: 'amber',
  COMPLETED: 'mint',
  FAILED: 'red',
  CANCELLED: 'slate',
};

/** Which statuses each Production screen shows. */
export const JOB_VIEWS = {
  queue: ['QUEUED', 'SCHEDULED', 'PREPARING'] as PrintJobStatus[],
  active: ['PRINTING', 'PAUSED'] as PrintJobStatus[],
  completed: ['COMPLETED'] as PrintJobStatus[],
  failed: ['FAILED', 'CANCELLED'] as PrintJobStatus[],
};

export function Jobs({
  view,
  title,
  subtitle,
}: {
  view: keyof typeof JOB_VIEWS;
  title: string;
  subtitle: string;
}) {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const canRun = can('production.write');

  const [rows, setRows] = useState<JobRow[]>([]);
  const [accuracy, setAccuracy] = useState<JobAccuracy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState<JobRow | null>(null);

  const statuses = JOB_VIEWS[view];

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [jobs, acc] = await Promise.all([
      supabase
        .from('print_jobs')
        .select('*, printer:printers(id, name), spool:filament_spools(id, code)')
        .eq('organization_id', activeOrg.id)
        .in('status', statuses)
        .order('queued_at', { ascending: view === 'queue' }),
      view === 'completed'
        ? supabase.from('job_accuracy').select('*').eq('organization_id', activeOrg.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (jobs.error) setError(jobs.error.message);
    else setRows((jobs.data ?? []) as unknown as JobRow[]);
    if (!acc.error) setAccuracy((acc.data ?? []) as JobAccuracy[]);
    setLoading(false);
  }, [activeOrg, statuses, view]);

  useEffect(() => { void load(); }, [load]);

  async function move(job: JobRow, status: PrintJobStatus) {
    // COMPLETED and FAILED move stock, so they collect actuals first.
    if (status === 'COMPLETED' || status === 'FAILED') {
      setFinishing({ ...job, status });
      return;
    }
    setError(null);
    const { error: err } = await supabase.rpc('set_job_status', {
      p_job: job.id,
      p_status: status,
    });
    if (err) setError(err.message);
    await load();
  }

  const calibration = useMemo(() => {
    if (view !== 'completed') return null;
    return {
      material: calibrationFactor(accuracy.map((a) => a.material_error_percent)),
      time: calibrationFactor(accuracy.map((a) => a.time_error_percent)),
      samples: accuracy.length,
    };
  }, [accuracy, view]);

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={canRun && view === 'queue' && (
          <button onClick={() => setCreating(true)} className="btn-primary">New job</button>
        )}
      />

      <ErrorNote message={error} />

      {calibration && calibration.samples > 0 && (
        <div className="card mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Estimate accuracy</h2>
              <p className="mt-1 text-xs text-slate-500">
                Across {calibration.samples} completed job{calibration.samples === 1 ? '' : 's'}.
              </p>
            </div>
            <div className="flex gap-8">
              <Calib label="Material" factor={calibration.material} />
              <Calib label="Time" factor={calibration.time} />
            </div>
          </div>
        </div>
      )}

      <Panel>
        <Table
          head={
            <>
              <Th>Job</Th>
              <Th>Printer</Th>
              <Th right>Qty</Th>
              <Th right>Material</Th>
              <Th right>Time</Th>
              {view === 'completed' && <Th right>Accuracy</Th>}
              <Th>Status</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              {view === 'queue'
                ? 'Nothing queued. Create a job to reserve material and start printing.'
                : `No ${title.toLowerCase()}.`}
            </EmptyRow>
          )}
          {rows.map((job) => {
            const acc = accuracy.find((a) => a.job_id === job.id);
            const next = NEXT_STATUSES[job.status];
            return (
              <Row key={job.id}>
                <Td>
                  <div className="whitespace-nowrap font-mono text-xs text-slate-300">
                    {job.code}
                  </div>
                  {job.spool && (
                    <div className="whitespace-nowrap text-xs text-slate-600">
                      spool {job.spool.code}
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-slate-400">{job.printer?.name ?? '—'}</Td>
                <Td right>
                  {job.quantity}
                  {job.failed_quantity > 0 && (
                    <span className="ml-1 text-red-400">−{job.failed_quantity}</span>
                  )}
                </Td>
                <Td right>
                  <Grams value={job.actual_grams ?? job.estimated_grams} />
                  {job.actual_grams !== null && (
                    <div className="text-[11px] text-slate-600">
                      est <Grams value={job.estimated_grams} />
                    </div>
                  )}
                </Td>
                <Td right className="whitespace-nowrap text-slate-400">
                  {formatDuration(job.actual_seconds ?? job.estimated_seconds)}
                </Td>
                {view === 'completed' && (
                  <Td right>
                    {acc?.material_error_percent != null ? (
                      <ErrorChip value={Number(acc.material_error_percent)} />
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </Td>
                )}
                <Td>
                  <Badge tone={STATUS_TONE[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
                  {job.failure_reason && (
                    <div className="mt-1 max-w-[180px] truncate text-[11px] text-slate-500"
                         title={job.failure_reason}>
                      {job.failure_reason}
                    </div>
                  )}
                </Td>
                <Td right>
                  {canRun && !isTerminal(job.status) && next.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void move(job, e.target.value as PrintJobStatus);
                      }}
                      className="rounded-md border border-line bg-ink-950 px-2 py-1 text-xs"
                      aria-label={`Advance ${job.code}`}
                    >
                      <option value="">Move to…</option>
                      {next.map((s) => (
                        <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                  {job.status === 'COMPLETED' && job.estimated_cost > 0 && (
                    <span className="tabular text-xs text-slate-500">
                      <Money value={job.estimated_cost} currency={currency} />
                    </span>
                  )}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <NewJobModal onClose={() => setCreating(false)}
                     onSaved={() => { setCreating(false); void load(); }} />
      )}
      {finishing && (
        <FinishModal job={finishing} onClose={() => setFinishing(null)}
                     onSaved={() => { setFinishing(null); void load(); }} />
      )}
    </div>
  );
}

function Calib({ label, factor }: { label: string; factor: number | null }) {
  return (
    <div className="text-right">
      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      {factor === null ? (
        // §84 is about learning from history; three jobs is the floor at which
        // a correction factor stops being noise.
        <p className="mt-1 text-xs text-slate-600">Needs 3+ jobs</p>
      ) : (
        <p className={`tabular mt-1 text-lg font-medium ${
          Math.abs(factor - 1) < 0.02 ? 'text-mint' : 'text-amber-300'
        }`}>
          ×{factor.toFixed(3)}
        </p>
      )}
    </div>
  );
}

function ErrorChip({ value }: { value: number }) {
  const tone = Math.abs(value) <= 5 ? 'mint' : Math.abs(value) <= 15 ? 'amber' : 'red';
  return <Badge tone={tone}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</Badge>;
}

function NewJobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [models, setModels] = useState<Model[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<(FilamentSpool & { product: { name: string } | null })[]>([]);

  const [modelId, setModelId] = useState('');
  const [printerId, setPrinterId] = useState('');
  const [spoolId, setSpoolId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [grams, setGrams] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    void (async () => {
      const [m, p, s] = await Promise.all([
        supabase.from('models').select('*').eq('organization_id', activeOrg.id)
          .eq('archived', false).order('name'),
        supabase.from('printers').select('*').eq('organization_id', activeOrg.id)
          .neq('status', 'retired').order('name'),
        supabase.from('filament_spools')
          .select('*, product:filament_products(name)')
          .eq('organization_id', activeOrg.id).in('status', ['sealed', 'in_use'])
          .order('code'),
      ]);
      setModels((m.data ?? []) as Model[]);
      setPrinters((p.data ?? []) as Printer[]);
      setSpools((s.data ?? []) as never);
      setPrinterId((c) => c || (p.data?.[0] as Printer | undefined)?.id || '');
    })();
  }, [activeOrg]);

  const spool = spools.find((s) => s.id === spoolId);
  const totalGrams = (Number(grams) || 0) * (Number(quantity) || 1);
  const shortfall = spool ? totalGrams - Number(spool.remaining_grams) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { data: code, error: codeErr } = await supabase.rpc('next_job_code', {
      p_org: activeOrg.id,
    });
    if (codeErr) { setError(codeErr.message); setBusy(false); return; }

    const { error: err } = await supabase.from('print_jobs').insert({
      organization_id: activeOrg.id,
      code,
      model_version_id: null,
      printer_id: printerId || null,
      spool_id: spoolId || null,
      quantity: Number(quantity) || 1,
      estimated_grams: totalGrams,
      estimated_seconds: Math.round((Number(hours) || 0) * 3600) * (Number(quantity) || 1),
      notes: modelId ? models.find((m) => m.id === modelId)?.name ?? null : null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New print job" onClose={onClose} width="w-[520px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <Field label="Model">
          <select className="field" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Not from the library</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Printer">
            <select className="field" value={printerId}
                    onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">Unassigned</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Spool" hint="Material is reserved from this spool.">
            <select className="field" value={spoolId} onChange={(e) => setSpoolId(e.target.value)}>
              <option value="">None</option>
              {spools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {Math.round(Number(s.remaining_grams))} g
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Quantity">
            <input required type="number" min="1" className="field" value={quantity}
                   onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Grams each">
            <input required type="number" step="0.1" min="0" className="field" value={grams}
                   onChange={(e) => setGrams(e.target.value)} />
          </Field>
          <Field label="Hours each">
            <input type="number" step="0.25" min="0" className="field" value={hours}
                   onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>

        {spool && totalGrams > 0 && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            shortfall > 0
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-line bg-ink-950/50 text-slate-400'
          }`}>
            {shortfall > 0
              ? `Needs ${totalGrams.toFixed(0)} g but ${spool.code} holds ` +
                `${Number(spool.remaining_grams).toFixed(0)} g — ${shortfall.toFixed(0)} g short.`
              : `Needs ${totalGrams.toFixed(0)} g of ${Number(spool.remaining_grams).toFixed(0)} g ` +
                `available on ${spool.code}.`}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Queuing…' : 'Queue job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Completion and failure both move stock, so both ask for what actually
 * happened. §4 level D exists precisely because the estimate is not the truth.
 */
function FinishModal({
  job, onClose, onSaved,
}: { job: JobRow; onClose: () => void; onSaved: () => void }) {
  const failing = job.status === 'FAILED';
  const [grams, setGrams] = useState(String(job.estimated_grams));
  const [hours, setHours] = useState((job.estimated_seconds / 3600).toFixed(2));
  const [failedQty, setFailedQty] = useState(failing ? String(job.quantity) : '0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.rpc('set_job_status', {
      p_job: job.id,
      p_status: job.status,
      p_actual_grams: Number(grams) || 0,
      p_actual_seconds: Math.round((Number(hours) || 0) * 3600),
      p_failed_quantity: Number(failedQty) || 0,
      p_failure_reason: reason.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={`${failing ? 'Record failure' : 'Complete'} · ${job.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <p className="text-sm text-slate-400">
          {failing
            ? 'Material used before the failure is deducted as waste, so it stays out of production cost.'
            : 'Weigh the print if you can — the actual figure is what teaches the estimator.'}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Material used (g)">
            <input required type="number" step="0.1" min="0" className="field" value={grams}
                   onChange={(e) => setGrams(e.target.value)} autoFocus />
          </Field>
          <Field label="Time taken (h)">
            <input type="number" step="0.25" min="0" className="field" value={hours}
                   onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>

        {failing && (
          <>
            <Field label="Failed quantity">
              <input type="number" min="0" max={job.quantity} className="field" value={failedQty}
                     onChange={(e) => setFailedQty(e.target.value)} />
            </Field>
            <Field label="Reason" hint="Feeds failure analytics later (§33).">
              <input className="field" value={reason} placeholder="Layer shift, adhesion, spaghetti…"
                     onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}

        <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3 text-sm text-slate-400">
          Estimated <Grams value={job.estimated_grams} /> ·{' '}
          {formatDuration(job.estimated_seconds)}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : failing ? 'Record failure' : 'Complete job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
