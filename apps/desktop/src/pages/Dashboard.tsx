import { useSession } from '@/app/SessionProvider';
import { ROLE_LABELS } from '@crafcube/types';

/**
 * Placeholder for the smart dashboard of §115. Phase 1 shows only what the
 * foundation actually knows — no fabricated production numbers.
 */
export function Dashboard() {
  const { activeOrg, role, memberships } = useSession();

  const tiles = [
    { label: 'Organization', value: activeOrg?.name ?? '—' },
    { label: 'Your role', value: role ? ROLE_LABELS[role] : '—' },
    { label: 'Currency', value: activeOrg?.currency ?? '—' },
    { label: 'Workspaces', value: String(memberships.length) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Phase 1 foundation is live. Production, costing and finance widgets arrive with their phases.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card">
            <p className="text-xs uppercase tracking-wide text-slate-500">{tile.label}</p>
            <p className="mt-2 truncate text-lg font-medium">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200">Roadmap</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          <li><span className="text-accent">Phase 1</span> — auth, organizations, roles, audit log <span className="text-accent">(current)</span></li>
          <li>Phase 2 — model upload, geometry analysis, slicer integration</li>
          <li>Phase 3 — costing and pricing engine</li>
          <li>Phase 4 — print jobs, queue, inventory consumption</li>
          <li>Phase 5 — sales, orders and finance</li>
          <li>Phase 6 — analytics, calibration and forecasting</li>
        </ul>
      </div>
    </div>
  );
}
