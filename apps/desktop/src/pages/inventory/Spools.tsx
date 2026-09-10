import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FilamentProduct, FilamentSpool, InventoryTxnType, SpoolStatus } from '@crafcube/types';
import { SPOOL_STATUS_LABELS, TXN_DIRECTION, TXN_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Grams, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface SpoolRow extends FilamentSpool {
  product: Pick<FilamentProduct, 'id' | 'name' | 'color_hex'> | null;
}

const STATUS_TONE: Record<SpoolStatus, 'mint' | 'amber' | 'slate'> = {
  in_use: 'mint',
  sealed: 'slate',
  empty: 'amber',
  retired: 'slate',
};

export function Spools() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const canEdit = can('inventory.write');
  // Operators may record stock movements even though they cannot define stock.
  const canMove = can('production.write') || canEdit;

  const [rows, setRows] = useState<SpoolRow[]>([]);
  const [products, setProducts] = useState<FilamentProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<SpoolRow | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [spools, prods] = await Promise.all([
      supabase
        .from('filament_spools')
        .select('*, product:filament_products(id, name, color_hex)')
        .eq('organization_id', activeOrg.id)
        .order('created_at', { ascending: false }),
      supabase.from('filament_products').select('*').eq('organization_id', activeOrg.id).order('name'),
    ]);
    if (spools.error) setError(spools.error.message);
    else setRows((spools.data ?? []) as unknown as SpoolRow[]);
    if (!prods.error) setProducts((prods.data ?? []) as FilamentProduct[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => rows.filter((r) => showRetired || (r.status !== 'retired' && r.status !== 'empty')),
    [rows, showRetired],
  );

  return (
    <div>
      <PageHeader
        title="Spools"
        subtitle="Every physical spool is its own inventory item with its own landed cost."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={showRetired}
                     onChange={(e) => setShowRetired(e.target.checked)} />
              Show empty & retired
            </label>
            {canEdit && (
              <button onClick={() => setCreating(true)} disabled={products.length === 0}
                      title={products.length === 0 ? 'Create a filament first' : undefined}
                      data-tour="spool-new"
                      className="btn-primary">
                New spool
              </button>
            )}
          </>
        }
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Code</Th>
              <Th>Filament</Th>
              <Th>Status</Th>
              <Th right>Remaining</Th>
              <Th right>Reserved</Th>
              <Th right>Cost/g</Th>
              <Th right>Landed cost</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && visible.length === 0 && (
            <EmptyRow colSpan={8}>
              {products.length === 0
                ? 'Create a filament product before registering spools.'
                : 'No spools yet.'}
            </EmptyRow>
          )}
          {visible.map((s) => {
            const pct = Number(s.initial_grams) > 0
              ? Math.max(0, Math.min(100, (Number(s.remaining_grams) / Number(s.initial_grams)) * 100))
              : 0;
            return (
              <Row key={s.id}>
                <Td><span className="font-mono text-xs text-slate-300">{s.code}</span></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full border border-white/20"
                          style={{ background: s.product?.color_hex ?? 'transparent' }} />
                    {s.product?.name ?? '—'}
                  </div>
                </Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{SPOOL_STATUS_LABELS[s.status]}</Badge></Td>
                <Td right>
                  <Grams value={s.remaining_grams} />
                  <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
                  </div>
                </Td>
                <Td right className="text-slate-500">
                  {Number(s.reserved_grams) > 0 ? <Grams value={s.reserved_grams} /> : '—'}
                </Td>
                <Td right>{Number(s.cost_per_gram).toFixed(3)}</Td>
                <Td right><Money value={s.landed_cost} currency={currency} /></Td>
                <Td right>
                  {canMove && (
                    <button onClick={() => setMoving(s)}
                            className="text-xs text-mint transition-colors hover:text-mint-500">
                      Record…
                    </button>
                  )}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <NewSpoolModal products={products} onClose={() => setCreating(false)}
                       onSaved={() => { setCreating(false); void load(); }} />
      )}
      {moving && (
        <MovementModal spool={moving} onClose={() => setMoving(null)}
                       onSaved={() => { setMoving(null); void load(); }} />
      )}
    </div>
  );
}

function NewSpoolModal({
  products, onClose, onSaved,
}: { products: FilamentProduct[]; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [grams, setGrams] = useState('1000');
  const [productCost, setProductCost] = useState('');
  const [shipping, setShipping] = useState('0');
  const [tax, setTax] = useState('0');
  const [other, setOther] = useState('0');
  const [supplier, setSupplier] = useState('');
  const [lot, setLot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the generated columns so the cost is visible before saving (§8).
  const landed = [productCost, shipping, tax, other].reduce((a, v) => a + (Number(v) || 0), 0);
  const perGram = Number(grams) > 0 ? landed / Number(grams) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('filament_spools').insert({
      organization_id: activeOrg.id,
      product_id: productId,
      code: code.trim(),
      initial_grams: Number(grams),
      product_cost: Number(productCost) || 0,
      shipping_cost: Number(shipping) || 0,
      tax_cost: Number(tax) || 0,
      other_cost: Number(other) || 0,
      supplier: supplier.trim() || null,
      lot_code: lot.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="Register spool" onClose={onClose} width="w-[520px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Filament">
          <select required className="field" value={productId}
                  onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Spool code">
            <input required className="field font-mono" value={code} placeholder="PLA-BLK-001"
                   onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
          </Field>
          <Field label="Filament weight (g)">
            <input required type="number" step="0.001" min="0.001" className="field"
                   value={grams} onChange={(e) => setGrams(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <p className="label mb-3">Landed cost</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Product">
              <input required type="number" step="0.01" min="0" className="field"
                     value={productCost} onChange={(e) => setProductCost(e.target.value)} />
            </Field>
            <Field label="Shipping">
              <input type="number" step="0.01" min="0" className="field"
                     value={shipping} onChange={(e) => setShipping(e.target.value)} />
            </Field>
            <Field label="Tax">
              <input type="number" step="0.01" min="0" className="field"
                     value={tax} onChange={(e) => setTax(e.target.value)} />
            </Field>
            <Field label="Other">
              <input type="number" step="0.01" min="0" className="field"
                     value={other} onChange={(e) => setOther(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
            <span className="text-slate-400">
              Landed <Money value={landed} currency={currency} />
            </span>
            <span className="font-medium text-mint">
              {perGram.toFixed(3)} {currency}/g
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Supplier">
            <input className="field" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Lot / batch">
            <input className="field" value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Register spool'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Types an operator records by hand; job consumption is written by Phase 4. */
const MANUAL_TYPES: InventoryTxnType[] = [
  'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'RETURN', 'SAMPLE', 'DRYING_LOSS',
];

function MovementModal({
  spool, onClose, onSaved,
}: { spool: SpoolRow; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [type, setType] = useState<InventoryTxnType>('CONSUMPTION');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const direction = TXN_DIRECTION[type];
  const magnitude = Number(amount) || 0;
  // ADJUSTMENT is the one case where the operator's sign is meaningful.
  const signed = direction === 'remove' ? -Math.abs(magnitude)
    : direction === 'add' ? Math.abs(magnitude)
    : magnitude;
  const projected = Number(spool.remaining_grams) + signed;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('filament_transactions').insert({
      organization_id: activeOrg.id,
      spool_id: spool.id,
      type,
      grams: signed,
      reason: reason.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={`Record movement · ${spool.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Type">
          <select className="field" value={type}
                  onChange={(e) => setType(e.target.value as InventoryTxnType)}>
            {MANUAL_TYPES.map((t) => <option key={t} value={t}>{TXN_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field
          label={direction === 'either' ? 'Change (g, may be negative)' : 'Amount (g)'}
          hint={direction === 'either'
            ? 'Use a negative value to reduce the spool, positive to increase it.'
            : undefined}
        >
          <input required type="number" step="0.001" className="field" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus
                 min={direction === 'either' ? undefined : 0} />
        </Field>
        <Field label="Reason">
          <input className="field" value={reason} placeholder="Manual weight measurement"
                 onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="flex justify-between rounded-lg border border-line bg-ink-950/50 px-4 py-3 text-sm">
          <span className="text-slate-400">
            Now <Grams value={spool.remaining_grams} />
          </span>
          <span className={projected < 0 ? 'text-red-400' : 'text-mint'}>
            After <Grams value={projected} />
          </span>
        </div>
        {projected < 0 && (
          <p className="text-xs text-amber-300">
            This takes the spool below zero. Record an adjustment instead if you are correcting a
            measurement.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || magnitude === 0} className="btn-primary">
            {busy ? 'Recording…' : 'Record'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
