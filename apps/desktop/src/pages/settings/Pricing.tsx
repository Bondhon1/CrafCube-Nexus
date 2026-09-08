import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CostProfile, PriceRule, PriceRuleKind } from '@crafcube/types';
import { PRICE_RULE_KINDS, PRICE_RULE_LABELS, calculatePrice } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function Pricing() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('pricing.manage') || can('org.manage');

  const [profiles, setProfiles] = useState<CostProfile[]>([]);
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [profileId, setProfileId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Live calculator inputs, defaulted to the doc's worked example.
  const [grams, setGrams] = useState('100');
  const [hours, setHours] = useState('4');
  const [costPerGram, setCostPerGram] = useState('1.35');
  const [watts, setWatts] = useState('220');
  const [quantity, setQuantity] = useState('1');
  const [colors, setColors] = useState('1');

  const load = useCallback(async () => {
    if (!activeOrg) return;
    const [p, r] = await Promise.all([
      supabase.from('cost_profiles').select('*').eq('organization_id', activeOrg.id).order('name'),
      supabase.from('price_rules').select('*').eq('organization_id', activeOrg.id)
        .order('priority'),
    ]);
    if (p.error) setError(p.error.message);
    else {
      const list = (p.data ?? []) as CostProfile[];
      setProfiles(list);
      setProfileId((c) => c || list.find((x) => x.is_default)?.id || list[0]?.id || '');
    }
    if (!r.error) setRules((r.data ?? []) as PriceRule[]);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const profile = profiles.find((p) => p.id === profileId);

  const ratesUnset =
    profile !== undefined &&
    profile.electricity_rate_per_kwh === 0 &&
    profile.machine_rate_per_hour === 0 &&
    profile.labor_rate_per_hour === 0;

  const result = useMemo(() => {
    if (!profile) return null;
    return calculatePrice(
      {
        filamentGrams: Number(grams) || 0,
        printSeconds: (Number(hours) || 0) * 3600,
        costPerGram: Number(costPerGram) || 0,
        powerWatts: Number(watts) || 0,
        quantity: Number(quantity) || 1,
        colorCount: Number(colors) || 1,
      },
      profile,
      rules,
    );
  }, [profile, rules, grams, hours, costPerGram, watts, quantity, colors]);

  const money = (v: number) =>
    `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function toggleRule(rule: PriceRule) {
    const { error: err } = await supabase
      .from('price_rules').update({ active: !rule.active }).eq('id', rule.id);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        subtitle="Rules are data, not hidden logic — every adjustment shows what it did and why."
        actions={
          <>
            <select className="field w-40 sm:w-52" value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}>
              {profiles.length === 0 && <option value="">No cost profiles</option>}
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {editable && (
              <button onClick={() => setCreating(true)} className="btn-primary">New rule</button>
            )}
          </>
        }
      />

      <ErrorNote message={error} />

      {ratesUnset && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong className="font-medium">{profile?.name}</strong> has no machine, electricity or
          labour rate set, so quotes from it count material only and will read as profitable when
          they are not. Set its rates in Cost profiles.
        </div>
      )}

      {!profile ? (
        <div className="card text-sm text-slate-400">
          Create a cost profile first — pricing is calculated from its rates.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Try a job</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Filament (g)">
                <input type="number" className="field" value={grams}
                       onChange={(e) => setGrams(e.target.value)} />
              </Field>
              <Field label="Print time (h)">
                <input type="number" step="0.25" className="field" value={hours}
                       onChange={(e) => setHours(e.target.value)} />
              </Field>
              <Field label={`Cost / g (${currency})`}>
                <input type="number" step="0.01" className="field" value={costPerGram}
                       onChange={(e) => setCostPerGram(e.target.value)} />
              </Field>
              <Field label="Power (W)">
                <input type="number" className="field" value={watts}
                       onChange={(e) => setWatts(e.target.value)} />
              </Field>
              <Field label="Quantity">
                <input type="number" min="1" className="field" value={quantity}
                       onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field label="Colours">
                <input type="number" min="1" className="field" value={colors}
                       onChange={(e) => setColors(e.target.value)} />
              </Field>
            </div>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      Recommended price
                    </p>
                    <p className="tabular mt-1 text-3xl font-semibold text-mint">
                      {money(result.unitPrice)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      per unit · {result.quantity} × = {money(result.totalPrice)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Margin</p>
                    <p className="tabular mt-1 text-2xl font-semibold text-slate-100">
                      {result.marginPercent.toFixed(1)}%
                    </p>
                    <p className="tabular mt-1 text-xs text-slate-500">
                      profit {money(result.grossProfit)}
                    </p>
                  </div>
                </div>

                {result.warnings.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {result.warnings.map((w) => (
                      <li key={w} className="rounded-md border border-amber-500/30 bg-amber-500/10
                                             px-3 py-2 text-sm text-amber-200">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card">
                <h2 className="mb-3 text-sm font-semibold text-slate-200">
                  Cost breakdown <span className="font-normal text-slate-500">per unit</span>
                </h2>
                <dl className="space-y-1.5 text-sm">
                  <CostRow label="Material" value={money(result.cost.materialCost)} />
                  <CostRow label="Electricity" value={money(result.cost.electricityCost)} />
                  <CostRow label="Machine time" value={money(result.cost.machineCost)} />
                  <CostRow label="Labour" value={money(result.cost.laborCost)} />
                  <CostRow label="Consumables" value={money(result.cost.consumablesCost)} />
                  <CostRow label="Packaging" value={money(result.cost.packagingCost)} />
                  {result.cost.deliveryCost > 0 && (
                    <CostRow label="Delivery" value={money(result.cost.deliveryCost)} />
                  )}
                  <div className="border-t border-line pt-1.5">
                    <CostRow label="Direct cost" value={money(result.cost.directCost)} muted />
                  </div>
                  <CostRow
                    label={`Failure reserve (${profile.failure_rate_percent}%)`}
                    value={money(result.cost.failureReserve)}
                    muted
                  />
                  <div className="border-t border-line pt-1.5">
                    <CostRow label="True cost" value={money(result.cost.trueCost)} strong />
                  </div>
                  <CostRow
                    label={`Minimum price (${profile.minimum_margin_percent}% margin)`}
                    value={money(result.minimumPrice)}
                    muted
                  />
                </dl>
              </div>

              {result.appliedRules.length > 0 && (
                <div className="card">
                  <h2 className="mb-3 text-sm font-semibold text-slate-200">Rules applied</h2>
                  <ul className="space-y-2">
                    {result.appliedRules.map((r) => (
                      <li key={r.name} className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">{r.name}</span>
                        <span className="text-xs text-slate-500">{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Panel>
        <Table
          head={
            <>
              <Th>Rule</Th>
              <Th>Kind</Th>
              <Th right>Threshold</Th>
              <Th right>Value</Th>
              <Th right>Priority</Th>
              <Th>Status</Th>
            </>
          }
        >
          {rules.length === 0 && (
            <EmptyRow colSpan={6}>
              No pricing rules. The profile's target margin is used as-is.
            </EmptyRow>
          )}
          {rules.map((r) => (
            <Row key={r.id}>
              <Td className="font-medium text-slate-200">{r.name}</Td>
              <Td className="text-slate-400">{PRICE_RULE_LABELS[r.kind]}</Td>
              <Td right className="tabular text-slate-400">{r.threshold ?? '—'}</Td>
              <Td right className="tabular">{r.value}</Td>
              <Td right className="tabular text-slate-500">{r.priority}</Td>
              <Td>
                {editable ? (
                  <button onClick={() => void toggleRule(r)}
                          className="text-xs text-mint transition-colors hover:text-mint-500">
                    {r.active ? 'Active' : 'Inactive'}
                  </button>
                ) : (
                  <Badge tone={r.active ? 'mint' : 'slate'}>
                    {r.active ? 'Active' : 'Inactive'}
                  </Badge>
                )}
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {creating && (
        <RuleModal profiles={profiles} onClose={() => setCreating(false)}
                   onSaved={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

function CostRow({
  label, value, muted = false, strong = false,
}: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? 'text-slate-500' : strong ? 'text-slate-200' : 'text-slate-400'}>
        {label}
      </dt>
      <dd className={`tabular ${strong ? 'font-medium text-slate-100' : 'text-slate-300'}`}>
        {value}
      </dd>
    </div>
  );
}

/** Threshold and value mean different things per rule kind, so the form says so. */
const RULE_HELP: Record<PriceRuleKind, { threshold: string; value: string }> = {
  quantity_discount: { threshold: 'Applies at this quantity and above', value: 'Percent off' },
  multi_color_fee: { threshold: 'Unused', value: 'Charge per additional colour' },
  rush_fee: { threshold: 'Unused', value: 'Percent uplift' },
  margin_override: { threshold: 'Quantity at which it applies, or blank for always', value: 'Target margin %' },
  minimum_price: { threshold: 'Unused', value: 'Absolute price floor' },
};

function RuleModal({
  profiles, onClose, onSaved,
}: { profiles: CostProfile[]; onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PriceRuleKind>('quantity_discount');
  const [threshold, setThreshold] = useState('10');
  const [value, setValue] = useState('8');
  const [scope, setScope] = useState('');
  const [priority, setPriority] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usesThreshold = kind === 'quantity_discount' || kind === 'margin_override';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('price_rules').insert({
      organization_id: activeOrg.id,
      cost_profile_id: scope || null,
      name: name.trim(),
      kind,
      threshold: usesThreshold && threshold !== '' ? Number(threshold) : null,
      value: Number(value) || 0,
      priority: Number(priority) || 100,
    });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New pricing rule" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} placeholder="Bulk discount"
                 onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Kind">
          <select className="field" value={kind}
                  onChange={(e) => setKind(e.target.value as PriceRuleKind)}>
            {PRICE_RULE_KINDS.map((k) => (
              <option key={k} value={k}>{PRICE_RULE_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Threshold" hint={RULE_HELP[kind].threshold}>
            <input type="number" className="field" value={threshold} disabled={!usesThreshold}
                   onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Field label="Value" hint={RULE_HELP[kind].value}>
            <input required type="number" step="0.01" className="field" value={value}
                   onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Applies to">
            <select className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">All cost profiles</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Priority" hint="Lower runs first.">
            <input type="number" className="field" value={priority}
                   onChange={(e) => setPriority(e.target.value)} />
          </Field>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create rule'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
