import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS, stockLevel, type FilamentStock } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { CURRENT_PHASE } from '@/app/navigation';
import { CurrencyIcon, OrgIcon, RoleIcon, WorkspaceIcon } from '@/components/icons';

interface Snapshot {
  models: number;
  printers: number;
  printersIdle: number;
  spools: number;
  filamentGrams: number;
  stockValue: number;
  lowStock: FilamentStock[];
}

export function Dashboard() {
  const { activeOrg, role, memberships } = useSession();
  const currency = activeOrg?.currency ?? '';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;

    void (async () => {
      const [models, printers, spools, stock] = await Promise.all([
        supabase.from('models').select('id', { count: 'exact', head: true })
          .eq('organization_id', activeOrg.id).eq('archived', false),
        supabase.from('printers').select('status').eq('organization_id', activeOrg.id),
        supabase.from('filament_spools').select('remaining_grams, status')
          .eq('organization_id', activeOrg.id),
        supabase.from('filament_stock').select('*').eq('organization_id', activeOrg.id),
      ]);
      if (cancelled) return;

      const printerRows = (printers.data ?? []) as { status: string }[];
      const spoolRows = (spools.data ?? []) as { remaining_grams: number; status: string }[];
      const stockRows = (stock.data ?? []) as FilamentStock[];
      const active = spoolRows.filter((s) => s.status === 'sealed' || s.status === 'in_use');

      setSnapshot({
        models: models.count ?? 0,
        printers: printerRows.length,
        printersIdle: printerRows.filter((p) => p.status === 'idle').length,
        spools: active.length,
        filamentGrams: active.reduce((sum, s) => sum + Number(s.remaining_grams), 0),
        stockValue: stockRows.reduce((sum, r) => sum + Number(r.stock_value), 0),
        lowStock: stockRows.filter((r) => stockLevel(r) !== 'ok'),
      });
    })();

    return () => { cancelled = true; };
  }, [activeOrg]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-[11px] tracking-[0.22em] text-slate-500">OPERATIONS OVERVIEW</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-slate-100">
            {activeOrg?.name ?? 'Dashboard'}
          </h1>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[11px] tracking-[0.18em] text-slate-600">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
        </div>
      </header>

      <section aria-label="Workspace" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<OrgIcon size={15} />} label="Organization"
                  value={activeOrg?.name ?? '—'} />
        <StatTile icon={<RoleIcon size={15} />} label="Your role"
                  value={role ? ROLE_LABELS[role] : '—'} />
        <StatTile icon={<CurrencyIcon size={15} />} label="Currency"
                  value={activeOrg?.currency ?? '—'} />
        <StatTile icon={<WorkspaceIcon size={15} />} label="Workspaces"
                  value={String(memberships.length)} />
      </section>

      <section aria-label="Production" className="grid gap-4 lg:grid-cols-3">
        <Panel title="Material on hand" href="/inventory/spools">
          <Figure {...formatMass(snapshot?.filamentGrams)} />
          <Rows
            rows={[
              ['Active spools', snapshot ? String(snapshot.spools) : '—'],
              ['Stock value', snapshot ? `${currency} ${snapshot.stockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'],
            ]}
          />
        </Panel>

        <Panel title="Machines" href="/printers/machines">
          <Figure value={snapshot ? String(snapshot.printers) : '—'} unit="registered" />
          <Rows
            rows={[
              ['Idle', snapshot ? String(snapshot.printersIdle) : '—'],
              ['Model library', snapshot ? String(snapshot.models) : '—'],
            ]}
          />
        </Panel>

        <Panel title="Attention" href="/inventory/filaments">
          {snapshot && snapshot.lowStock.length > 0 ? (
            <ul className="space-y-2.5">
              {snapshot.lowStock.slice(0, 4).map((row) => {
                const level = stockLevel(row);
                return (
                  <li key={row.product_id} className="flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          level === 'critical' ? 'bg-red-400' : 'bg-amber-400'
                        }`}
                      />
                      <span className="truncate text-slate-300">{row.name}</span>
                    </span>
                    <span className="tabular ml-3 shrink-0 text-slate-500">
                      {Math.round(Number(row.remaining_grams))} g
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex h-full flex-col justify-center py-2">
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                {snapshot ? 'Nothing needs attention.' : 'Loading…'}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Low-stock thresholds are set per filament.
              </p>
            </div>
          )}
        </Panel>
      </section>

      <Roadmap />
    </div>
  );
}

