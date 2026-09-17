import { useCallback, useEffect, useState } from 'react';
import type { ProductProfitability } from '@crafcube/types';
import { marginPercent } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface ModelOption { id: string; name: string; product_code: string }

export function Products() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('sales.write');

  const [rows, setRows] = useState<ProductProfitability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('product_profitability')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('gross_profit', { ascending: false });
    if (err) setError(err.message);
    else setRows((data ?? []) as ProductProfitability[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Profit uses the cost snapshotted on each order line, so past sales keep their own numbers."
        actions={editable && (
          <button onClick={() => setCreating(true)} className="btn-primary">New product</button>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th right>List price</Th>
              <Th right>Units sold</Th>
              <Th right>Revenue</Th>
              <Th right>Cost</Th>
              <Th right>Gross profit</Th>
              <Th right>Margin</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No products yet. Add one to track what it earns across orders.
            </EmptyRow>
          )}
          {rows.map((p) => {
            const margin = marginPercent(Number(p.gross_profit), Number(p.revenue));
            const sold = Number(p.units_sold) > 0;
            return (
              <Row key={p.product_id}>
                <Td className="font-medium text-slate-200">
                  {p.name}
                  {!p.active && <span className="ml-2 text-xs text-slate-600">inactive</span>}
                </Td>
                <Td className="font-mono text-xs text-slate-500">{p.sku ?? '—'}</Td>
                <Td right>
                  {p.list_price === null
                    ? <span className="text-slate-600">—</span>
                    : <Money value={p.list_price} currency={currency} />}
                </Td>
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
                  {/* No sales means no margin — 0% would read as "sold at cost". */}
                  {margin === null ? <span className="text-slate-600">{sold ? '—' : 'not sold'}</span>
                    : `${margin.toFixed(1)}%`}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <ProductModal onClose={() => setCreating(false)}
                      onSaved={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

function ProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [models, setModels] = useState<ModelOption[]>([]);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [modelId, setModelId] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    void supabase.from('models').select('id, name, product_code').eq('organization_id', activeOrg.id)
      .order('product_code').limit(500)
      .then(({ data }) => setModels((data ?? []) as ModelOption[]));
  }, [activeOrg]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('products').insert({
      organization_id: activeOrg.id,
      name: name.trim(),
      sku: sku.trim() || null,
      model_id: modelId || null,
      list_price: listPrice === '' ? null : Number(listPrice),
      description: description.trim() || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New product" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} autoFocus
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU">
            <input className="field" value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label={`List price (${currency})`} hint="Leave blank to quote each order.">
            <input type="number" step="0.01" min="0" className="field" value={listPrice}
                   onChange={(e) => setListPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Model" hint="Links the product to the file it is printed from.">
          <select className="field" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">None</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.product_code} · {m.name}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea className="field h-16 resize-none" value={description}
                    onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
