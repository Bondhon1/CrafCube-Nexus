import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BusinessKpis, OrderBalance, PrinterAnalytics, StockForecast, WasteAnalytics,
} from '@crafcube/types';
import { formatDuration, reorderAdvice, stockLevel } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  ACCENT, BarChart, LineChart, RankedBars, Sparkline, StackedBarChart, type Point,
} from '@/components/charts';

interface Data {
  kpis: BusinessKpis[];
  waste: WasteAnalytics[];
  printers: PrinterAnalytics[];
  stock: StockForecast[];
  orders: OrderBalance[];
}

const EMPTY: Data = { kpis: [], waste: [], printers: [], stock: [], orders: [] };

/** "Sep", for a month key like 2026-09-01. */
function monthLabel(month: string): string {
  return new Date(month).toLocaleDateString(undefined, { month: 'short' });
}

export function Dashboard() {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const org = activeOrg.id;
    const today = new Date().toISOString().slice(0, 10);

    const [kpis, waste, printers, stock, orders] = await Promise.all([
      supabase.from('business_kpis').select('*').eq('organization_id', org)
        .order('month', { ascending: false }).limit(12),
      supabase.from('waste_analytics').select('*').eq('organization_id', org)
        .order('month', { ascending: false }).limit(12),
      supabase.from('printer_analytics').select('*').eq('organization_id', org)
        .order('print_seconds', { ascending: false }),
      supabase.from('filament_stock_forecast').select('*').eq('organization_id', org),
      supabase.from('order_balances').select('*').eq('organization_id', org)
        .not('status', 'in', '("DELIVERED","CANCELLED")').lte('due_date', today),
    ]);

    setData({
      // Oldest first for charts; the newest row is still index -1.
      kpis: ((kpis.data ?? []) as BusinessKpis[]).slice().reverse(),
      waste: ((waste.data ?? []) as WasteAnalytics[]).slice().reverse(),
      printers: (printers.data ?? []) as PrinterAnalytics[],
      stock: (stock.data ?? []) as StockForecast[],
      orders: (orders.data ?? []) as OrderBalance[],
    });
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const current = data.kpis[data.kpis.length - 1];
  const previous = data.kpis[data.kpis.length - 2];

  const money = useCallback(
    (value: number) => `${currency} ${value.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`,
    [currency],
  );

  const alerts = useMemo(() => {
    const out: { key: string; tone: 'critical' | 'warning'; text: string; href: string }[] = [];

    for (const row of data.stock) {
      const level = stockLevel({
        remaining_grams: row.available_g,
        warn_grams: row.warn_grams,
        critical_grams: row.critical_grams,
      });
      const advice = reorderAdvice(row);
      if (level === 'critical') {
        out.push({
          key: `stock-${row.product_id}`, tone: 'critical',
          text: `${row.name} — ${Number(row.available_g).toFixed(0)} g left`,
          href: '/inventory/low-stock',
        });
      } else if (level === 'warning' || advice.reorder) {
        out.push({
          key: `stock-${row.product_id}`, tone: 'warning',
          text: advice.reorder
            ? `${row.name} — order ${((advice.quantityGrams ?? 0) / 1000).toFixed(1)} kg`
            : `${row.name} — running low`,
          href: '/inventory/low-stock',
        });
      }
    }

    for (const order of data.orders) {
      out.push({
        key: `order-${order.order_id}`, tone: 'critical',
        text: `${order.code} is past its due date`,
        href: '/sales/orders',
      });
    }

    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'critical' ? -1 : 1));
  }, [data.stock, data.orders]);

  const revenueSeries: Point[] = data.kpis.map((k) => ({
    label: monthLabel(k.month), value: k.revenue === null ? null : Number(k.revenue),
  }));
  const profitSeries: Point[] = data.kpis.map((k) => ({
    label: monthLabel(k.month), value: k.net_profit === null ? null : Number(k.net_profit),
  }));

  const netProfit = current?.net_profit === null || current === undefined
    ? null : Number(current.net_profit);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.22em] text-slate-500">OPERATIONS OVERVIEW</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-slate-100">
            {activeOrg?.name ?? 'Dashboard'}
          </h1>
        </div>
        <p className="text-[11px] tracking-[0.18em] text-slate-600">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </p>
      </header>

      {/* Exactly one hero figure: the number the business is actually judged on. */}
      <section className="card accent-rule relative overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Net profit this month
            </p>
            <p className={`mt-2 text-5xl font-semibold ${
              netProfit === null ? 'text-slate-600'
                : netProfit < 0 ? 'text-red-400' : 'text-mint'
            }`}>
              {netProfit === null ? '—' : money(netProfit)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {netProfit === null
                ? 'Nothing recorded yet. Revenue is counted when a payment is taken.'
                : `Revenue ${money(Number(current?.revenue ?? 0))} less everything it cost.`}
            </p>
          </div>
          <Delta
            current={netProfit}
            previous={previous?.net_profit === null || previous === undefined
              ? null : Number(previous.net_profit)}
            format={money}
          />
        </div>
      </section>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Revenue"
          value={current?.revenue === null || !current ? '—' : money(Number(current.revenue))}
          hint="cash received this month"
          trend={data.kpis.map((k) => Number(k.revenue ?? 0))}
        />
        <Tile
          label="Owed to you"
          value={money(data.orders.reduce((sum, o) => sum + Number(o.balance), 0))}
          hint={data.orders.length === 0 ? 'nothing overdue' : `${data.orders.length} overdue`}
          tone={data.orders.length > 0 ? 'warn' : 'neutral'}
        />
        <Tile
          label="Print hours"
          value={current ? formatDuration(Number(current.print_seconds)) : '—'}
          hint="finished jobs this month"
          trend={data.kpis.map((k) => Number(k.print_seconds ?? 0) / 3600)}
        />
        <Tile
          label="Failure rate"
          value={current?.failure_rate === null || !current
            ? '—' : `${Number(current.failure_rate).toFixed(0)}%`}
          hint={current?.failure_rate === null ? 'no jobs finished yet' : 'of finished jobs'}
          tone={current?.failure_rate !== null && Number(current?.failure_rate ?? 0) > 10
            ? 'warn' : 'neutral'}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <LineChart
          title="Revenue and profit"
          subtitle="Both in the same currency, so they share one axis."
          format={money}
          series={[
            { name: 'Revenue', points: revenueSeries },
            { name: 'Net profit', points: profitSeries },
          ]}
        />
        <StackedBarChart
          title="Where filament goes"
          subtitle="Anything above the first band never became a product."
          names={['Into product', 'Wasted', 'Samples', 'Drying loss']}
          format={(v) => `${(v / 1000).toFixed(1)} kg`}
          points={data.waste.map((w) => ({
            label: monthLabel(w.month),
            parts: [
              Number(w.product_grams), Number(w.waste_grams),
              Number(w.sample_grams), Number(w.drying_grams),
            ],
          }))}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <BarChart
            title="Jobs finished each month"
            subtitle="Completed and failed prints together."
            format={(v) => v.toFixed(0)}
            points={data.kpis.map((k) => ({
              label: monthLabel(k.month), value: Number(k.finished_jobs),
            }))}
          />
        </div>
        <RankedBars
          title="Machine hours"
          subtitle="Total time each printer has spent printing."
          color={ACCENT}
          format={(v) => formatDuration(v)}
          points={data.printers.map((p) => ({
            label: p.name, value: Number(p.print_seconds),
          }))}
        />
      </section>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Needs attention</h2>
          <Link to="/settings/notifications"
                className="text-[11px] text-slate-600 transition-colors hover:text-mint">
            All notifications
          </Link>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Nothing needs attention.
          </p>
        ) : (
          <ul className="space-y-2">
            {alerts.slice(0, 6).map((alert) => (
              <li key={alert.key}>
                <Link to={alert.href}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm
                                 transition-colors hover:bg-white/[0.03]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    alert.tone === 'critical' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="truncate text-slate-300">{alert.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Signed change against last month, coloured by direction. */
function Delta({
  current, previous, format,
}: {
  current: number | null;
  previous: number | null;
  format: (value: number) => string;
}) {
  // A delta against nothing is not zero growth — it is no comparison at all.
  if (current === null || previous === null) return null;
  const change = current - previous;
  if (Math.abs(change) < 0.005) {
    return <p className="text-xs text-slate-500">Level with last month.</p>;
  }
  return (
    <div className="text-right">
      <p className={`tabular text-lg font-semibold ${change > 0 ? 'text-mint' : 'text-red-400'}`}>
        {change > 0 ? '+' : '−'}{format(Math.abs(change))}
      </p>
      <p className="text-xs text-slate-500">vs last month</p>
    </div>
  );
}

function Tile({
  label, value, hint, trend, tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number[];
  tone?: 'neutral' | 'warn';
}) {
  const meaningful = trend?.filter((v) => v > 0).length ?? 0;
  return (
    <div className="card flex flex-col justify-between">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <p className={`mt-2 text-xl font-semibold ${
          tone === 'warn' ? 'text-amber-300' : 'text-slate-100'
        }`}>
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {/* A sparkline needs at least two real periods to describe a trend. */}
      {trend && meaningful >= 2 && (
        <div className="mt-3 opacity-60"><Sparkline values={trend} /></div>
      )}
    </div>
  );
}