function formatMass(value: number | undefined): { value: string; unit: string } {
  if (value === undefined) return { value: '—', unit: 'g' };
  if (value >= 1000) return { value: (value / 1000).toFixed(2), unit: 'kg' };
  return { value: Math.round(value).toLocaleString(), unit: 'g' };
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card accent-rule card-interactive relative overflow-hidden">
      <div className="flex items-center gap-2 text-mint/70">
        {icon}
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
      </div>
      <p className="mt-2.5 truncate text-lg font-medium text-slate-100" title={value}>
        {value}
      </p>
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <div className="card card-interactive flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <Link
          to={href}
          className="text-[11px] text-slate-600 transition-colors hover:text-mint"
        >
          View
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <p className="mb-4 flex items-baseline gap-1.5">
      <span className="tabular text-3xl font-semibold text-slate-100">{value}</span>
      <span className="text-xs text-slate-500">{unit}</span>
    </p>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-2 border-t border-line pt-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between text-sm">
          <dt className="text-slate-500">{label}</dt>
          <dd className="tabular text-slate-300">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const PHASES = [
  { n: 1, name: 'Foundation', items: ['Auth & roles', 'Inventory', 'Printers'] },
  { n: 2, name: '3D Models', items: ['Upload', 'Geometry', 'Slicing'] },
  { n: 3, name: 'Costing', items: ['Cost profiles', 'Pricing', 'Margins'] },
  { n: 4, name: 'Production', items: ['Queue', 'Jobs', 'Consumption'] },
  { n: 5, name: 'Commerce', items: ['Customers', 'Orders', 'Finance'] },
  { n: 6, name: 'Intelligence', items: ['Analytics', 'Calibration', 'Forecasts'] },
];

/**
 * Horizontal progression rather than a list of sentences: the point of a
 * roadmap is where you are, and a bulleted list buries that.
 */
function Roadmap() {
  return (
    <section aria-label="Roadmap" className="card">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Roadmap</h2>
        <span className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-mint">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          PHASE {CURRENT_PHASE} CURRENT
        </span>
      </div>

      <div className="grid grid-cols-3 gap-y-8 lg:grid-cols-6">
        {PHASES.map((phase) => {
          const done = phase.n < CURRENT_PHASE;
          const current = phase.n === CURRENT_PHASE;
          return (
            <div key={phase.n} className="relative">
              {/* Connector runs behind the node, stopping at the last column. */}
              {phase.n < PHASES.length && (
                <span
                  className={`absolute left-[calc(50%+10px)] top-[5px] hidden h-px w-[calc(100%-20px)]
                              lg:block ${done ? 'bg-mint/40' : 'bg-line'}`}
                />
              )}

              <div className="flex flex-col items-center text-center">
                <span
                  className={`h-2.5 w-2.5 rounded-full border ${
                    done
                      ? 'border-mint bg-mint'
                      : current
                        ? 'border-mint bg-mint'
                        : 'border-line bg-ink-950'
                  }`}
                  style={current ? { boxShadow: '0 0 12px rgba(13,248,208,0.75)' } : undefined}
                />
                <p
                  className={`mt-3 text-[10px] tracking-[0.16em] ${
                    current ? 'text-mint' : done ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  PHASE {phase.n}
                </p>
                <p
                  className={`mt-1 text-sm font-medium ${
                    done || current ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  {phase.name}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {phase.items.map((item) => (
                    <li
                      key={item}
                      className={`text-[11px] ${done || current ? 'text-slate-500' : 'text-slate-700'}`}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
