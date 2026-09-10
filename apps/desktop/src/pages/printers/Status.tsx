import { useCallback, useEffect, useState } from 'react';
import type { PrintJob, Printer, PrinterAnalytics, PrinterStatus } from '@crafcube/types';
import {
  PRINTER_STATUS_LABELS, formatDuration, utilizationPercent,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { Badge, ErrorNote, PageHeader } from '@/components/ui';
import { Meter, NotEnoughData } from '@/components/analytics';

const TONE: Record<PrinterStatus, 'mint' | 'amber' | 'red' | 'slate'> = {
  idle: 'slate',
  printing: 'mint',
  paused: 'amber',
  maintenance: 'amber',
  offline: 'red',
  retired: 'slate',
};

const SETTABLE: PrinterStatus[] = ['idle', 'printing', 'paused', 'maintenance', 'offline'];

export function Status() {
  const { activeOrg, can } = useSession();
  const editable = can('printers.write');

  const [printers, setPrinters] = useState<Printer[]>([]);
  const [analytics, setAnalytics] = useState<PrinterAnalytics[]>([]);
  const [running, setRunning] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [machines, stats, jobs] = await Promise.all([
      supabase.from('printers').select('*')
        .eq('organization_id', activeOrg.id).neq('status', 'retired').order('name'),
      supabase.from('printer_analytics').select('*').eq('organization_id', activeOrg.id),
      supabase.from('print_jobs').select('*')
        .eq('organization_id', activeOrg.id)
        .in('status', ['PREPARING', 'PRINTING', 'PAUSED'])
        .order('started_at', { ascending: false }),
    ]);
    if (machines.error) setError(machines.error.message);
    else setPrinters((machines.data ?? []) as Printer[]);
    if (!stats.error) setAnalytics((stats.data ?? []) as PrinterAnalytics[]);
    if (!jobs.error) setRunning((jobs.data ?? []) as PrintJob[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(printer: Printer, status: PrinterStatus) {
    setError(null);
    const { error: err } = await supabase.from('printers')
      .update({ status }).eq('id', printer.id);
    if (err) setError(err.message);
    await load();
  }

  if (loading) return <div><PageHeader title="Printer status" /><NotEnoughData>Loading…</NotEnoughData></div>;

  return (
    <div>
      <PageHeader
        title="Printer status"
        subtitle="What each machine is doing now, and what it has done since it arrived."
      />

      <ErrorNote message={error} />

      {printers.length === 0 && <NotEnoughData>No printers yet.</NotEnoughData>}

      <div className="grid gap-4 xl:grid-cols-2">
        {printers.map((printer) => {
          const stats = analytics.find((a) => a.printer_id === printer.id);
          const job = running.find((j) => j.printer_id === printer.id);
          const utilization = stats
            ? utilizationPercent(Number(stats.print_seconds), printer.purchased_at)
            : null;

          return (
            <div key={printer.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100">{printer.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[printer.brand, printer.model].filter(Boolean).join(' ') || 'No model set'}
                    {printer.location && ` · ${printer.location}`}
                  </p>
                </div>
                <Badge tone={TONE[printer.status]}>
                  {PRINTER_STATUS_LABELS[printer.status]}
                </Badge>
              </div>

              <div className="mt-4 rounded-lg border border-line bg-ink-950/40 px-3 py-2.5">
                {job ? (
                  <>
                    <p className="text-xs text-slate-400">
                      <span className="font-mono text-mint">{job.code}</span> — {job.status.toLowerCase()}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {job.quantity} × · estimated {formatDuration(job.estimated_seconds)},{' '}
                      {Number(job.estimated_grams).toFixed(0)} g
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-600">
                    {/* The status field is set by hand; §100 leaves live firmware
                        telemetry to a later phase, so this says what is known. */}
                    No job on this machine. Status is whatever was last set here —
                    printers are not polled.
                  </p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <Stat label="Print hours"
                      value={stats ? formatDuration(Number(stats.print_seconds)) : '—'} />
                <Stat label="Jobs" value={stats ? String(stats.finished_jobs) : '—'} />
                <Stat label="Success"
                      value={stats?.success_rate === null || !stats
                        ? '—' : `${Number(stats.success_rate).toFixed(0)}%`} />
              </div>

              <div className="mt-4">
                <Meter label="Utilisation" percent={utilization}
                       hint={utilization === null ? 'set a purchase date to measure against'
                         : undefined} />
              </div>

              {editable && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {SETTABLE.filter((s) => s !== printer.status).map((s) => (
                    <button key={s} onClick={() => void setStatus(printer, s)}
                            className="btn-ghost px-2.5 py-1 text-xs">
                      {PRINTER_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">{label}</p>
      <p className="tabular mt-0.5 text-slate-200">{value}</p>
    </div>
  );
}
