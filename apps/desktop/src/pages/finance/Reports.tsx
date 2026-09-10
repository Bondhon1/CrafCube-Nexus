import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BusinessKpis, CustomerSummary, ProductProfitability } from '@crafcube/types';
import { formatDuration } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  EmptyRow, ErrorNote, Money, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { Figure } from '@/components/analytics';

type ReportId = 'monthly' | 'products' | 'customers';

const REPORTS: { id: ReportId; name: string; description: string }[] = [
  {
    id: 'monthly',
    name: 'Monthly performance',
    description: 'Revenue, profit, print hours and the §69 efficiency metrics, month by month.',
  },
  {
    id: 'products',
    name: 'Product profitability',
    description: 'Units, revenue, cost and margin per product, from snapshotted line costs.',
  },
  {
    id: 'customers',
    name: 'Customer statement',
    description: 'Lifetime value against outstanding balance, per customer.',
  },
];

/** RFC 4180: quote anything containing a comma, quote or newline. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function Reports() {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [report, setReport] = useState<ReportId>('monthly');
  const [kpis, setKpis] = useState<BusinessKpis[]>([]);
  const [products, setProducts] = useState<ProductProfitability[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [k, p, c] = await Promise.all([
      supabase.from('business_kpis').select('*').eq('organization_id', activeOrg.id)
        .order('month', { ascending: false }).limit(24),
      supabase.from('product_profitability').select('*').eq('organization_id', activeOrg.id)
        .order('gross_profit', { ascending: false, nullsFirst: false }),
      supabase.from('customer_summary').select('*').eq('organization_id', activeOrg.id)
        .order('lifetime_value', { ascending: false }),
    ]);
    if (k.error) setError(k.error.message);
    else setKpis((k.data ?? []) as BusinessKpis[]);
    if (!p.error) setProducts((p.data ?? []) as ProductProfitability[]);
    if (!c.error) setCustomers((c.data ?? []) as CustomerSummary[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const csv = useMemo(() => {
    switch (report) {
      case 'monthly':
        return toCsv(
          ['Month', 'Revenue', 'Gross profit', 'Net profit', 'Gross margin %', 'Print hours',
           'Filament g', 'Jobs', 'Failure rate %', 'Orders', 'Average order',
           'Profit per hour', 'Profit per gram'],
          kpis.map((k) => [
            k.month, k.revenue ?? '', k.gross_profit ?? '', k.net_profit ?? '',
            k.gross_margin ?? '', (Number(k.print_seconds) / 3600).toFixed(2),
            k.filament_grams, k.finished_jobs, k.failure_rate ?? '', k.orders,
            k.average_order_value ?? '', k.profit_per_machine_hour ?? '',
            k.profit_per_gram ?? '',
          ]),
        );
      case 'products':
        return toCsv(
          ['Product', 'SKU', 'Units sold', 'Orders', 'Revenue', 'Cost', 'Gross profit',
           'Last sold'],
          products.map((p) => [
            p.name, p.sku ?? '', p.units_sold, p.order_count, p.revenue, p.cost,
            p.gross_profit, p.last_sold_at ?? '',
          ]),
        );
      case 'customers':
        return toCsv(
          ['Customer', 'Type', 'Orders', 'Lifetime value', 'Outstanding', 'Last order'],
          customers.map((c) => [
            c.name, c.type, c.order_count, c.lifetime_value, c.outstanding,
            c.last_order_at ?? '',
          ]),
        );
    }
  }, [report, kpis, products, customers]);

  const rowCount = report === 'monthly' ? kpis.length
    : report === 'products' ? products.length : customers.length;

  async function download() {
    setError(null);
    setSaved(null);
    const bridge = window.nexus;
    if (!bridge) {
      setError('File saving is only available in the desktop app.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await bridge.files.saveText(`crafcube-${report}-${stamp}.csv`, csv);
    if (path) setSaved(path);
  }

  const current = REPORTS.find((r) => r.id === report) as (typeof REPORTS)[number];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Generated on demand from the same views the screens use, so a report and the app can never disagree."
        actions={(
          <button onClick={() => void download()} disabled={rowCount === 0}
                  className="btn-primary">
            Export CSV
          </button>
        )}
      />

      <ErrorNote message={error} />
      {saved && (
        <p className="mb-4 rounded-md border border-mint/30 bg-mint/10 px-3 py-2 text-sm text-mint">
          Saved to {saved}
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => { setReport(r.id); setSaved(null); }}
            className={`card text-left transition-colors ${
              r.id === report ? 'border-mint/40' : 'hover:border-line-bright'
            }`}
          >
            <p className={`text-sm font-semibold ${
              r.id === report ? 'text-mint' : 'text-slate-200'
            }`}>
              {r.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">{r.description}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{current.name}</h2>
        <p className="text-xs text-slate-500">
          {loading ? 'Loading…' : `${rowCount} row${rowCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {report === 'monthly' && (
        <Panel>
          <Table head={<><Th>Month</Th><Th right>Revenue</Th><Th right>Net profit</Th>
            <Th right>Print hours</Th><Th right>Jobs</Th><Th right>Orders</Th></>}>
            {kpis.length === 0 && <EmptyRow colSpan={6}>Nothing recorded yet.</EmptyRow>}
            {kpis.map((k) => (
              <Row key={k.month}>
                <Td className="whitespace-nowrap text-slate-300">
                  {new Date(k.month).toLocaleDateString(undefined,
                    { month: 'long', year: 'numeric' })}
                </Td>
                <Td right><Money value={k.revenue ?? 0} currency={currency} /></Td>
                <Td right>
                  <span className={Number(k.net_profit ?? 0) < 0 ? 'text-red-400' : 'text-mint'}>
                    <Money value={k.net_profit ?? 0} currency={currency} />
                  </span>
                </Td>
                <Td right className="text-slate-400">
                  {formatDuration(Number(k.print_seconds))}
                </Td>
                <Td right className="text-slate-400">{k.finished_jobs}</Td>
                <Td right className="text-slate-400">{k.orders}</Td>
              </Row>
            ))}
          </Table>
        </Panel>
      )}

      {report === 'products' && (
        <Panel>
          <Table head={<><Th>Product</Th><Th right>Units</Th><Th right>Revenue</Th>
            <Th right>Cost</Th><Th right>Gross profit</Th></>}>
            {products.length === 0 && <EmptyRow colSpan={5}>No products yet.</EmptyRow>}
            {products.map((p) => (
              <Row key={p.product_id}>
                <Td className="text-slate-200">{p.name}</Td>
                <Td right className="text-slate-400">{p.units_sold}</Td>
                <Td right><Money value={p.revenue} currency={currency} /></Td>
                <Td right className="text-slate-500">
                  <Money value={p.cost} currency={currency} />
                </Td>
                <Td right>
                  <span className={Number(p.gross_profit) < 0 ? 'text-red-400' : 'text-mint'}>
                    <Money value={p.gross_profit} currency={currency} />
                  </span>
                </Td>
              </Row>
            ))}
          </Table>
        </Panel>
      )}

      {report === 'customers' && (
        <Panel>
          <Table head={<><Th>Customer</Th><Th right>Orders</Th><Th right>Lifetime value</Th>
            <Th right>Outstanding</Th></>}>
            {customers.length === 0 && <EmptyRow colSpan={4}>No customers yet.</EmptyRow>}
            {customers.map((c) => (
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
              </Row>
            ))}
          </Table>
        </Panel>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Figure label="Months covered" value={String(kpis.length)} tone="muted" />
        <Figure label="Products" value={String(products.length)} tone="muted" />
        <Figure label="Customers" value={String(customers.length)} tone="muted" />
      </div>

      <p className="mt-4 text-xs text-slate-600">
        §68 imagines these arriving on a schedule by email. Sending is deliberately not built:
        it needs an outbound mail path this app does not have, and a report that silently fails
        to send is worse than one you export yourself.
      </p>
    </div>
  );
}
