import { useCallback, useEffect, useState } from 'react';
import type { FilamentStock, Material } from '@crafcube/types';
import { stockLevel } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Grams, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function Filaments() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('inventory.write');

  const [rows, setRows] = useState<FilamentStock[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [stock, mats] = await Promise.all([
      supabase.from('filament_stock').select('*').eq('organization_id', activeOrg.id).order('name'),
      supabase.from('materials').select('*').eq('organization_id', activeOrg.id).order('name'),
    ]);
    if (stock.error) setError(stock.error.message);
    else setRows((stock.data ?? []) as FilamentStock[]);
    if (!mats.error) setMaterials((mats.data ?? []) as Material[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function seedCatalog() {
    if (!activeOrg) return;
    setSeeding(true);
    setError(null);
    const { error: err } = await supabase.rpc('seed_default_catalog', { p_org: activeOrg.id });
    if (err) setError(err.message);
    await load();
    setSeeding(false);
  }

  const noMaterials = materials.length === 0;

  return (
    <div>
      <PageHeader
        title="Filaments"
        subtitle="Stock is rolled up across every active spool of each product."
        actions={
          editable && (
            <>
              {noMaterials && (
                <button onClick={() => void seedCatalog()} disabled={seeding} className="btn-ghost">
                  {seeding ? 'Seeding…' : 'Seed materials & Kobra X'}
                </button>
              )}
              <button
                onClick={() => setCreating(true)}
                disabled={noMaterials}
                title={noMaterials ? 'Seed or add a material first' : undefined}
                className="btn-primary"
              >
                New filament
              </button>
            </>
          )
        }
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Filament</Th>
              <Th>Material</Th>
              <Th right>Spools</Th>
              <Th right>Remaining</Th>
              <Th right>Reserved</Th>
              <Th right>Avg cost/g</Th>
              <Th right>Stock value</Th>
              <Th>Level</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No filament products yet.
              {editable && noMaterials && ' Seed the default materials to get started.'}
            </EmptyRow>
          )}
          {rows.map((r) => {
            const level = stockLevel(r);
            return (
              <Row key={r.product_id}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                      style={{ background: r.color_hex ?? 'transparent' }}
                    />
                    <div>
                      <div className="font-medium text-slate-200">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        {[r.brand_name, r.color_name, `${r.diameter_mm} mm`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>{r.material_name}</Td>
                <Td right>{r.active_spools}</Td>
                <Td right><Grams value={r.remaining_grams} /></Td>
                <Td right className="text-slate-500">
                  {Number(r.reserved_grams) > 0 ? <Grams value={r.reserved_grams} /> : '—'}
                </Td>
                <Td right>
                  {r.weighted_cost_per_gram != null
                    ? Number(r.weighted_cost_per_gram).toFixed(3)
                    : '—'}
                </Td>
                <Td right><Money value={r.stock_value} currency={currency} /></Td>
                <Td>
                  {level === 'critical' && <Badge tone="red">Critical</Badge>}
                  {level === 'warning' && <Badge tone="amber">Low</Badge>}
                  {level === 'ok' && <Badge tone="mint">OK</Badge>}
                  {/* No threshold is not the same as healthy — say which it is. */}
                  {level === 'unknown' && <Badge>No threshold</Badge>}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <NewFilamentModal
          materials={materials}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}
    </div>
  );
}

function NewFilamentModal({
  materials,
  onClose,
  onSaved,
}: {
  materials: Material[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [name, setName] = useState('');
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '');
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('#22c58b');
  const [diameter, setDiameter] = useState('1.75');
  const [warn, setWarn] = useState('300');
  const [critical, setCritical] = useState('100');
  const [supplier, setSupplier] = useState('');

  // Opening stock. Most filament is added because a spool was just bought, so
  // the quantity and what it cost belong here rather than in a second trip.
  const [addSpool, setAddSpool] = useState(true);
  const [grams, setGrams] = useState('1000');
  const [spoolCode, setSpoolCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [productCost, setProductCost] = useState('');
  const [shipping, setShipping] = useState('0');
  const [tax, setTax] = useState('0');
  const [other, setOther] = useState('0');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the generated columns so the real cost is visible before saving (§8).
  const landed = [productCost, shipping, tax, other].reduce((a, v) => a + (Number(v) || 0), 0);
  const perGram = Number(grams) > 0 ? landed / Number(grams) : 0;

  // Suggest a code from material + colour. The RPC recomputes it on insert, so
  // this is only a preview and cannot collide with a concurrent registration.
  useEffect(() => {
    if (codeTouched || !addSpool || !activeOrg || !materialId) return;
    let cancelled = false;
    void supabase
      .rpc('suggest_spool_code', {
        p_org: activeOrg.id,
        p_material: materialId,
        p_color: colorName || null,
      })
      .then(({ data }) => {
        if (!cancelled && typeof data === 'string') setSpoolCode(data);
      });
    return () => { cancelled = true; };
  }, [activeOrg, materialId, colorName, codeTouched, addSpool]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.rpc('create_filament_with_spool', {
      p_org: activeOrg.id,
      p_material: materialId,
      p_name: name.trim(),
      p_color_name: colorName.trim() || null,
      p_color_hex: colorHex,
      p_diameter: Number(diameter),
      p_warn: warn === '' ? null : Number(warn),
      p_critical: critical === '' ? null : Number(critical),
      p_supplier: supplier.trim() || null,
      p_spool_grams: addSpool ? Number(grams) : null,
      p_spool_code: addSpool ? spoolCode.trim() || null : null,
      p_product_cost: Number(productCost) || 0,
      p_shipping: Number(shipping) || 0,
      p_tax: Number(tax) || 0,
      p_other: Number(other) || 0,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New filament" onClose={onClose} width="w-[560px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} placeholder="eSUN PLA+ Black"
                 onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Material">
          <select required className="field" value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.density} g/cm³</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Colour name">
            <input className="field" value={colorName} placeholder="Black"
                   onChange={(e) => setColorName(e.target.value)} />
          </Field>
          <Field label="Colour">
            <input type="color" className="field h-[42px] p-1" value={colorHex}
                   onChange={(e) => setColorHex(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Diameter (mm)">
            <input required type="number" step="0.01" min="0.1" className="field"
                   value={diameter} onChange={(e) => setDiameter(e.target.value)} />
          </Field>
          <Field label="Warn at (g)">
            <input type="number" min="0" className="field" value={warn}
                   onChange={(e) => setWarn(e.target.value)} />
          </Field>
          <Field label="Critical (g)">
            <input type="number" min="0" className="field" value={critical}
                   onChange={(e) => setCritical(e.target.value)} />
          </Field>
        </div>
        <Field label="Supplier" hint="Leave thresholds blank to disable low-stock alerts.">
          <input className="field" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-200">
            <input type="checkbox" checked={addSpool}
                   onChange={(e) => setAddSpool(e.target.checked)} />
            Add the first spool now
          </label>

          {addSpool ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Field label="Weight (g)">
                  <input required type="number" step="0.001" min="0.001" className="field"
                         value={grams} onChange={(e) => setGrams(e.target.value)} />
                </Field>
                <Field label="Spool code">
                  <input required className="field font-mono" value={spoolCode}
                         onChange={(e) => { setCodeTouched(true); setSpoolCode(e.target.value.toUpperCase()); }} />
                </Field>
              </div>

              <p className="label mt-4">What it cost</p>
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
                <span className="font-medium text-mint">{perGram.toFixed(3)} {currency}/g</span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              The filament is created with no stock. Register spools later from Inventory → Spools.
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : addSpool ? 'Create & add stock' : 'Create filament'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
