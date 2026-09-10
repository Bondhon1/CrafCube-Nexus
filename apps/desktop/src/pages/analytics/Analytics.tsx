import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BusinessKpis, CustomerSummary, FailureAnalytics, ModelReliability,
  PrinterAnalytics, ProductProfitability, StockForecast, WasteAnalytics,
} from '@crafcube/types';
import {
  formatDuration, machineRoi, marginPercent, perUnit, utilizationPercent, wasteSharePercent,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Grams, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { Figure, Meter, NotEnoughData } from '@/components/analytics';
import {
  ACCENT, BarChart, LineChart, RankedBars, SERIES, StackedBarChart,
} from '@/components/charts';

// The second categorical slot, for the paired comparison charts. Taken from the
// fixed order rather than picked by eye, so it stays colour-blind safe.
const SERIES_SECOND = SERIES[1];

export type AnalyticsView = 'products' | 'printers' | 'materials' | 'waste' | 'profitability';

/** "Sep", for a month key like 2026-09-01. */
function monthShort(month: string): string {
  return new Date(month).toLocaleDateString(undefined, { month: 'short' });
}

function kilos(grams: number): string {
  return `${(grams / 1000).toFixed(1)} kg`;
}

/** Which tables each screen needs; nothing loads a view it will not render. */
const SOURCES: Record<AnalyticsView, string[]> = {
  products: ['product_profitability'],
  printers: ['printer_analytics'],
  materials: ['filament_stock_forecast'],
  waste: ['waste_analytics', 'failure_analytics', 'model_reliability'],
  profitability: ['business_kpis', 'customer_summary'],
};

interface Data {
  products: ProductProfitability[];
  printers: PrinterAnalytics[];
  materials: StockForecast[];
  waste: WasteAnalytics[];
  failures: FailureAnalytics[];
  models: ModelReliability[];
  kpis: BusinessKpis[];
  customers: CustomerSummary[];
}

const EMPTY: Data = {
  products: [], printers: [], materials: [], waste: [],
  failures: [], models: [], kpis: [], customers: [],
};

const KEY_BY_TABLE: Record<string, keyof Data> = {
  product_profitability: 'products',
  printer_analytics: 'printers',
  filament_stock_forecast: 'materials',
  waste_analytics: 'waste',
  failure_analytics: 'failures',
  model_reliability: 'models',
  business_kpis: 'kpis',
  customer_summary: 'customers',
};

const ORDER_BY: Record<string, { column: string; ascending: boolean }> = {
  product_profitability: { column: 'gross_profit', ascending: false },
  printer_analytics: { column: 'print_seconds', ascending: false },
  filament_stock_forecast: { column: 'available_g', ascending: true },
  waste_analytics: { column: 'month', ascending: false },
  failure_analytics: { column: 'failures', ascending: false },
  model_reliability: { column: 'failure_rate', ascending: false },
  business_kpis: { column: 'month', ascending: false },
  customer_summary: { column: 'lifetime_value', ascending: false },
};

export function Analytics({
  view, title, subtitle,
}: {
  view: AnalyticsView;
  title: string;
  subtitle: string;
}) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setError(null);

    const tables = SOURCES[view];
    const results = await Promise.all(tables.map((table) => {
      const order = ORDER_BY[table];
      return supabase.from(table).select('*')
        .eq('organization_id', activeOrg.id)
        .order(order.column, { ascending: order.ascending, nullsFirst: false })
        .limit(200);
    }));

    const next: Data = { ...EMPTY };
    results.forEach((result, index) => {
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const key = KEY_BY_TABLE[tables[index]];
      (next[key] as unknown[]) = result.data ?? [];
    });
    setData(next);
    setLoading(false);
  }, [activeOrg, view]);

  useEffect(() => { void load(); }, [load]);

  const body = (() => {
    switch (view) {
      case 'products': return <Products rows={data.products} currency={currency} />;
      case 'printers': return <Printers rows={data.printers} currency={currency} />;
      case 'materials': return <Materials rows={data.materials} />;
      case 'waste': return (
        <Waste months={data.waste} failures={data.failures}
               models={data.models} currency={currency} />
      );
      case 'profitability': return (
        <Profitability kpis={data.kpis} customers={data.customers} currency={currency} />
      );
    }
  })();

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <ErrorNote message={error} />
      {loading ? <Panel><div className="px-4 py-10 text-center text-sm text-slate-500">
        Loading…
      </div></Panel> : body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products (§57, §69)
// ---------------------------------------------------------------------------

function Products({ rows, currency }: { rows: ProductProfitability[]; currency: string }) {
  const sold = rows.filter((r) => Number(r.units_sold) > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        <RankedBars
          title="Gross profit by product"
          subtitle="What each product has actually earned, cheapest comparison first."
          format={(v) => `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          points={sold.slice(0, 8).map((p) => ({
            label: p.name, value: Number(p.gross_profit),
          }))}
        />
        <RankedBars
          title="Units sold"
          subtitle="Volume does not always follow profit — compare the two."
          color={SERIES_SECOND}
          format={(v) => v.toFixed(0)}
          points={sold.slice(0, 8).map((p) => ({
            label: p.name, value: Number(p.units_sold),
          }))}
        />
      </div>

      <Panel>
        <Table
          head={
            <>
              <Th>Product</Th>
              <Th right>Units</Th>
              <Th right>Revenue</Th>
              <Th right>Cost</Th>
              <Th right>Gross profit</Th>
              <Th right>Margin</Th>
              <Th right>Profit / unit</Th>
            </>
          }
        >
          {sold.length === 0 && (
            <EmptyRow colSpan={7}>
              Nothing has sold yet. Profitability appears once orders carry product lines.
            </EmptyRow>
          )}
          {sold.map((p) => {
            const margin = marginPercent(Number(p.gross_profit), Number(p.revenue));
            const perUnitProfit = perUnit(Number(p.gross_profit), Number(p.units_sold));
            return (
              <Row key={p.product_id}>
                <Td className="font-medium text-slate-200">{p.name}</Td>
                <Td right className="text-slate-300">{p.units_sold}</Td>
                <Td right><Money value={p.revenue} currency={currency} /></Td>
                <Td right className="text-slate-500">
                  <Money value={p.cost} currency={currency} />
                </Td>
                <Td right>
                  <span className={Number(p.gross_profit) < 0 ? 'text-red-400' : 'text-mint'}>
                    <Money value={p.gross_profit} currency={currency} />
                  </span>
                </Td>
                <Td right className="text-slate-400">
                  {margin === null ? '—' : `${margin.toFixed(1)}%`}
                </Td>
                <Td right className="text-slate-400">
                  {perUnitProfit === null
                    ? '—' : <Money value={perUnitProfit} currency={currency} />}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {rows.length > sold.length && (
        <p className="text-xs text-slate-600">
          {rows.length - sold.length} product(s) have never sold and are hidden — a product with
          no sales has no profitability, and listing it at zero would read as a loss-maker.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Printers (§32, §70, §72)
// ---------------------------------------------------------------------------

function Printers({ rows, currency }: { rows: PrinterAnalytics[]; currency: string }) {
  if (rows.length === 0) {
    return <NotEnoughData>No printers yet.</NotEnoughData>;
  }

  return (
    <div className="space-y-4">
      {rows.length > 1 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <RankedBars
            title="Print hours by machine"
            subtitle="Where the work actually happens."
            format={(v) => formatDuration(v)}
            points={rows.map((p) => ({ label: p.name, value: Number(p.print_seconds) }))}
          />
          <RankedBars
            title="Filament through each machine"
            subtitle="Output, measured in material rather than time."
            color={SERIES_SECOND}
            format={kilos}
            points={rows.map((p) => ({ label: p.name, value: Number(p.filament_grams) }))}
          />
        </div>
      )}

      {rows.map((p) => {
        const utilization = utilizationPercent(Number(p.print_seconds), p.purchased_at);
        // §72 wants profit attributable to the machine. Nothing in the schema
        // ties a payment to a printer, so the honest stand-in is what the
        // machine cost to keep running — stated as cost, never as profit.
        const roi = machineRoi(0, p.purchase_cost === null ? null : Number(p.purchase_cost));

        return (
          <div key={p.printer_id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{p.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {p.purchased_at
                    ? `In service since ${new Date(p.purchased_at).toLocaleDateString()}`
                    : 'No purchase date recorded'}
                </p>
              </div>
              <Badge tone={p.status === 'printing' ? 'mint'
                : p.status === 'maintenance' ? 'amber' : 'slate'}>
                {p.status}
              </Badge>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Figure label="Print hours"
                      value={formatDuration(Number(p.print_seconds))} />
              <Figure label="Jobs finished" value={String(p.finished_jobs)}
                      hint={`${p.successful_jobs} ok · ${p.failed_jobs} failed`} />
              <Figure
                label="Success rate"
                value={p.success_rate === null ? '—' : `${Number(p.success_rate).toFixed(1)}%`}
                hint={p.success_rate === null ? 'nothing has finished yet' : undefined}
                tone={p.success_rate === null ? 'muted'
                  : Number(p.success_rate) >= 90 ? 'good' : 'warn'}
              />
              <Figure label="Filament used"
                      value={`${(Number(p.filament_grams) / 1000).toFixed(2)} kg`} />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="sm:col-span-2">
                <Meter label="Utilisation" percent={utilization}
                       hint={utilization === null
                         ? 'needs a purchase date to measure against'
                         : 'share of hours since purchase spent printing'} />
              </div>
              <Figure label="Maintenance cost"
                      value={<Money value={p.maintenance_cost} currency={currency} />}
                      hint={`${Number(p.downtime_hours).toFixed(1)}h downtime`} />
              <Figure
                label="Investment"
                value={roi === null
                  ? '—'
                  : <Money value={p.purchase_cost ?? 0} currency={currency} />}
                hint={roi === null
                  ? 'no purchase cost recorded'
                  : p.next_due_on
                    ? `service due ${new Date(p.next_due_on).toLocaleDateString()}`
                    : undefined}
                tone="muted"
              />
            </div>
          </div>
        );
      })}

      <p className="text-xs text-slate-600">
        Revenue per machine is deliberately not shown. Jobs are not tied to order lines in every
        workflow, so any per-machine revenue figure would be an allocation nobody could reconcile
        against the P&amp;L. Hours, output and failures are what a machine demonstrably produces.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Materials (§11, §66)
// ---------------------------------------------------------------------------

function Materials({ rows }: { rows: StockForecast[] }) {
  const measured = rows.filter((r) => r.daily_usage_g !== null);

  return (
    <div className="space-y-6">
      <Panel>
        <Table
          head={
            <>
              <Th>Filament</Th>
              <Th right>On hand</Th>
              <Th right>Reserved</Th>
              <Th right>Available</Th>
              <Th right>Used (30d)</Th>
              <Th right>Per day</Th>
              <Th right>Days left</Th>
            </>
          }
        >
          {rows.length === 0 && <EmptyRow colSpan={7}>No filament products yet.</EmptyRow>}
          {rows.map((r) => (
            <Row key={r.product_id}>
              <Td>
                <span className="flex items-center gap-2">
                  {r.color_hex && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                          style={{ background: r.color_hex }} />
                  )}
                  <span className="font-medium text-slate-200">{r.name}</span>
                </span>
              </Td>
              <Td right className="text-slate-300"><Grams value={r.on_hand_g} /></Td>
              <Td right className="text-slate-500"><Grams value={r.reserved_g} /></Td>
              <Td right className="text-slate-300"><Grams value={r.available_g} /></Td>
              <Td right className="text-slate-400">
                {r.used_30d_g === null ? '—' : <Grams value={r.used_30d_g} />}
              </Td>
              <Td right className="text-slate-400">
                {r.daily_usage_g === null ? '—' : <Grams value={r.daily_usage_g} />}
              </Td>
              <Td right>
                {r.days_remaining === null
                  ? <span className="text-slate-600">—</span>
                  : (
                    <span className={Number(r.days_remaining) < 7 ? 'text-amber-300'
                      : 'text-slate-300'}>
                      {Number(r.days_remaining).toFixed(1)}
                    </span>
                  )}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {measured.length < rows.length && (
        <p className="text-xs text-slate-600">
          {rows.length - measured.length} filament(s) show no usage in the last 30 days, so no
          depletion estimate is offered. A forecast built on no consumption is a guess wearing a
          number.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waste and failures (§33, §53)
// ---------------------------------------------------------------------------

function Waste({
  months, failures, models, currency,
}: {
  months: WasteAnalytics[];
  failures: FailureAnalytics[];
  models: ModelReliability[];
  currency: string;
}) {
  const current = months[0];
  const share = current ? wasteSharePercent(current) : null;
  const worstModel = models.find((m) => Number(m.finished_jobs) >= 3);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Into product"
                value={current ? `${(Number(current.product_grams) / 1000).toFixed(2)} kg` : '—'} />
        <Figure label="Wasted"
                value={current ? `${(Number(current.waste_grams) / 1000).toFixed(2)} kg` : '—'}
                tone="warn" />
        <Figure label="Outside finished products"
                value={share === null ? '—' : `${share.toFixed(1)}%`}
                hint={share === null ? 'nothing moved this month' : 'of all filament consumed'}
                tone={share !== null && share > 15 ? 'warn' : 'muted'} />
        <Figure label="Value lost"
                value={current
                  ? <Money value={current.waste_value} currency={currency} /> : '—'}
                tone="warn" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Failure causes</h2>
          <Panel>
            <Table head={<><Th>Reason</Th><Th right>Count</Th><Th right>Share</Th>
              <Th right>Filament</Th></>}>
              {failures.length === 0 && (
                <EmptyRow colSpan={4}>No failed jobs recorded — nothing to analyse.</EmptyRow>
              )}
              {failures.map((f) => (
                <Row key={f.reason}>
                  <Td className="text-slate-300">{f.reason}</Td>
                  <Td right className="text-slate-300">{f.failures}</Td>
                  <Td right className="text-slate-400">
                    {f.share_of_failures === null
                      ? '—' : `${Number(f.share_of_failures).toFixed(0)}%`}
                  </Td>
                  <Td right className="text-slate-500"><Grams value={f.wasted_grams} /></Td>
                </Row>
              ))}
            </Table>
          </Panel>
          {failures.some((f) => f.reason === 'Unrecorded') && (
            <p className="mt-2 text-xs text-slate-600">
              Failures logged without a reason show as "Unrecorded". §33 only pays off if the
              reason is captured when the print fails.
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Model reliability</h2>
          <Panel>
            <Table head={<><Th>Model</Th><Th right>Jobs</Th><Th right>Failed</Th>
              <Th right>Failure rate</Th></>}>
              {models.length === 0 && (
                <EmptyRow colSpan={4}>No finished jobs are linked to a model yet.</EmptyRow>
              )}
              {models.map((m) => (
                <Row key={m.model_id}>
                  <Td className="text-slate-300">{m.name}</Td>
                  <Td right className="text-slate-400">{m.finished_jobs}</Td>
                  <Td right className="text-slate-400">{m.failed_jobs}</Td>
                  <Td right>
                    {/* Under three jobs a rate is noise, so it is shown greyed
                        with its sample count rather than as a verdict. */}
                    <span className={Number(m.finished_jobs) < 3 ? 'text-slate-600'
                      : Number(m.failure_rate) > 10 ? 'text-amber-300' : 'text-slate-300'}>
                      {m.failure_rate === null ? '—' : `${Number(m.failure_rate).toFixed(0)}%`}
                      {Number(m.finished_jobs) < 3 && ' (too few)'}
                    </span>
                  </Td>
                </Row>
              ))}
            </Table>
          </Panel>
          {worstModel && Number(worstModel.failure_rate) > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Worst model: <span className="text-slate-300">{worstModel.name}</span> at{' '}
              {Number(worstModel.failure_rate).toFixed(0)}% across {worstModel.finished_jobs} jobs.
            </p>
          )}
        </section>
      </div>

      <StackedBarChart
        title="Where filament goes, month by month"
        subtitle="Everything above the first band left stock without becoming a product."
        names={['Into product', 'Wasted', 'Samples', 'Drying loss']}
        format={kilos}
        points={months.slice().reverse().map((m) => ({
          label: monthShort(m.month),
          parts: [
            Number(m.product_grams), Number(m.waste_grams),
            Number(m.sample_grams), Number(m.drying_grams),
          ],
        }))}
      />

      <Panel>
        <Table head={<><Th>Month</Th><Th right>Product</Th><Th right>Waste</Th>
          <Th right>Samples</Th><Th right>Drying</Th><Th right>Outside product</Th></>}>
          {months.length === 0 && <EmptyRow colSpan={6}>No filament has moved yet.</EmptyRow>}
          {months.map((m) => {
            const monthShare = wasteSharePercent(m);
            return (
              <Row key={m.month}>
                <Td className="whitespace-nowrap text-slate-300">
                  {new Date(m.month).toLocaleDateString(undefined,
                    { month: 'long', year: 'numeric' })}
                </Td>
                <Td right className="text-slate-300"><Grams value={m.product_grams} /></Td>
                <Td right className="text-slate-400"><Grams value={m.waste_grams} /></Td>
                <Td right className="text-slate-500"><Grams value={m.sample_grams} /></Td>
                <Td right className="text-slate-500"><Grams value={m.drying_grams} /></Td>
                <Td right>
                  <span className={monthShare !== null && monthShare > 15
                    ? 'text-amber-300' : 'text-slate-400'}>
                    {monthShare === null ? '—' : `${monthShare.toFixed(1)}%`}
                  </span>
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profitability (§58, §69)
// ---------------------------------------------------------------------------

function Profitability({
  kpis, customers, currency,
}: {
  kpis: BusinessKpis[];
  customers: CustomerSummary[];
  currency: string;
}) {
  const current = kpis[0];
  // Charts read oldest first; the table below stays newest first.
  const ordered = useMemo(() => kpis.slice().reverse(), [kpis]);

  const headline = useMemo(() => ({
    perHour: current?.profit_per_machine_hour ?? null,
    perGram: current?.profit_per_gram ?? null,
    margin: current?.gross_margin ?? null,
    aov: current?.average_order_value ?? null,
  }), [current]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Profit / machine hour"
          value={headline.perHour === null
            ? '—' : <Money value={headline.perHour} currency={currency} />}
          hint={headline.perHour === null ? 'no print hours this month' : 'the §69 headline metric'}
          tone={headline.perHour === null ? 'muted' : 'good'}
        />
        <Figure
          label="Profit / gram"
          value={headline.perGram === null
            ? '—' : <Money value={headline.perGram} currency={currency} />}
          hint={headline.perGram === null ? 'nothing printed this month' : undefined}
          tone={headline.perGram === null ? 'muted' : 'good'}
        />
        <Figure
          label="Gross margin"
          value={headline.margin === null ? '—' : `${Number(headline.margin).toFixed(1)}%`}
          hint={headline.margin === null ? 'no revenue this month' : undefined}
        />
        <Figure
          label="Average order"
          value={headline.aov === null
            ? '—' : <Money value={headline.aov} currency={currency} />}
          hint={headline.aov === null ? 'no orders this month' : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <LineChart
          title="Profit per machine hour"
          subtitle="The metric §69 singles out: what an hour of printing is worth."
          format={(v) => `${currency} ${v.toFixed(0)}`}
          series={[{
            name: 'Profit / hour',
            points: ordered.map((k) => ({
              label: monthShort(k.month),
              value: k.profit_per_machine_hour === null
                ? null : Number(k.profit_per_machine_hour),
            })),
          }]}
        />
        <BarChart
          title="Net profit by month"
          subtitle="Revenue less every cost, including the ones below gross profit."
          color={ACCENT}
          format={(v) => `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          points={ordered.map((k) => ({
            label: monthShort(k.month),
            value: k.net_profit === null ? null : Number(k.net_profit),
          }))}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">By month</h2>
        <Panel>
          <Table head={<><Th>Month</Th><Th right>Revenue</Th><Th right>Net profit</Th>
            <Th right>Margin</Th><Th right>Print hours</Th><Th right>Failure rate</Th>
            <Th right>Profit / hour</Th><Th right>Profit / g</Th></>}>
            {kpis.length === 0 && (
              <EmptyRow colSpan={8}>Nothing recorded yet.</EmptyRow>
            )}
            {kpis.map((k) => (
              <Row key={k.month}>
                <Td className="whitespace-nowrap text-slate-300">
                  {new Date(k.month).toLocaleDateString(undefined,
                    { month: 'short', year: 'numeric' })}
                </Td>
                <Td right><Money value={k.revenue ?? 0} currency={currency} /></Td>
                <Td right>
                  <span className={Number(k.net_profit ?? 0) < 0 ? 'text-red-400' : 'text-mint'}>
                    <Money value={k.net_profit ?? 0} currency={currency} />
                  </span>
                </Td>
                <Td right className="text-slate-400">
                  {k.gross_margin === null ? '—' : `${Number(k.gross_margin).toFixed(1)}%`}
                </Td>
                <Td right className="text-slate-400">
                  {formatDuration(Number(k.print_seconds))}
                </Td>
                <Td right className="text-slate-400">
                  {k.failure_rate === null ? '—' : `${Number(k.failure_rate).toFixed(0)}%`}
                </Td>
                <Td right className="text-slate-400">
                  {k.profit_per_machine_hour === null
                    ? '—' : <Money value={k.profit_per_machine_hour} currency={currency} />}
                </Td>
                <Td right className="text-slate-400">
                  {k.profit_per_gram === null
                    ? '—' : Number(k.profit_per_gram).toFixed(2)}
                </Td>
              </Row>
            ))}
          </Table>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Customers (§58)</h2>
        <Panel>
          <Table head={<><Th>Customer</Th><Th right>Orders</Th><Th right>Lifetime value</Th>
            <Th right>Outstanding</Th><Th right>Average order</Th></>}>
            {customers.length === 0 && <EmptyRow colSpan={5}>No customers yet.</EmptyRow>}
            {customers.map((c) => {
              const average = perUnit(Number(c.lifetime_value), Number(c.order_count));
              return (
                <Row key={c.customer_id}>
                  <Td className="text-slate-200">{c.name}</Td>
                  <Td right className="text-slate-400">{c.order_count}</Td>
                  <Td right><Money value={c.lifetime_value} currency={currency} /></Td>
                  <Td right>
                    {Number(c.outstanding) > 0.01
                      ? <span className="text-amber-300">
                          <Money value={c.outstanding} currency={currency} />
                        </span>
                      : <span className="text-slate-600">—</span>}
                  </Td>
                  <Td right className="text-slate-400">
                    {average === null ? '—' : <Money value={average} currency={currency} />}
                  </Td>
                </Row>
              );
            })}
          </Table>
        </Panel>
        <p className="mt-2 text-xs text-slate-600">
          Lifetime value counts what was ordered, not what was paid — outstanding is the
          difference, and the two are never added together (§103).
        </p>
      </section>
    </div>
  );
}
