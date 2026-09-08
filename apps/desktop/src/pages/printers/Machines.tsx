import { useCallback, useEffect, useState } from 'react';
import type { Printer, PrinterStatus } from '@crafcube/types';
import { PRINTER_STATUS_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

const STATUS_TONE: Record<PrinterStatus, 'mint' | 'amber' | 'red' | 'slate'> = {
  idle: 'slate',
  printing: 'mint',
  paused: 'amber',
  maintenance: 'amber',
  offline: 'red',
  retired: 'slate',
};

export function Machines() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('printers.write');

  const [rows, setRows] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('printers')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('name');
    if (err) setError(err.message);
    else setRows((data ?? []) as Printer[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(printer: Printer, status: PrinterStatus) {
    const { error: err } = await supabase.from('printers').update({ status }).eq('id', printer.id);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Machines"
        subtitle="The printer registry. Nothing is hard-coded to one machine — add any brand."
        actions={editable && (
          <button onClick={() => setEditing('new')} className="btn-primary">New printer</button>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Printer</Th>
              <Th>Build volume</Th>
              <Th right>Colours</Th>
              <Th>Materials</Th>
              <Th right>Machine cost/h</Th>
              <Th>Status</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>
              No printers yet. Seed the default catalogue from Inventory → Filaments to add the
              Kobra X, or create one here.
            </EmptyRow>
          )}
          {rows.map((p) => (
            <Row key={p.id}>
              <Td>
                <div className="font-medium text-slate-200">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {[p.brand, p.model].filter(Boolean).join(' ') || '—'}
                </div>
              </Td>
              <Td className="text-slate-400">
                {p.build_x_mm ? `${p.build_x_mm} × ${p.build_y_mm} × ${p.build_z_mm} mm` : '—'}
              </Td>
              <Td right>{p.color_slots}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {p.supported_materials.length === 0
                    ? <span className="text-slate-600">—</span>
                    : p.supported_materials.map((m) => <Badge key={m}>{m}</Badge>)}
                </div>
              </Td>
              <Td right><Money value={p.hourly_machine_cost} currency={currency} /></Td>
              <Td>
                {editable ? (
                  <select
                    value={p.status}
                    onChange={(e) => void setStatus(p, e.target.value as PrinterStatus)}
                    className="rounded-md border border-line bg-ink-950 px-2 py-1 text-xs"
                  >
                    {(Object.keys(PRINTER_STATUS_LABELS) as PrinterStatus[]).map((s) => (
                      <option key={s} value={s}>{PRINTER_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={STATUS_TONE[p.status]}>{PRINTER_STATUS_LABELS[p.status]}</Badge>
                )}
              </Td>
              <Td right>
                {editable && (
                  <button onClick={() => setEditing(p)}
                          className="text-xs text-mint transition-colors hover:text-mint-500">
                    Edit
                  </button>
                )}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {editing && (
        <PrinterModal
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function PrinterModal({
  printer, onClose, onSaved,
}: { printer: Printer | null; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [name, setName] = useState(printer?.name ?? '');
  const [brand, setBrand] = useState(printer?.brand ?? '');
  const [model, setModel] = useState(printer?.model ?? '');
  const [x, setX] = useState(String(printer?.build_x_mm ?? 260));
  const [y, setY] = useState(String(printer?.build_y_mm ?? 260));
  const [z, setZ] = useState(String(printer?.build_z_mm ?? 260));
  const [slots, setSlots] = useState(String(printer?.color_slots ?? 1));
  const [watts, setWatts] = useState(String(printer?.power_watts ?? ''));
  const [hourly, setHourly] = useState(String(printer?.hourly_machine_cost ?? 0));
  const [materials, setMaterials] = useState((printer?.supported_materials ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const payload = {
      organization_id: activeOrg.id,
      name: name.trim(),
      brand: brand.trim() || null,
      model: model.trim() || null,
      build_x_mm: Number(x) || null,
      build_y_mm: Number(y) || null,
      build_z_mm: Number(z) || null,
      color_slots: Number(slots) || 1,
      power_watts: watts === '' ? null : Number(watts),
      hourly_machine_cost: Number(hourly) || 0,
      supported_materials: materials
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    };

    const { error: err } = printer
      ? await supabase.from('printers').update(payload).eq('id', printer.id)
      : await supabase.from('printers').insert(payload);

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={printer ? `Edit ${printer.name}` : 'New printer'} onClose={onClose} width="w-[520px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} placeholder="Kobra X"
                 onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand">
            <input className="field" value={brand} placeholder="Anycubic"
                   onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Model">
            <input className="field" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
        </div>
        <Field label="Build volume (mm)">
          <div className="flex items-center gap-2">
            <input type="number" className="field" value={x} onChange={(e) => setX(e.target.value)} />
            <span className="text-slate-600">×</span>
            <input type="number" className="field" value={y} onChange={(e) => setY(e.target.value)} />
            <span className="text-slate-600">×</span>
            <input type="number" className="field" value={z} onChange={(e) => setZ(e.target.value)} />
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Colour slots">
            <input type="number" min="1" className="field" value={slots}
                   onChange={(e) => setSlots(e.target.value)} />
          </Field>
          <Field label="Power (W)">
            <input type="number" min="0" className="field" value={watts}
                   onChange={(e) => setWatts(e.target.value)} />
          </Field>
          <Field label="Machine cost/h">
            <input type="number" step="0.01" min="0" className="field" value={hourly}
                   onChange={(e) => setHourly(e.target.value)} />
          </Field>
        </div>
        <Field label="Supported materials" hint="Comma separated, e.g. PLA, PETG, TPU.">
          <input className="field" value={materials} onChange={(e) => setMaterials(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : printer ? 'Save changes' : 'Create printer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
