import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FinanceCategory, FinanceDirection, FinanceTransaction, ProfitAndLoss,
} from '@crafcube/types';
import { marginPercent } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface TxnRow extends FinanceTransaction {
  category: Pick<FinanceCategory, 'name' | 'is_cogs'> | null;
}

/** Which rows each Finance screen shows. */
export type FinanceView = 'transactions' | 'expenses' | 'revenue' | 'pnl';

export function Finance({
  view,
  title,
  subtitle,
}: {
  view: FinanceView;
  title: string;
  subtitle: string;
}) {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const canWrite = can('finance.write');

  const [rows, setRows] = useState<TxnRow[]>([]);
  const [pnl, setPnl] = useState<ProfitAndLoss[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<FinanceDirection | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    let query = supabase
      .from('finance_transactions')
      .select('*, category:finance_categories(name, is_cogs)')
      .eq('organization_id', activeOrg.id)
      .order('occurred_on', { ascending: false })
      .limit(200);
    if (view === 'expenses') query = query.eq('direction', 'expense');
    if (view === 'revenue') query = query.eq('direction', 'income');

    const [txns, report, cats] = await Promise.all([
      view === 'pnl' ? Promise.resolve({ data: [], error: null }) : query,
      supabase.from('profit_and_loss').select('*').eq('organization_id', activeOrg.id)
        .order('month', { ascending: false }).limit(12),
      supabase.from('finance_categories').select('*').eq('organization_id', activeOrg.id)
        .order('name'),
    ]);

    if (txns.error) setError(txns.error.message);
    else setRows((txns.data ?? []) as unknown as TxnRow[]);
    if (!report.error) setPnl((report.data ?? []) as ProfitAndLoss[]);
    if (!cats.error) setCategories((cats.data ?? []) as FinanceCategory[]);
    setLoading(false);
  }, [activeOrg, view]);

  useEffect(() => { void load(); }, [load]);

  async function seed() {
    if (!activeOrg) return;
    setSeeding(true);
    setError(null);
    const { error: err } = await supabase.rpc('seed_finance_categories', { p_org: activeOrg.id });
    if (err) setError(err.message);
    await load();
    setSeeding(false);
  }

  const totals = useMemo(() => {
    const current = pnl[0];
    return {
      revenue: Number(current?.revenue ?? 0),
      cogs: Number(current?.cogs ?? 0),
      opex: Number(current?.operating_expenses ?? 0),
      gross: Number(current?.gross_profit ?? 0),
      net: Number(current?.net_profit ?? 0),
    };
  }, [pnl]);

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={canWrite && (
          <>
            {categories.length === 0 && (
              <button onClick={() => void seed()} disabled={seeding} className="btn-ghost">
                {seeding ? 'Seeding…' : 'Seed categories'}
              </button>
            )}
            {view !== 'pnl' && (
              <button
                onClick={() => setCreating(view === 'revenue' ? 'income' : 'expense')}
                disabled={categories.length === 0}
                className="btn-primary"
              >
                {view === 'revenue' ? 'Record income' : 'Record expense'}
              </button>
            )}
          </>
        )}
      />

      <ErrorNote message={error} />

      {view === 'pnl' ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure label="Revenue" value={totals.revenue} currency={currency} />
            <Figure label="COGS" value={totals.cogs} currency={currency} muted />
            <Figure label="Gross profit" value={totals.gross} currency={currency}
                    percent={marginPercent(totals.gross, totals.revenue)} />
            <Figure label="Net profit" value={totals.net} currency={currency}
                    percent={marginPercent(totals.net, totals.revenue)} accent />
          </div>

          <Panel>
            <Table
              head={
                <>
                  <Th>Month</Th>
                  <Th right>Revenue</Th>
                  <Th right>COGS</Th>
                  <Th right>Gross</Th>
                  <Th right>Operating</Th>
                  <Th right>Net</Th>
                  <Th right>Net margin</Th>
                </>
              }
            >
              {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
              {!loading && pnl.length === 0 && (
                <EmptyRow colSpan={7}>
                  Nothing recorded yet. Payments post revenue automatically; expenses are entered
                  here.
                </EmptyRow>
              )}
              {pnl.map((m) => {
                const net = marginPercent(Number(m.net_profit), Number(m.revenue));
                return (
                  <Row key={m.month}>
                    <Td className="whitespace-nowrap text-slate-300">
                      {new Date(m.month).toLocaleDateString(undefined,
                        { month: 'long', year: 'numeric' })}
                    </Td>
                    <Td right><Money value={m.revenue ?? 0} currency={currency} /></Td>
                    <Td right className="text-slate-500">
                      <Money value={m.cogs ?? 0} currency={currency} />
                    </Td>
                    <Td right><Money value={m.gross_profit ?? 0} currency={currency} /></Td>
                    <Td right className="text-slate-500">
                      <Money value={m.operating_expenses ?? 0} currency={currency} />
                    </Td>
                    <Td right>
                      <span className={Number(m.net_profit) < 0 ? 'text-red-400' : 'text-mint'}>
                        <Money value={m.net_profit ?? 0} currency={currency} />
                      </span>
                    </Td>
                    <Td right className="tabular text-slate-400">
                      {net === null ? '—' : `${net.toFixed(1)}%`}
                    </Td>
                  </Row>
                );
              })}
            </Table>
          </Panel>
        </div>
      ) : (
        <Panel>
          <Table
            head={
              <>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th right>Amount</Th>
              </>
            }
          >
            {loading && <EmptyRow colSpan={4}>Loading…</EmptyRow>}
            {!loading && rows.length === 0 && (
              <EmptyRow colSpan={4}>
                {categories.length === 0
                  ? 'Seed the finance categories to start recording.'
                  : 'Nothing recorded yet.'}
              </EmptyRow>
            )}
            {rows.map((t) => (
              <Row key={t.id}>
                <Td className="whitespace-nowrap text-slate-500">
                  {new Date(t.occurred_on).toLocaleDateString()}
                </Td>
                <Td className="text-slate-300">{t.description ?? '—'}</Td>
                <Td>
                  <Badge tone={t.direction === 'income' ? 'mint' : 'slate'}>
                    {t.category?.name ?? 'Uncategorised'}
                  </Badge>
                  {t.category?.is_cogs && (
                    <span className="ml-1.5 text-[10px] text-slate-600">COGS</span>
                  )}
                </Td>
                <Td right>
                  <span className={t.direction === 'income' ? 'text-mint' : 'text-slate-300'}>
                    {t.direction === 'income' ? '+' : '−'}
                    <Money value={t.amount} currency={currency} />
                  </span>
                </Td>
              </Row>
            ))}
          </Table>
        </Panel>
      )}

      {creating && (
        <TransactionModal
          direction={creating}
          categories={categories.filter((c) => c.direction === creating)}
          onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); void load(); }}
        />
      )}
    </div>
  );
}

