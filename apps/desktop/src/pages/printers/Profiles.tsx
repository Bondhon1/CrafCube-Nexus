import { useCallback, useEffect, useState } from 'react';
import type { Printer, PrinterProfile } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function Profiles() {
  const { activeOrg, can } = useSession();
  const editable = can('printers.write');

  const [printers, setPrinters] = useState<Printer[]>([]);
  const [profiles, setProfiles] = useState<PrinterProfile[]>([]);
  const [printerId, setPrinterId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [pr, pf] = await Promise.all([
      supabase.from('printers').select('*').eq('organization_id', activeOrg.id).order('name'),
      supabase.from('printer_profiles').select('*').eq('organization_id', activeOrg.id).order('name'),
    ]);
    if (pr.error) setError(pr.error.message);
    else {
      const list = (pr.data ?? []) as Printer[];
      setPrinters(list);
      setPrinterId((current) => current || list[0]?.id || '');
    }
    if (!pf.error) setProfiles((pf.data ?? []) as PrinterProfile[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function makeDefault(profile: PrinterProfile) {
    // The partial unique index allows one default per printer, so clear first.
    const cleared = await supabase
      .from('printer_profiles')
      .update({ is_default: false })
      .eq('printer_id', profile.printer_id);
    if (cleared.error) { setError(cleared.error.message); return; }

    const { error: err } = await supabase
      .from('printer_profiles')
      .update({ is_default: true })
      .eq('id', profile.id);
    if (err) setError(err.message);
    await load();
  }

  const visible = profiles.filter((p) => p.printer_id === printerId);

  return (
    <div>
      <PageHeader
        title="Profiles"
        subtitle="Quality presets per printer. Phase 2 maps these onto real slicer profiles."
        actions={
          <>
            <select className="field w-56" value={printerId}
                    onChange={(e) => setPrinterId(e.target.value)}>
              {printers.length === 0 && <option value="">No printers</option>}
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {editable && (
              <button onClick={() => setCreating(true)} disabled={!printerId} className="btn-primary">
                New profile
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
              <Th>Profile</Th>
              <Th right>Nozzle</Th>
              <Th right>Layer</Th>
              <Th right>Infill</Th>
              <Th right>Walls</Th>
              <Th right>Speed</Th>
              <Th>Supports</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
          {!loading && visible.length === 0 && (
            <EmptyRow colSpan={8}>
              {printers.length === 0
                ? 'Add a printer before creating profiles.'
                : 'No profiles for this printer yet.'}
            </EmptyRow>
          )}
          {visible.map((p) => (
            <Row key={p.id}>
              <Td>
                <span className="font-medium text-slate-200">{p.name}</span>
                {p.is_default && <span className="ml-2"><Badge tone="mint">Default</Badge></span>}
              </Td>
              <Td right>{p.nozzle_mm} mm</Td>
              <Td right>{p.layer_height_mm} mm</Td>
              <Td right>{p.infill_percent}%</Td>
              <Td right>{p.wall_count}</Td>
              <Td right>{p.print_speed_mms ? `${p.print_speed_mms} mm/s` : '—'}</Td>
              <Td className="text-slate-400">{p.supports ? 'Auto' : 'Off'}</Td>
              <Td right>
                {editable && !p.is_default && (
                  <button onClick={() => void makeDefault(p)}
                          className="text-xs text-mint transition-colors hover:text-mint-500">
                    Make default
                  </button>
                )}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {creating && printerId && (
        <ProfileModal printerId={printerId} onClose={() => setCreating(false)}
                      onSaved={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

function ProfileModal({
  printerId, onClose, onSaved,
}: { printerId: string; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [name, setName] = useState('');
  const [nozzle, setNozzle] = useState('0.4');
  const [layer, setLayer] = useState('0.20');
  const [infill, setInfill] = useState('15');
  const [walls, setWalls] = useState('3');
  const [speed, setSpeed] = useState('300');
  const [supports, setSupports] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('printer_profiles').insert({
      organization_id: activeOrg.id,
      printer_id: printerId,
      name: name.trim(),
      nozzle_mm: Number(nozzle),
      layer_height_mm: Number(layer),
      infill_percent: Number(infill),
      wall_count: Number(walls),
      print_speed_mms: speed === '' ? null : Number(speed),
      supports,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New profile" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} placeholder="Standard 0.20"
                 onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Nozzle (mm)">
            <input required type="number" step="0.05" min="0.1" className="field"
                   value={nozzle} onChange={(e) => setNozzle(e.target.value)} />
          </Field>
          <Field label="Layer (mm)">
            <input required type="number" step="0.01" min="0.01" className="field"
                   value={layer} onChange={(e) => setLayer(e.target.value)} />
          </Field>
          <Field label="Speed (mm/s)">
            <input type="number" min="1" className="field" value={speed}
                   onChange={(e) => setSpeed(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Infill (%)">
            <input required type="number" min="0" max="100" className="field"
                   value={infill} onChange={(e) => setInfill(e.target.value)} />
          </Field>
          <Field label="Walls">
            <input required type="number" min="0" max="20" className="field"
                   value={walls} onChange={(e) => setWalls(e.target.value)} />
          </Field>
          <Field label="Supports">
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={supports}
                     onChange={(e) => setSupports(e.target.checked)} />
              Auto
            </label>
          </Field>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create profile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
