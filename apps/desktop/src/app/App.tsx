import { useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from '@/app/SessionProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Sidebar } from '@/components/Sidebar';
import { TitleBar } from '@/components/TitleBar';
import { SignIn } from '@/pages/SignIn';
import { CreateOrganization } from '@/pages/CreateOrganization';
import { Dashboard } from '@/pages/Dashboard';
import { Placeholder } from '@/pages/Placeholder';
import { OrganizationSettings } from '@/pages/settings/OrganizationSettings';
import { Users } from '@/pages/settings/Users';
import { AuditLog } from '@/pages/settings/AuditLog';
import { Filaments } from '@/pages/inventory/Filaments';
import { Spools } from '@/pages/inventory/Spools';
import { Transactions } from '@/pages/inventory/Transactions';
import { Machines } from '@/pages/printers/Machines';
import { Library } from '@/pages/models/Library';
import { Upload } from '@/pages/models/Upload';
import { CostProfiles } from '@/pages/settings/CostProfiles';
import { Pricing } from '@/pages/settings/Pricing';
import { Jobs } from '@/pages/production/Jobs';
import { Profiles } from '@/pages/printers/Profiles';
import { Customers } from '@/pages/sales/Customers';
import { Orders } from '@/pages/sales/Orders';
import { Products } from '@/pages/sales/Products';
import { Quotations } from '@/pages/sales/Quotations';
import { Finance } from '@/pages/finance/Finance';
import { Reports } from '@/pages/finance/Reports';
import { Analytics } from '@/pages/analytics/Analytics';
import { LowStock } from '@/pages/inventory/LowStock';
import { Consumables } from '@/pages/inventory/Consumables';
import { Maintenance } from '@/pages/printers/Maintenance';
import { Status } from '@/pages/printers/Status';
import { Calibration } from '@/pages/printers/Calibration';
import { Slicer } from '@/pages/settings/Slicer';
import { Notifications } from '@/pages/settings/Notifications';
import { Storage } from '@/pages/settings/Storage';
import { Integrations } from '@/pages/settings/Integrations';
import { CustomBuilds } from '@/pages/models/CustomBuilds';
import { NAVIGATION } from '@/app/navigation';
import { WindowControls } from '@/components/WindowControls';
import { Atmosphere } from '@/components/Atmosphere';
import { UserGuide, useFirstRun } from '@/components/UserGuide';

function SetupRequired() {
  return (
    <div className="drag grid h-full place-items-center bg-ink-900 p-8">
      <div className="absolute right-0 top-0"><WindowControls /></div>
      <div className="card no-drag max-w-lg">
        <h1 className="text-lg font-semibold">Supabase is not configured</h1>
        <p className="mt-2 text-sm text-slate-400">
          Copy <code className="font-mono text-mint">apps/desktop/.env.example</code> to{' '}
          <code className="font-mono text-mint">.env</code> and fill in your project URL and
          anon key, then restart the dev server.
        </p>
        <p className="mt-3 text-sm text-slate-400">
          Apply the migrations in <code className="font-mono text-mint">supabase/migrations</code>{' '}
          first — the app expects the foundation schema to exist.
        </p>
      </div>
    </div>
  );
}

/** Routes declared in navigation but not yet implemented resolve to Placeholder. */
const IMPLEMENTED = new Set([
  '/settings/organization',
  '/settings/users',
  '/settings/audit',
  '/inventory/filaments',
  '/inventory/spools',
  '/inventory/transactions',
  '/printers/machines',
  '/printers/profiles',
  '/models/library',
  '/models/upload',
  '/settings/cost-profiles',
  '/settings/pricing',
  '/production/queue',
  '/production/active',
  '/production/completed',
  '/production/failed',
  '/sales/customers',
  '/sales/orders',
  '/sales/products',
  '/sales/quotations',
  '/finance/transactions',
  '/finance/expenses',
  '/finance/revenue',
  '/finance/pnl',
  '/finance/reports',
  '/analytics/products',
  '/analytics/printers',
  '/analytics/materials',
  '/analytics/waste',
  '/analytics/profitability',
  '/inventory/consumables',
  '/inventory/low-stock',
  '/printers/status',
  '/printers/maintenance',
  '/printers/calibration',
  '/settings/slicer',
  '/settings/notifications',
  '/settings/storage',
  '/settings/integrations',
  '/models/custom',
]);

function Shell() {
  // Opens by itself the first time, and by the sidebar button after that.
  const [firstRun, dismissFirstRun] = useFirstRun();
  const [requested, setRequested] = useState(false);
  const showGuide = firstRun || requested;

  return (
    <div className="relative flex h-full flex-col bg-ink-900">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <Atmosphere />
        <Sidebar onOpenGuide={() => setRequested(true)} />
        <main className="relative z-10 min-w-0 flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings/organization" element={<OrganizationSettings />} />
            <Route path="/settings/users" element={<Users />} />
            <Route path="/settings/audit" element={<AuditLog />} />
            <Route path="/inventory/filaments" element={<Filaments />} />
            <Route path="/inventory/spools" element={<Spools />} />
            <Route path="/inventory/transactions" element={<Transactions />} />
            <Route path="/production/queue" element={
              <Jobs view="queue" title="Queue"
                    subtitle="Jobs waiting to print. Material is reserved when a job moves to Preparing." />
            } />
            <Route path="/production/active" element={
              <Jobs view="active" title="Active jobs"
                    subtitle="On the machine now. Completing a job records what it actually used." />
            } />
            <Route path="/production/completed" element={
              <Jobs view="completed" title="Completed"
                    subtitle="Finished jobs, with the gap between estimate and actual." />
            } />
            <Route path="/production/failed" element={
              <Jobs view="failed" title="Failed & cancelled"
                    subtitle="Failed prints deduct material as waste, keeping it out of production cost." />
            } />
            <Route path="/settings/cost-profiles" element={<CostProfiles />} />
            <Route path="/settings/pricing" element={<Pricing />} />
            <Route path="/models/library" element={<Library />} />
            <Route path="/models/upload" element={<Upload />} />
            <Route path="/printers/machines" element={<Machines />} />
            <Route path="/printers/profiles" element={<Profiles />} />
            <Route path="/sales/customers" element={<Customers />} />
            <Route path="/sales/orders" element={<Orders />} />
            <Route path="/sales/products" element={<Products />} />
            <Route path="/sales/quotations" element={<Quotations />} />
            <Route path="/finance/transactions" element={
              <Finance view="transactions" title="Transactions"
                       subtitle="Every income and expense line, newest first. Payments post their own income row." />
            } />
            <Route path="/finance/expenses" element={
              <Finance view="expenses" title="Expenses"
                       subtitle="What the business spends. Lines flagged COGS reduce gross profit; the rest are operating cost." />
            } />
            <Route path="/finance/revenue" element={
              <Finance view="revenue" title="Revenue"
                       subtitle="Money actually received. An order's total is not revenue until it is paid." />
            } />
            <Route path="/finance/pnl" element={
              <Finance view="pnl" title="Profit &amp; loss"
                       subtitle="Revenue less cost of goods sold, then less operating expenses, by month." />
            } />
            <Route path="/finance/reports" element={<Reports />} />
            <Route path="/inventory/low-stock" element={<LowStock />} />
            <Route path="/inventory/consumables" element={<Consumables />} />
            <Route path="/printers/status" element={<Status />} />
            <Route path="/printers/maintenance" element={<Maintenance />} />
            <Route path="/printers/calibration" element={<Calibration />} />
            <Route path="/settings/slicer" element={<Slicer />} />
            <Route path="/settings/notifications" element={<Notifications />} />
            <Route path="/settings/storage" element={<Storage />} />
            <Route path="/settings/integrations" element={<Integrations />} />
            <Route path="/models/custom" element={<CustomBuilds />} />
            <Route path="/analytics/products" element={
              <Analytics view="products" title="Product analytics"
                         subtitle="Which products earn, using the cost snapshotted on each sale." />
            } />
            <Route path="/analytics/printers" element={
              <Analytics view="printers" title="Printer analytics"
                         subtitle="Hours, output, failures and utilisation per machine." />
            } />
            <Route path="/analytics/materials" element={
              <Analytics view="materials" title="Material analytics"
                         subtitle="Stock against measured consumption, and how long it will last." />
            } />
            <Route path="/analytics/waste" element={
              <Analytics view="waste" title="Waste &amp; failures"
                         subtitle="Filament that never became a product, and the reasons prints failed." />
            } />
            <Route path="/analytics/profitability" element={
              <Analytics view="profitability" title="Profitability"
                         subtitle="Profit per machine hour and per gram — the two metrics §69 singles out." />
            } />
            {NAVIGATION.flatMap((s) => s.children ?? [])
              .filter((c) => !IMPLEMENTED.has(c.path))
              .map((c) => (
                <Route key={c.path} path={c.path} element={<Placeholder />} />
              ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {showGuide && (
        <UserGuide onClose={() => { dismissFirstRun(); setRequested(false); }} />
      )}
    </div>
  );
}

function Gate() {
  const { loading, session, memberships } = useSession();

  if (loading) {
    return (
      <div className="drag grid h-full place-items-center bg-ink-900 text-sm text-slate-500">
        <div className="absolute right-0 top-0"><WindowControls /></div>
        Loading workspace…
      </div>
    );
  }
  if (!session) return <SignIn />;
  if (memberships.length === 0) return <CreateOrganization />;
  return <Shell />;
}

export function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <SessionProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
    </SessionProvider>
  );
}