function Figure({
  label, value, currency, percent, muted = false, accent = false,
}: {
  label: string;
  value: number;
  currency: string;
  percent?: number | null;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="card accent-rule relative overflow-hidden">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`tabular mt-2 text-xl font-semibold ${
        accent ? (value < 0 ? 'text-red-400' : 'text-mint')
          : muted ? 'text-slate-400' : 'text-slate-100'
      }`}>
        <Money value={value} currency={currency} />
      </p>
      {percent !== undefined && (
        <p className="mt-1 text-xs text-slate-500">
          {percent === null ? 'no revenue yet' : `${percent.toFixed(1)}% margin`}
        </p>
      )}
    </div>
  );
}

function TransactionModal({
  direction, categories, onClose, onSaved,
}: {
  direction: FinanceDirection;
  categories: FinanceCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === categoryId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('finance_transactions').insert({
      organization_id: activeOrg.id,
      category_id: categoryId || null,
      direction,
      amount: Number(amount) || 0,
      occurred_on: date,
      description: description.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={direction === 'income' ? 'Record income' : 'Record expense'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Category">
          <select required className="field" value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Amount (${currency})`}>
            <input required type="number" step="0.01" min="0.01" className="field" value={amount}
                   onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Date">
            <input required type="date" className="field" value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <input className="field" value={description}
                 onChange={(e) => setDescription(e.target.value)} />
        </Field>

        {category && (
          <p className="text-xs text-slate-500">
            {category.is_cogs
              ? 'Counted in cost of goods sold, so it reduces gross profit.'
              : direction === 'expense'
                ? 'Counted as an operating expense, below gross profit.'
                : 'Counted as revenue.'}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Record'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
