import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StockForecast } from '@crafcube/types';
import { reorderAdvice, stockLevel } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { Badge, ErrorNote, Field, Grams, Modal, PageHeader } from '@/components/ui';
import { Figure, NotEnoughData } from '@/components/analytics';
import { RankedBars } from '@/components/charts';

const LEVEL_TONE = {
  critical: 'red',
  warning: 'amber',
  ok: 'mint',
  unknown: 'slate',
} as const;

const LEVEL_LABEL = {
  critical: 'Critical',
  warning: 'Low',
  ok: 'Healthy',
  unknown: 'No threshold',
} as const;

/** The shared threshold check measures a balance; here that is what is free to use. */
function levelOf(row: StockForecast) {
  return stockLevel({
    remaining_grams: row.available_g,
    warn_grams: row.warn_grams,
    critical_grams: row.critical_grams,
  });
}

export function LowStock() {
  const { activeOrg, can } = useSession();
  const editable = can('inventory.write');

  const [rows, setRows] = useState<StockForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockForecast | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('filament_stock_forecast')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('available_g', { ascending: true });
    if (err) setError(err.message);
    else setRows((data ?? []) as StockForecast[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const advised = useMemo(() => rows.map((row) => ({
    row,
    level: levelOf(row),
    advice: reorderAdvice(row),
  })), [rows]);

  const toOrder = advised.filter((a) => a.advice.reorder);
  const alerting = advised.filter((a) => a.level === 'critical' || a.level === 'warning');
  const unmeasured = advised.filter((a) => a.row.daily_usage_g === null);
  // Only filaments with real usage can be ranked by days of cover.
  const measured = advised.filter((a) => a.row.days_remaining !== null);

  return (
    <div>
      <PageHeader
        title="Low stock"
        subtitle="Thresholds say what is low; usage and lead time say what to actually order (§12)."
      />

      <ErrorNote message={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3" data-tour="lowstock-summary">
        <Figure label="Below threshold" value={String(alerting.length)}
                tone={alerting.length > 0 ? 'warn' : 'muted'} />
        <Figure label="Reorder advised" value={String(toOrder.length)}
                tone={toOrder.length > 0 ? 'warn' : 'muted'} />
        <Figure label="No usage data" value={String(unmeasured.length)}
                hint="nothing consumed in 30 days" tone="muted" />
      </div>

      {/* Days of cover is the number that decides what to buy, so it gets the
          comparison rather than another row of figures. */}
      {measured.length > 0 && (
        <div className="mb-6">
          <RankedBars
            title="Days of stock left"
            subtitle="From what each filament actually used over the last 30 days."
            format={(v) => `${v.toFixed(1)} days`}
            points={measured
              .slice()
              .sort((a, b) => Number(a.row.days_remaining) - Number(b.row.days_remaining))
              .map((a) => ({
                label: a.row.name, value: Number(a.row.days_remaining),
              }))}
          />
        </div>
      )}

      {loading && <NotEnoughData>Loading…</NotEnoughData>}
      {!loading && rows.length === 0 && (
        <NotEnoughData>No filament products yet.</NotEnoughData>
      )}

      <div className="space-y-3">
        {advised.map(({ row, level, advice }) => (
          <div key={row.product_id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  {row.color_hex && (
                    <span className="h-3 w-3 shrink-0 rounded-full border border-white/20"
                          style={{ background: row.color_hex }} />
                  )}
                  {row.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">{advice.reason}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
                {editable && (
                  <button onClick={() => setEditing(row)}
                          className="whitespace-nowrap text-xs text-slate-400 hover:text-mint">
                    Reorder rules
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
              <Stat label="Available"><Grams value={row.available_g} /></Stat>
              <Stat label="Reserved"><Grams value={row.reserved_g} /></Stat>
              <Stat label="Per day">
                {row.daily_usage_g === null
                  ? <span className="text-slate-600">unknown</span>
                  : <Grams value={row.daily_usage_g} />}
              </Stat>
              <Stat label="Days left">
                {row.days_remaining === null
                  ? <span className="text-slate-600">—</span>
                  : Number(row.days_remaining).toFixed(1)}
              </Stat>
            </div>

            {advice.reorder && (
              <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                <p className="text-sm text-amber-200">
                  Order {((advice.quantityGrams ?? 0) / 1000).toFixed(1)} kg
                  {advice.orderWithinDays === 0
                    ? ' now'
                    : ` within ${advice.orderWithinDays} day${
                      advice.orderWithinDays === 1 ? '' : 's'}`}.
                </p>
                {row.supplier && (
                  <p className="mt-0.5 text-xs text-amber-200/60">Supplier: {row.supplier}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <ReorderRulesModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">{label}</p>
      <p className="tabular mt-0.5 text-slate-300">{children}</p>
    </div>
  );
}

function ReorderRulesModal({
  row, onClose, onSaved,
}: {
  row: StockForecast;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [warn, setWarn] = useState(row.warn_grams?.toString() ?? '');
  const [critical, setCritical] = useState(row.critical_grams?.toString() ?? '');
  const [leadTime, setLeadTime] = useState(row.lead_time_days?.toString() ?? '');
  const [safety, setSafety] = useState(row.safety_stock_g?.toString() ?? '');
  const [reorderQty, setReorderQty] = useState(row.reorder_qty_g?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = (text: string) => (text.trim() === '' ? null : Number(text));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error: err } = await supabase
      .from('filament_products')
      .update({
        warn_grams: number(warn),
        critical_grams: number(critical),
        lead_time_days: number(leadTime),
        safety_stock_g: number(safety),
        reorder_qty_g: number(reorderQty),
      })
      .eq('id', row.product_id);

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title={`Reorder rules · ${row.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Warn below (g)">
            <input type="number" min="0" step="1" className="field" value={warn}
                   onChange={(e) => setWarn(e.target.value)} autoFocus />
          </Field>
          <Field label="Critical below (g)">
            <input type="number" min="0" step="1" className="field" value={critical}
                   onChange={(e) => setCritical(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Lead time (days)" hint="How long the supplier takes.">
            <input type="number" min="0" max="365" step="1" className="field" value={leadTime}
                   onChange={(e) => setLeadTime(e.target.value)} />
          </Field>
          <Field label="Safety stock (g)" hint="What you refuse to drop below.">
            <input type="number" min="0" step="1" className="field" value={safety}
                   onChange={(e) => setSafety(e.target.value)} />
          </Field>
        </div>

        <Field label="Spool size (g)" hint="Orders are rounded up to whole spools.">
          <input type="number" min="1" step="1" className="field" value={reorderQty}
                 onChange={(e) => setReorderQty(e.target.value)} placeholder="1000" />
        </Field>

        <p className="text-xs text-slate-500">
          Leave a field blank to leave it unset. Without a threshold this filament reports "no
          threshold" rather than being assumed healthy.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Save rules'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
