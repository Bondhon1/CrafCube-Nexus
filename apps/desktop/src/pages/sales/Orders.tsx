import { useCallback, useEffect, useState } from 'react';
import type {
  Customer, OrderBalance, OrderItem, OrderStatus, PaymentMethod, Product,
} from '@crafcube/types';
import {
  NEXT_ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, paymentState,
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
  /** Empty for a one-off line; set links the sale to product profitability. */
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

const EMPTY_LINE: DraftLine = {
  productId: '', description: '', quantity: '1', unitPrice: '', unitCost: '',
};

function OrderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
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

  /** Picking a product fills the line, but every field stays editable — the
   *  list price is a starting point, not something the operator is stuck with. */
  function pickProduct(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setLine(index, { productId: '' });
      return;
    }
    setLine(index, {
      productId,
      description: lines[index].description.trim() || product.name,
      unitPrice: lines[index].unitPrice || (product.list_price ?? '').toString(),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

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

      const usable = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
      if (usable.length > 0) {
        const { error: itemErr } = await supabase.from('order_items').insert(
          usable.map((l) => ({
            organization_id: activeOrg.id,
            order_id: (order as { id: string }).id,
            product_id: l.productId || null,
            description: l.description.trim(),
            quantity: Number(l.quantity) || 1,
            unit_price: Number(l.unitPrice) || 0,
            unit_cost: Number(l.unitCost) || 0,
          } satisfies Partial<OrderItem> & { organization_id: string; order_id: string })),
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

  return (
    <Modal title="New order" onClose={onClose} width="w-[min(700px,92vw)]">
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

          <div className="mt-3 space-y-2">
            {lines.map((line, index) => (
              <div key={index}
                   className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_56px_84px_84px_28px] items-center gap-2">
                <select
                  className="field py-1.5 text-xs" value={line.productId}
                  onChange={(e) => pickProduct(index, e.target.value)}
                  aria-label={`Item ${index + 1} product`}
                >
                  <option value="">One-off</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  className="field py-1.5 text-xs" placeholder="Dragon — Black PLA"
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
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Unit cost comes from a quote and is stored on the line, so profit stays true even
            after prices change.
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
