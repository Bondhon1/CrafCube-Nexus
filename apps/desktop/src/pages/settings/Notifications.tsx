import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MaintenanceRecord, OrderBalance, PrintJob, StockForecast,
} from '@crafcube/types';
import { paymentState, reorderAdvice, stockLevel } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { ErrorNote, PageHeader } from '@/components/ui';
import { Figure, NotEnoughData } from '@/components/analytics';

type Severity = 'critical' | 'warning' | 'info';

interface Alert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Where the operator goes to act on it. */
  href: string;
  action: string;
}

const DOT: Record<Severity, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-mint',
};

const BORDER: Record<Severity, string> = {
  critical: 'border-red-500/25 bg-red-500/[0.04]',
  warning: 'border-amber-500/25 bg-amber-500/[0.04]',
  info: 'border-line',
};

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function Notifications() {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [stock, setStock] = useState<StockForecast[]>([]);
  const [orders, setOrders] = useState<OrderBalance[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const [s, o, j, m] = await Promise.all([
      supabase.from('filament_stock_forecast').select('*')
        .eq('organization_id', activeOrg.id),
      supabase.from('order_balances').select('*')
        .eq('organization_id', activeOrg.id)
        .not('status', 'in', '("DELIVERED","CANCELLED")'),
      supabase.from('print_jobs').select('*')
        .eq('organization_id', activeOrg.id).eq('status', 'FAILED')
        .order('finished_at', { ascending: false, nullsFirst: false }).limit(5),
      supabase.from('maintenance_records').select('*')
        .eq('organization_id', activeOrg.id)
        .not('next_due_on', 'is', null).lte('next_due_on', week)
        .order('next_due_on', { ascending: true }),
    ]);

    if (s.error) setError(s.error.message);
    else setStock((s.data ?? []) as StockForecast[]);
    if (!o.error) setOrders((o.data ?? []) as OrderBalance[]);
    if (!j.error) setJobs((j.data ?? []) as PrintJob[]);
    // The query already restricted this to services due within the week.
    if (!m.error) setMaintenance((m.data ?? []) as MaintenanceRecord[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const row of stock) {
      const level = stockLevel({
        remaining_grams: row.available_g,
        warn_grams: row.warn_grams,
        critical_grams: row.critical_grams,
      });
      const advice = reorderAdvice(row);
      if (level === 'critical') {
        out.push({
          id: `stock-${row.product_id}`,
          severity: 'critical',
          title: `${row.name} is critically low`,
          detail: `${Number(row.available_g).toFixed(0)} g available. ${advice.reason}`,
          href: '#/inventory/low-stock',
          action: 'Reorder',
        });
      } else if (level === 'warning' || advice.reorder) {
        out.push({
          id: `stock-${row.product_id}`,
          severity: 'warning',
          title: `${row.name} is running down`,
          detail: advice.reorder
            ? `Order ${((advice.quantityGrams ?? 0) / 1000).toFixed(1)} kg` +
              (advice.orderWithinDays === 0
                ? ' now.' : ` within ${advice.orderWithinDays} days.`)
            : advice.reason,
          href: '#/inventory/low-stock',
          action: 'Reorder',
        });
      }
    }

    for (const record of maintenance) {
      const due = record.next_due_on as string;
      out.push({
        id: `maintenance-${record.id}`,
        severity: due < today ? 'critical' : 'warning',
        title: due < today ? 'Maintenance overdue' : 'Maintenance due soon',
        detail: `Scheduled for ${new Date(due).toLocaleDateString()}.`,
        href: '#/printers/maintenance',
        action: 'Open maintenance',
      });
    }

    for (const order of orders) {
      if (order.due_date && order.due_date <= today) {
        out.push({
          id: `due-${order.order_id}`,
          severity: order.due_date < today ? 'critical' : 'warning',
          title: `${order.code} is ${order.due_date < today ? 'overdue' : 'due today'}`,
          detail: `${order.customer_name ?? 'Walk-in'} · ${order.status.toLowerCase()}.`,
          href: '#/sales/orders',
          action: 'Open order',
        });
      }
      const state = paymentState(Number(order.total), Number(order.paid));
      if (state === 'unpaid' && order.status === 'READY') {
        out.push({
          id: `unpaid-${order.order_id}`,
          severity: 'warning',
          title: `${order.code} is ready but unpaid`,
          detail: `${currency} ${Number(order.balance).toFixed(2)} outstanding.`,
          href: '#/sales/orders',
          action: 'Take payment',
        });
      }
    }

    for (const job of jobs) {
      out.push({
        id: `failed-${job.id}`,
        severity: 'info',
        title: `${job.code} failed`,
        detail: job.failure_reason
          ? job.failure_reason
          : 'No reason recorded — failure analytics needs one to be useful.',
        href: '#/production/failed',
        action: 'Open job',
      });
    }

    return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  }, [stock, orders, jobs, maintenance, currency]);

  const counts = {
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    info: alerts.filter((a) => a.severity === 'info').length,
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Everything the data is currently saying, computed when you open this screen."
      />

      <ErrorNote message={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Figure label="Needs attention" value={String(counts.critical)}
                tone={counts.critical > 0 ? 'bad' : 'muted'} />
        <Figure label="Worth watching" value={String(counts.warning)}
                tone={counts.warning > 0 ? 'warn' : 'muted'} />
        <Figure label="For information" value={String(counts.info)} tone="muted" />
      </div>

      {loading && <NotEnoughData>Loading…</NotEnoughData>}
      {!loading && alerts.length === 0 && (
        <NotEnoughData>Nothing needs your attention.</NotEnoughData>
      )}

      <div className="space-y-2">
        {alerts.map((alert) => (
          <div key={alert.id}
               className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                 BORDER[alert.severity]}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[alert.severity]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">{alert.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{alert.detail}</p>
            </div>
            <a href={alert.href}
               className="shrink-0 whitespace-nowrap text-xs text-mint hover:text-mint-500">
              {alert.action}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-600">
        These are computed on open rather than pushed. Delivery — email, push, a background
        watcher — needs infrastructure this app does not have, and an alert that quietly fails to
        arrive is worse than one you came here to read.
      </p>
    </div>
  );
}
