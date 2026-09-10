import { useCallback, useEffect, useState } from 'react';
import type { MaintenanceKind, MaintenanceRecord, Printer } from '@crafcube/types';
import { MAINTENANCE_KINDS, MAINTENANCE_KIND_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';
import { Figure } from '@/components/analytics';

interface Record_ extends MaintenanceRecord {
  printer: Pick<Printer, 'name'> | null;
}

export function Maintenance() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('printers.write');

  const [rows, setRows] = useState<Record_[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [records, machines] = await Promise.all([
      supabase.from('maintenance_records')
        .select('*, printer:printers(name)')
        .eq('organization_id', activeOrg.id)
        .order('performed_on', { ascending: false })
        .limit(200),
      supabase.from('printers').select('*')
        .eq('organization_id', activeOrg.id)
        .neq('status', 'retired').order('name'),
    ]);
    if (records.error) setError(records.error.message);
    else setRows((records.data ?? []) as unknown as Record_[]);
    if (!machines.error) setPrinters((machines.data ?? []) as Printer[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0);
  const totalDowntime = rows.reduce((sum, r) => sum + Number(r.downtime_hours), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((r) => r.next_due_on !== null && r.next_due_on < today);
  const upcoming = rows
    .filter((r) => r.next_due_on !== null && r.next_due_on >= today)
    .sort((a, b) => (a.next_due_on as string).localeCompare(b.next_due_on as string));

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Downtime and cost per machine, which is what printer utilisation and ROI are measured against."
        actions={editable && printers.length > 0 && (
          <button onClick={() => setLogging(true)} className="btn-primary">Log maintenance</button>
        )}
      />

      <ErrorNote message={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Figure label="Total spent" value={<Money value={totalCost} currency={currency} />} />
        <Figure label="Downtime logged" value={`${totalDowntime.toFixed(1)}h`} tone="muted" />
        <Figure
          label="Next service"
          value={upcoming[0]
            ? new Date(upcoming[0].next_due_on as string).toLocaleDateString()
            : '—'}
          hint={overdue.length > 0
            ? `${overdue.length} overdue`
            : upcoming[0]?.printer?.name ?? 'nothing scheduled'}
          tone={overdue.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Panel>
        <Table
          head={
            <>
              <Th>Date</Th>
              <Th>Printer</Th>
              <Th>Kind</Th>
              <Th>What was done</Th>
              <Th right>Downtime</Th>
              <Th right>Cost</Th>
              <Th right>Next due</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>
              Nothing logged yet. Recorded maintenance is what makes utilisation and machine cost
              believable.
            </EmptyRow>
          )}
          {rows.map((r) => {
            const isOverdue = r.next_due_on !== null && r.next_due_on < today;
            return (
              <Row key={r.id}>
                <Td className="whitespace-nowrap text-slate-500">
                  {new Date(r.performed_on).toLocaleDateString()}
                </Td>
                <Td className="text-slate-200">{r.printer?.name ?? '—'}</Td>
                <Td><Badge>{MAINTENANCE_KIND_LABELS[r.kind]}</Badge></Td>
                <Td className="text-slate-400">{r.description ?? '—'}</Td>
                <Td right className="text-slate-400">
                  {Number(r.downtime_hours) === 0 ? '—' : `${Number(r.downtime_hours)}h`}
                </Td>
                <Td right className="text-slate-300">
                  <Money value={r.cost} currency={currency} />
                </Td>
                <Td right className="whitespace-nowrap">
                  {r.next_due_on === null
                    ? <span className="text-slate-600">—</span>
                    : (
                      <span className={isOverdue ? 'text-amber-300' : 'text-slate-400'}>
                        {new Date(r.next_due_on).toLocaleDateString()}
                      </span>
                    )}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {logging && (
        <MaintenanceModal
          printers={printers}
          onClose={() => setLogging(false)}
          onSaved={() => { setLogging(false); void load(); }}
        />
      )}
    </div>
  );
}

function MaintenanceModal({
  printers, onClose, onSaved,
}: {
  printers: Printer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [printerId, setPrinterId] = useState(printers[0]?.id ?? '');
  const [kind, setKind] = useState<MaintenanceKind>('routine');
  const [performedOn, setPerformedOn] = useState(new Date().toISOString().slice(0, 10));
  const [downtime, setDowntime] = useState('');
  const [cost, setCost] = useState('');
  const [description, setDescription] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('maintenance_records').insert({
      organization_id: activeOrg.id,
      printer_id: printerId,
      kind,
      performed_on: performedOn,
      downtime_hours: Number(downtime) || 0,
      cost: Number(cost) || 0,
      description: description.trim() || null,
      next_due_on: nextDue || null,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="Log maintenance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <Field label="Printer">
          <select required className="field" value={printerId}
                  onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Kind">
            <select className="field" value={kind}
                    onChange={(e) => setKind(e.target.value as MaintenanceKind)}>
              {MAINTENANCE_KINDS.map((k) => (
                <option key={k} value={k}>{MAINTENANCE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input required type="date" className="field" value={performedOn}
                   onChange={(e) => setPerformedOn(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Downtime (hours)" hint="Hours the machine could not print.">
            <input type="number" min="0" step="0.25" className="field" value={downtime}
                   onChange={(e) => setDowntime(e.target.value)} />
          </Field>
          <Field label={`Cost (${currency})`} hint="Parts and labour.">
            <input type="number" min="0" step="0.01" className="field" value={cost}
                   onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>

        <Field label="What was done">
          <textarea className="field h-16 resize-none" value={description}
                    onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label="Next due" hint="Optional. Overdue services are flagged on this screen.">
          <input type="date" className="field" value={nextDue}
                 onChange={(e) => setNextDue(e.target.value)} />
        </Field>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
