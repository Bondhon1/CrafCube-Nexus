/**
 * Roles from design doc §47. Order matters: the array index is the privilege
 * rank used by `roleAtLeast`, so never reorder without updating the DB enum.
 */
export const ROLES = [
  'viewer',
  'sales',
  'finance',
  'operator',
  'production_manager',
  'admin',
  'owner',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  production_manager: 'Production Manager',
  operator: 'Operator',
  finance: 'Finance',
  sales: 'Sales',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including billing and deleting the organization.',
  admin: 'Business, users, inventory and finance.',
  production_manager: 'Print jobs, inventory and printers.',
  operator: 'Print execution and job updates.',
  finance: 'Finance and reports, no production configuration.',
  sales: 'Customers, orders and pricing.',
  viewer: 'Read-only.',
};

const RANK = new Map<Role, number>(ROLES.map((r, i) => [r, i]));

/** True when `role` sits at or above `minimum` in the privilege ranking. */
export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return (RANK.get(role) ?? -1) >= (RANK.get(minimum) ?? Infinity);
}

/**
 * Capability grants. Ranking alone is not enough — Finance outranks Operator on
 * money but must not touch production configuration, so grants are explicit.
 */
export const CAPABILITIES = [
  'org.manage',
  'users.manage',
  'inventory.read',
  'inventory.write',
  'models.read',
  'models.write',
  'printers.read',
  'printers.write',
  'production.read',
  'production.write',
  'sales.read',
  'sales.write',
  'finance.read',
  'finance.write',
  'pricing.manage',
  'analytics.read',
  'audit.read',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const READ_ONLY: Capability[] = [
  'inventory.read',
  'models.read',
  'printers.read',
  'production.read',
  'sales.read',
  'analytics.read',
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES.filter((c) => c !== 'org.manage'),
  production_manager: [
    ...READ_ONLY,
    'inventory.write',
    'models.write',
    'printers.write',
    'production.write',
  ],
  operator: [...READ_ONLY, 'production.write'],
  finance: ['finance.read', 'finance.write', 'analytics.read', 'sales.read', 'inventory.read'],
  sales: ['sales.read', 'sales.write', 'models.read', 'inventory.read', 'pricing.manage'],
  viewer: READ_ONLY,
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}
