import { useCallback, useEffect, useState } from 'react';
import type { Consumable, ConsumableTransaction } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function Consumables() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('inventory.write');

  const [rows, setRows] = useState<Consumable[]>([]);
  const [history, setHistory] = useState<ConsumableTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Consumable | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [items, ledger] = await Promise.all([
      supabase.from('consumables').select('*')
        .eq('organization_id', activeOrg.id).order('name'),
      supabase.from('consumable_transactions').select('*')
        .eq('organization_id', activeOrg.id)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (items.error) setError(items.error.message);
    else setRows((items.data ?? []) as Consumable[]);
    if (!ledger.error) setHistory((ledger.data ?? []) as ConsumableTransaction[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Consumables"
        subtitle="Nozzles, adhesive, bags and tape. Stock moves through a ledger, exactly as filament does."
        actions={editable && (
          <button onClick={() => setCreating(true)} className="btn-primary">New consumable</button>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Item</Th>
              <Th right>On hand</Th>
              <Th right>Reorder at</Th>
              <Th right>Unit cost</Th>
              <Th right>Stock value</Th>
              <Th>Supplier</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>Nothing tracked yet.</EmptyRow>
          )}
          {rows.map((c) => {
            const low = c.reorder_point !== null && Number(c.on_hand) <= Number(c.reorder_point);
            return (
              <Row key={c.id}>
                <Td className="font-medium text-slate-200">
                  {c.name}
                  {low && <Badge tone="amber"><span className="ml-0">Low</span></Badge>}
                </Td>
                <Td right>
                  <span className={low ? 'text-amber-300' : 'text-slate-300'}>
                    {Number(c.on_hand).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="ml-1 text-slate-600">{c.unit}</span>
                  </span>
                </Td>
                <Td right className="text-slate-500">
                  {c.reorder_point === null ? '—' : Number(c.reorder_point).toFixed(0)}
                </Td>
                <Td right className="text-slate-400">
                  <Money value={c.unit_cost} currency={currency} />
                </Td>
                <Td right className="text-slate-300">
                  <Money value={Number(c.on_hand) * Number(c.unit_cost)} currency={currency} />
                </Td>
                <Td className="text-slate-500">{c.supplier ?? '—'}</Td>
                <Td right>
                  {editable && (
                    <button onClick={() => setMoving(c)}
                            className="whitespace-nowrap text-xs text-mint hover:text-mint-500">
                      Move stock
                    </button>
                  )}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Recent movements</h2>
        <Panel>
          <Table head={<><Th>When</Th><Th>Item</Th><Th>Reason</Th><Th right>Change</Th></>}>
            {history.length === 0 && <EmptyRow colSpan={4}>No movements yet.</EmptyRow>}
            {history.map((t) => (
              <Row key={t.id}>
                <Td className="whitespace-nowrap text-slate-500">
                  {new Date(t.created_at).toLocaleString()}
                </Td>
                <Td className="text-slate-300">{nameOf(t.consumable_id)}</Td>
                <Td className="text-slate-500">{t.reason ?? '—'}</Td>
                <Td right>
                  <span className={Number(t.quantity) > 0 ? 'text-mint' : 'text-slate-300'}>
                    {Number(t.quantity) > 0 ? '+' : ''}{Number(t.quantity)}
                  </span>
                </Td>
              </Row>
            ))}
          </Table>
        </Panel>
        <p className="mt-2 text-xs text-slate-600">
          On-hand is reconciled from these rows and cannot be typed in directly — the same rule
          that keeps spool balances honest.
        </p>
      </section>

      {creating && (
        <ConsumableModal onClose={() => setCreating(false)}
                         onSaved={() => { setCreating(false); void load(); }} />
      )}
      {moving && (
        <MovementModal item={moving} onClose={() => setMoving(null)}
                       onSaved={() => { setMoving(null); void load(); }} />
      )}
    </div>
  );
}

function ConsumableModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [reorderPoint, setReorderPoint] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('consumables').insert({
      organization_id: activeOrg.id,
      name: name.trim(),
      unit: unit.trim() || 'pcs',
      reorder_point: reorderPoint === '' ? null : Number(reorderPoint),
      unit_cost: Number(unitCost) || 0,
      supplier: supplier.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New consumable" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} autoFocus
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Unit" hint="pcs, ml, m, roll…">
            <input className="field" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Reorder at">
            <input type="number" min="0" step="1" className="field" value={reorderPoint}
                   onChange={(e) => setReorderPoint(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Unit cost (${currency})`}>
            <input type="number" min="0" step="0.01" className="field" value={unitCost}
                   onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
          <Field label="Supplier">
            <input className="field" value={supplier}
                   onChange={(e) => setSupplier(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Stock starts at zero. Add what you have with a movement, so the opening balance is a
          ledger entry like every other change.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MovementModal({
  item, onClose, onSaved,
}: {
  item: Consumable;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { activeOrg } = useSession();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const magnitude = Number(quantity) || 0;
  const change = direction === 'in' ? magnitude : -magnitude;
  const after = Number(item.on_hand) + change;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('consumable_transactions').insert({
      organization_id: activeOrg.id,
      consumable_id: item.id,
      quantity: change,
      unit_cost: direction === 'in' ? item.unit_cost : null,
      reason: reason.trim() || (direction === 'in' ? 'Restock' : 'Used'),
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={`Move stock · ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <Field label="Direction">
          <select className="field" value={direction}
                  onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
            <option value="in">Received</option>
            <option value="out">Used</option>
          </select>
        </Field>
        <Field label={`Quantity (${item.unit})`}>
          <input required type="number" min="0.001" step="0.001" className="field"
                 value={quantity} autoFocus onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder={direction === 'in' ? 'Restock' : 'Used'} />
        </Field>

        <p className="text-xs text-slate-500">
          On hand {Number(item.on_hand)} → <span className={after < 0 ? 'text-amber-300' : ''}>
            {after}
          </span> {item.unit}
          {after < 0 && ' — this would take stock negative, which usually means a movement is missing.'}
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Recording…' : 'Record movement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
