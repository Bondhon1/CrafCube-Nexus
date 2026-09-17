import { useCallback, useEffect, useState } from 'react';
import type {
  CatalogEntry, CustomBuild, Customer, OrderBalance, OrderItem, OrderStatus, PaymentMethod, Product,
} from '@crafcube/types';
import {
  findByCode, normalizeProductCode, NEXT_ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, paymentState,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

const STATUS_TONE: Record<OrderStatus, 'mint' | 'amber' | 'red' | 'slate'> = {
  DRAFT: 'slate',
  CONFIRMED: 'amber',
  IN_PRODUCTION: 'amber',
  READY: 'mint',
  DELIVERED: 'mint',
  CANCELLED: 'red',
};

const PAYMENT_TONE = {
  unpaid: 'red',
  partial: 'amber',
  paid: 'mint',
  overpaid: 'amber',
} as const;

export function Orders() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const canSell = can('sales.write');
  const canSeeMoney = can('finance.read') || can('sales.write');

  const [rows, setRows] = useState<OrderBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<OrderBalance | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('order_balances')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setRows((data ?? []) as OrderBalance[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function move(order: OrderBalance, status: OrderStatus) {
    setError(null);
    const patch: Record<string, unknown> = { status };
    if (status === 'DELIVERED') patch.delivered_at = new Date().toISOString();
    const { error: err } = await supabase.from('orders').update(patch).eq('id', order.order_id);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Total is what the order is worth; paid is cash received. They are not the same number."
        actions={canSell && (
          <button onClick={() => setCreating(true)} data-tour="order-new"
                  className="btn-primary">New order</button>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th right>Total</Th>
              {canSeeMoney && <Th right>Paid</Th>}
              {canSeeMoney && <Th right>Profit</Th>}
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>No orders yet.</EmptyRow>
          )}
          {rows.map((o) => {
            const total = Number(o.total);
            const paid = Number(o.paid);
            const state = paymentState(total, paid);
            const next = NEXT_ORDER_STATUSES[o.status];
            return (
              <Row key={o.order_id}>
                <Td>
                  <div className="whitespace-nowrap font-mono text-xs text-slate-300">{o.code}</div>
                  <div className="whitespace-nowrap text-[11px] text-slate-600">
                    {new Date(o.created_at).toLocaleDateString()}
                  </div>
                </Td>
                <Td className="text-slate-300">{o.customer_name ?? '—'}</Td>
                <Td><Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></Td>
                <Td right><Money value={total} currency={currency} /></Td>
                {canSeeMoney && (
                  <Td right>
                    <Money value={paid} currency={currency} />
                    <div className="mt-0.5">
                      <Badge tone={PAYMENT_TONE[state]}>
                        {state === 'partial'
                          ? `${currency} ${Number(o.balance).toFixed(0)} owed`
                          : state}
                      </Badge>
                    </div>
                  </Td>
                )}
                {canSeeMoney && (
                  <Td right>
                    <span className={Number(o.gross_profit) < 0 ? 'text-red-400' : 'text-slate-300'}>
                      <Money value={o.gross_profit} currency={currency} />
                    </span>
                    <div className="text-[11px] text-slate-600">
                      cost <Money value={o.cost} currency={currency} />
                    </div>
                  </Td>
                )}
                <Td right>
                  <div className="flex items-center justify-end gap-2">
                    {canSell && next.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) void move(o, e.target.value as OrderStatus);
                        }}
                        className="rounded-md border border-line bg-ink-950 px-2 py-1 text-xs"
                        aria-label={`Advance ${o.code}`}
                      >
                        <option value="">Move to…</option>
                        {next.map((s) => (
                          <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    )}
                    {canSell && state !== 'paid' && o.status !== 'CANCELLED' && (
                      <button onClick={() => setPaying(o)}
                              className="whitespace-nowrap text-xs text-mint transition-colors hover:text-mint-500">
                        Payment
                      </button>
                    )}
                  </div>
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <OrderModal onClose={() => setCreating(false)}
                    onSaved={() => { setCreating(false); void load(); }} />
      )}
      {paying && (
        <PaymentModal order={paying} onClose={() => setPaying(null)}
                      onSaved={() => { setPaying(null); void load(); }} />
      )}
    </div>
  );
}

interface DraftLine {
  /** The product code the line is sold by. Blank for a one-off line. */
  code: string;
  /** For a custom design: which customer's build, if it exists yet. */
  buildId: string;
  description: string;
  /** What the code filled in, so a new code replaces it but a typed description is kept. */
  autoDescription: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

const EMPTY_LINE: DraftLine = {
  code: '', buildId: '', description: '', autoDescription: '', quantity: '1', unitPrice: '', unitCost: '',
};

type BuildOption = Pick<CustomBuild, 'id' | 'design_id' | 'title'>;

function OrderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    void supabase.from('customers').select('*').eq('organization_id', activeOrg.id)
      .eq('archived', false).order('name')
      .then(({ data }) => setCustomers((data ?? []) as Customer[]));
    void supabase.from('products').select('*').eq('organization_id', activeOrg.id)
      .eq('active', true).order('name')
      .then(({ data }) => setProducts((data ?? []) as Product[]));
    void supabase.from('product_catalog').select('*').eq('organization_id', activeOrg.id)
      .eq('archived', false).order('product_code')
      .then(({ data }) => setCatalog((data ?? []) as CatalogEntry[]));
    void supabase.from('custom_builds').select('id, design_id, title')
      .eq('organization_id', activeOrg.id).neq('status', 'archived')
      .order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => setBuilds((data ?? []) as BuildOption[]));
  }, [activeOrg]);

  const subtotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0,
  );
  const cost = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0,
  );
  const total = Math.max(subtotal - (Number(discount) || 0) + (Number(delivery) || 0), 0);
  const profit = total - cost;

  function setLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /** The product a library model sells as, for its list price and profitability. */
  function productFor(entry: CatalogEntry | undefined): Product | undefined {
    return entry?.model_id ? products.find((p) => p.model_id === entry.model_id) : undefined;
  }

  function keepsTypedDescription(line: DraftLine): boolean {
    return line.description.trim() !== '' && line.description !== line.autoDescription;
  }

  /** Typing a code fills the line; every field stays editable afterwards. */
  function typeCode(index: number, code: string) {
    const line = lines[index];
    const entry = findByCode(catalog, code);
    const auto = entry?.name ?? '';
    setLine(index, {
      code,
      buildId: '',
      autoDescription: auto,
      description: keepsTypedDescription(line) ? line.description : auto,
      unitPrice: line.unitPrice || (productFor(entry)?.list_price ?? '').toString(),
    });
  }

  function pickBuild(index: number, buildId: string) {
    const line = lines[index];
    const entry = findByCode(catalog, line.code);
    const build = builds.find((b) => b.id === buildId);
    const auto = build && entry ? `${entry.name} — ${build.title}` : entry?.name ?? '';
    setLine(index, {
      buildId,
      autoDescription: auto,
      description: keepsTypedDescription(line) ? line.description : auto,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setError(null);

    const usable = lines.filter((l) => (l.description.trim() || l.code.trim()) && Number(l.quantity) > 0);
    const unknown = usable.find((l) => l.code.trim() && !findByCode(catalog, l.code));
    if (unknown) {
      setError(`No product has the code ${normalizeProductCode(unknown.code)}.`);
      return;
    }
    setBusy(true);

    try {
      const { data: code, error: codeErr } = await supabase.rpc('next_order_code', {
        p_org: activeOrg.id,
      });
      if (codeErr) throw new Error(codeErr.message);

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          organization_id: activeOrg.id,
          customer_id: customerId || null,
          code,
          status: 'DRAFT',
          discount: Number(discount) || 0,
          delivery_charge: Number(delivery) || 0,
          due_date: dueDate || null,
        })
        .select()
        .single();
      if (orderErr) throw new Error(orderErr.message);

      if (usable.length > 0) {
        const { error: itemErr } = await supabase.from('order_items').insert(
          usable.map((l) => {
            const entry = findByCode(catalog, l.code);
            return {
              organization_id: activeOrg.id,
              order_id: (order as { id: string }).id,
              // The database resolves the code to its model or design.
              product_code: normalizeProductCode(l.code),
              product_id: productFor(entry)?.id ?? null,
              custom_build_id: entry?.kind === 'custom' ? l.buildId || null : null,
              description: l.description.trim() || entry?.name || 'Item',
              quantity: Number(l.quantity) || 1,
              unit_price: Number(l.unitPrice) || 0,
              unit_cost: Number(l.unitCost) || 0,
            } satisfies Partial<OrderItem> & { organization_id: string; order_id: string };
          }),
        );
        if (itemErr) throw new Error(itemErr.message);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const columns = 'grid grid-cols-[96px_minmax(0,1fr)_56px_84px_84px_28px] gap-2';

  return (
    <Modal title="New order" onClose={onClose} width="w-[min(760px,92vw)]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Customer">
            <select className="field" value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Walk-in</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className="field" value={dueDate}
                   onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <div className="flex items-center justify-between">
            <p className="label mb-0">Items</p>
            <button type="button" className="btn-ghost px-3 py-1 text-xs"
                    onClick={() => setLines((c) => [...c, EMPTY_LINE])}>
              Add line
            </button>
          </div>

          {/* Suggestions as a code is typed: C00 lists every C00xx with its name. */}
          <datalist id="product-codes">
            {catalog.map((c) => (
              <option key={c.product_code} value={c.product_code}>
                {c.name}{c.kind === 'custom' ? ' (custom)' : ''}
              </option>
            ))}
          </datalist>

          <div className={`mt-3 ${columns} text-[11px] uppercase tracking-wide text-slate-600`}>
            <span>Code</span><span>Description</span><span>Qty</span><span>Price</span><span>Cost</span><span />
          </div>

          <div className="mt-1 space-y-2">
            {lines.map((line, index) => {
              const entry = findByCode(catalog, line.code);
              const typed = line.code.trim() !== '';
              const designBuilds = entry?.kind === 'custom'
                ? builds.filter((b) => b.design_id === entry.custom_design_id)
                : [];
              return (
                <div key={index}>
                  <div className={`${columns} items-center`}>
                    <input
                      list="product-codes"
                      className={`field py-1.5 font-mono text-xs uppercase ${
                        typed && !entry ? 'border-red-500/60' : ''}`}
                      placeholder="C0001" value={line.code}
                      onChange={(e) => typeCode(index, e.target.value)}
                      aria-label={`Item ${index + 1} product code`}
                    />
                    <input
                      className="field py-1.5 text-xs" placeholder={typed ? '' : 'One-off item'}
                      value={line.description}
                      onChange={(e) => setLine(index, { description: e.target.value })}
                      aria-label={`Item ${index + 1} description`}
                    />
                    <input
                      type="number" min="1" className="field py-1.5 text-xs" value={line.quantity}
                      onChange={(e) => setLine(index, { quantity: e.target.value })}
                      aria-label={`Item ${index + 1} quantity`}
                    />
                    <input
                      type="number" step="0.01" min="0" className="field py-1.5 text-xs"
                      placeholder="price" value={line.unitPrice}
                      onChange={(e) => setLine(index, { unitPrice: e.target.value })}
                      aria-label={`Item ${index + 1} unit price`}
                    />
                    <input
                      type="number" step="0.01" min="0" className="field py-1.5 text-xs"
                      placeholder="cost" value={line.unitCost}
                      onChange={(e) => setLine(index, { unitCost: e.target.value })}
                      aria-label={`Item ${index + 1} unit cost`}
                    />
                    <button
                      type="button" aria-label={`Remove item ${index + 1}`}
                      onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                      disabled={lines.length === 1}
                      className="text-slate-600 transition-colors hover:text-red-400 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                  {typed && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-1 text-[11px]">
                      {!entry && <span className="text-red-400">No product has this code.</span>}
                      {entry?.kind === 'model' && (
                        <span className="text-slate-500">{entry.name} · library model</span>
                      )}
                      {entry?.kind === 'custom' && (
                        <>
                          <span className="text-slate-500">{entry.name} · custom design</span>
                          <select
                            className="rounded-md border border-line bg-ink-950 px-2 py-0.5 text-[11px]"
                            value={line.buildId} onChange={(e) => pickBuild(index, e.target.value)}
                            aria-label={`Item ${index + 1} build`}
                          >
                            <option value="">Build not made yet</option>
                            {designBuilds.map((b) => (
                              <option key={b.id} value={b.id}>{b.title}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Type a product code to fill the line, or leave it blank for a one-off. Unit cost is
            stored on the line, so profit stays true even after prices change.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={`Discount (${currency})`}>
            <input type="number" step="0.01" min="0" className="field" value={discount}
                   onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label={`Delivery (${currency})`}>
            <input type="number" step="0.01" min="0" className="field" value={delivery}
                   onChange={(e) => setDelivery(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Total</span>
            <span className="tabular text-lg font-semibold text-slate-100">
              <Money value={total} currency={currency} />
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Cost {cost.toFixed(2)}</span>
            <span className={profit < 0 ? 'text-red-400' : 'text-mint'}>
              Profit {profit.toFixed(2)}
              {total > 0 && ` · ${((profit / total) * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({
  order, onClose, onSaved,
}: { order: OrderBalance; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [amount, setAmount] = useState(String(Number(order.balance).toFixed(2)));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.rpc('record_payment', {
      p_order: order.order_id,
      p_amount: Number(amount) || 0,
      p_method: method,
      p_reference: reference.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  const remaining = Number(order.balance) - (Number(amount) || 0);

  return (
    <Modal title={`Payment · ${order.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Order total</span>
            <span className="tabular text-slate-300">
              <Money value={order.total} currency={currency} />
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-500">Already paid</span>
            <span className="tabular text-slate-300">
              <Money value={order.paid} currency={currency} />
            </span>
          </div>
        </div>

        <Field label={`Amount (${currency})`}>
          <input required type="number" step="0.01" min="0.01" className="field" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method">
          <select className="field" value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference" hint="Transaction id, cheque number, or however you track it.">
          <input className="field" value={reference}
                 onChange={(e) => setReference(e.target.value)} />
        </Field>

        <p className="text-xs text-slate-500">
          {remaining > 0.01
            ? `${currency} ${remaining.toFixed(2)} will remain outstanding.`
            : remaining < -0.01
              ? `This overpays by ${currency} ${Math.abs(remaining).toFixed(2)}.`
              : 'This settles the order.'}
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
