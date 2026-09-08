import { useCallback, useEffect, useState } from 'react';
import type { CostProfile } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function CostProfiles() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('pricing.manage') || can('org.manage');

  const [rows, setRows] = useState<CostProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CostProfile | 'new' | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('cost_profiles')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('name');
    if (err) setError(err.message);
    else setRows((data ?? []) as CostProfile[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function seed() {
    if (!activeOrg) return;
    setSeeding(true);
    setError(null);
    const { error: err } = await supabase.rpc('seed_cost_profiles', { p_org: activeOrg.id });
    if (err) setError(err.message);
    await load();
    setSeeding(false);
  }

  return (
    <div>
      <PageHeader
        title="Cost profiles"
        subtitle="Every rate the costing formula needs. A quote records the profile it used, so past figures never change."
        actions={editable && (
          <>
            {rows.length === 0 && (
              <button onClick={() => void seed()} disabled={seeding} className="btn-ghost">
                {seeding ? 'Seeding…' : 'Seed defaults'}
              </button>
            )}
            <button onClick={() => setEditing('new')} className="btn-primary">New profile</button>
          </>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Profile</Th>
              <Th right>Target margin</Th>
              <Th right>Minimum</Th>
              <Th right>Failure</Th>
              <Th right>Machine/h</Th>
              <Th right>Labour/h</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>
              No cost profiles yet. Seed the defaults from §97 to get started.
            </EmptyRow>
          )}
          {rows.map((p) => (
            <Row key={p.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{p.name}</span>
                  {p.is_default && <Badge tone="mint">Default</Badge>}
                </div>
                {p.description && (
                  <div className="mt-0.5 text-xs text-slate-500">{p.description}</div>
                )}
              </Td>
              <Td right className="tabular">{p.target_margin_percent}%</Td>
              <Td right className="tabular text-slate-500">{p.minimum_margin_percent}%</Td>
              <Td right className="tabular text-slate-500">{p.failure_rate_percent}%</Td>
              <Td right className="tabular">{currency} {p.machine_rate_per_hour}</Td>
              <Td right className="tabular">{currency} {p.labor_rate_per_hour}</Td>
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
        <ProfileModal
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function ProfileModal({
  profile, onClose, onSaved,
}: { profile: CostProfile | null; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [form, setForm] = useState({
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    electricity_rate_per_kwh: String(profile?.electricity_rate_per_kwh ?? 12),
    machine_rate_per_hour: String(profile?.machine_rate_per_hour ?? 20),
    labor_rate_per_hour: String(profile?.labor_rate_per_hour ?? 120),
    labor_minutes_per_job: String(profile?.labor_minutes_per_job ?? 10),
    packaging_cost: String(profile?.packaging_cost ?? 15),
    consumables_cost: String(profile?.consumables_cost ?? 5),
    delivery_cost: String(profile?.delivery_cost ?? 0),
    failure_rate_percent: String(profile?.failure_rate_percent ?? 5),
    platform_fee_percent: String(profile?.platform_fee_percent ?? 0),
    target_margin_percent: String(profile?.target_margin_percent ?? 60),
    minimum_margin_percent: String(profile?.minimum_margin_percent ?? 25),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const marginsInverted =
    Number(form.minimum_margin_percent) > Number(form.target_margin_percent);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const payload = {
      organization_id: activeOrg.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      electricity_rate_per_kwh: Number(form.electricity_rate_per_kwh) || 0,
      machine_rate_per_hour: Number(form.machine_rate_per_hour) || 0,
      labor_rate_per_hour: Number(form.labor_rate_per_hour) || 0,
      labor_minutes_per_job: Number(form.labor_minutes_per_job) || 0,
      packaging_cost: Number(form.packaging_cost) || 0,
      consumables_cost: Number(form.consumables_cost) || 0,
      delivery_cost: Number(form.delivery_cost) || 0,
      failure_rate_percent: Number(form.failure_rate_percent) || 0,
      platform_fee_percent: Number(form.platform_fee_percent) || 0,
      target_margin_percent: Number(form.target_margin_percent) || 0,
      minimum_margin_percent: Number(form.minimum_margin_percent) || 0,
    };

    const { error: err } = profile
      ? await supabase.from('cost_profiles').update(payload).eq('id', profile.id)
      : await supabase.from('cost_profiles').insert(payload);

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={profile ? `Edit ${profile.name}` : 'New cost profile'}
           onClose={onClose} width="w-[560px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <Field label="Name">
          <input required className="field" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Description">
          <input className="field" value={form.description} onChange={set('description')} />
        </Field>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <p className="label mb-3">Rates</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={`Electricity / kWh (${currency})`}>
              <input type="number" step="0.01" min="0" className="field"
                     value={form.electricity_rate_per_kwh}
                     onChange={set('electricity_rate_per_kwh')} />
            </Field>
            <Field label={`Machine / hour (${currency})`}>
              <input type="number" step="0.01" min="0" className="field"
                     value={form.machine_rate_per_hour} onChange={set('machine_rate_per_hour')} />
            </Field>
            <Field label={`Labour / hour (${currency})`}>
              <input type="number" step="0.01" min="0" className="field"
                     value={form.labor_rate_per_hour} onChange={set('labor_rate_per_hour')} />
            </Field>
            <Field label="Labour minutes per job"
                   hint="Handling time, not print time — the operator does not watch the printer.">
              <input type="number" step="1" min="0" className="field"
                     value={form.labor_minutes_per_job} onChange={set('labor_minutes_per_job')} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <p className="label mb-3">Per job</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Packaging">
              <input type="number" step="0.01" min="0" className="field"
                     value={form.packaging_cost} onChange={set('packaging_cost')} />
            </Field>
            <Field label="Consumables">
              <input type="number" step="0.01" min="0" className="field"
                     value={form.consumables_cost} onChange={set('consumables_cost')} />
            </Field>
            <Field label="Delivery">
              <input type="number" step="0.01" min="0" className="field"
                     value={form.delivery_cost} onChange={set('delivery_cost')} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-ink-950/50 p-4">
          <p className="label mb-3">Margin & risk</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Target margin %"
                   hint="Share of the selling price, not a markup on cost.">
              <input required type="number" step="0.5" min="0" max="99" className="field"
                     value={form.target_margin_percent} onChange={set('target_margin_percent')} />
            </Field>
            <Field label="Minimum margin %" hint="The floor a quote may not fall below.">
              <input required type="number" step="0.5" min="0" max="99" className="field"
                     value={form.minimum_margin_percent} onChange={set('minimum_margin_percent')} />
            </Field>
            <Field label="Failure rate %" hint="Risk allowance applied to every job (§25).">
              <input required type="number" step="0.5" min="0" max="99" className="field"
                     value={form.failure_rate_percent} onChange={set('failure_rate_percent')} />
            </Field>
            <Field label="Platform fee %" hint="Taken out of the price, so it is funded not absorbed.">
              <input type="number" step="0.5" min="0" max="99" className="field"
                     value={form.platform_fee_percent} onChange={set('platform_fee_percent')} />
            </Field>
          </div>
          {marginsInverted && (
            <p className="mt-3 text-xs text-amber-300">
              Minimum margin is above the target, which the database rejects.
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || marginsInverted} className="btn-primary">
            {busy ? 'Saving…' : profile ? 'Save changes' : 'Create profile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
