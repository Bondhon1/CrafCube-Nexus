import type { Capability } from '@crafcube/types';
import type { NavIconName } from '@/components/icons';

export interface NavItem {
  label: string;
  path: string;
  /** Rendered greyed-out until the phase that implements it lands. */
  phase?: number;
}

export interface NavSection {
  label: string;
  path: string;
  icon: NavIconName;
  capability: Capability;
  children?: NavItem[];
}

/** Mirrors design doc §114. Phases mark what is not built yet. */
export const NAVIGATION: NavSection[] = [
  { label: 'Dashboard', path: '/', icon: 'dashboard', capability: 'analytics.read' },
  {
    label: 'Production',
    path: '/production',
    icon: 'production',
    capability: 'production.read',
    children: [
      { label: 'Queue', path: '/production/queue' },
      { label: 'Active Jobs', path: '/production/active' },
      { label: 'Completed', path: '/production/completed' },
      { label: 'Failed', path: '/production/failed' },
    ],
  },
  {
    label: 'Models',
    path: '/models',
    icon: 'models',
    capability: 'models.read',
    children: [
      { label: 'Library', path: '/models/library' },
      { label: 'Upload', path: '/models/upload' },
      { label: 'Custom builds', path: '/models/custom' },
    ],
  },
  {
    label: 'Inventory',
    path: '/inventory',
    icon: 'inventory',
    capability: 'inventory.read',
    children: [
      { label: 'Filaments', path: '/inventory/filaments', phase: 1 },
      { label: 'Spools', path: '/inventory/spools', phase: 1 },
      { label: 'Consumables', path: '/inventory/consumables' },
      { label: 'Low Stock', path: '/inventory/low-stock' },
      { label: 'Transactions', path: '/inventory/transactions', phase: 1 },
    ],
  },
  {
    label: 'Printers',
    path: '/printers',
    icon: 'printers',
    capability: 'printers.read',
    children: [
      { label: 'Machines', path: '/printers/machines', phase: 1 },
      { label: 'Status', path: '/printers/status' },
      { label: 'Maintenance', path: '/printers/maintenance' },
      { label: 'Profiles', path: '/printers/profiles' },
      { label: 'Calibration', path: '/printers/calibration', phase: 6 },
    ],
  },
  {
    label: 'Sales',
    path: '/sales',
    icon: 'sales',
    capability: 'sales.read',
    children: [
      { label: 'Customers', path: '/sales/customers', phase: 5 },
      { label: 'Orders', path: '/sales/orders', phase: 5 },
      { label: 'Quotations', path: '/sales/quotations', phase: 5 },
      { label: 'Products', path: '/sales/products', phase: 5 },
    ],
  },
  {
    label: 'Finance',
    path: '/finance',
    icon: 'finance',
    capability: 'finance.read',
    children: [
      { label: 'Transactions', path: '/finance/transactions', phase: 5 },
      { label: 'Expenses', path: '/finance/expenses', phase: 5 },
      { label: 'Revenue', path: '/finance/revenue', phase: 5 },
      { label: 'P&L', path: '/finance/pnl', phase: 5 },
      { label: 'Reports', path: '/finance/reports' },
    ],
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: 'analytics',
    capability: 'analytics.read',
    children: [
      { label: 'Products', path: '/analytics/products' },
      { label: 'Printers', path: '/analytics/printers' },
      { label: 'Materials', path: '/analytics/materials' },
      { label: 'Waste', path: '/analytics/waste' },
      { label: 'Profitability', path: '/analytics/profitability' },
    ],
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: 'settings',
    capability: 'inventory.read',
    children: [
      { label: 'Organization', path: '/settings/organization' },
      { label: 'Users', path: '/settings/users' },
      { label: 'Audit Log', path: '/settings/audit' },
      { label: 'Pricing', path: '/settings/pricing' },
      { label: 'Cost Profiles', path: '/settings/cost-profiles' },
      { label: 'Slicer', path: '/settings/slicer' },
      { label: 'Notifications', path: '/settings/notifications' },
      { label: 'Storage', path: '/settings/storage' },
      { label: 'Integrations', path: '/settings/integrations' },
    ],
  },
];

/** Phases already shipped — anything above renders as "coming in phase N". */
export const CURRENT_PHASE = 6;
