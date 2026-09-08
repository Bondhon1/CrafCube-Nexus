/**
 * Icon set — Lucide geometry, drawn inline.
 *
 * The navigation previously used unicode glyphs (◈ ⚙ ⬢ ▦ ⎙). Those render
 * differently on every machine, cannot inherit stroke weight, and are the
 * single clearest tell of an unpolished interface. Every icon here shares a
 * 24-unit viewbox and 1.5 stroke so they sit on one optical line.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

export function ProductionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 20V9l5 3.5V9l5 3.5V9l5 3.5V20" />
      <path d="M18 9V4h3v16" />
      <path d="M3 20h18" />
    </Icon>
  );
}

export function ModelsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3Z" />
      <path d="M4 7.3 12 12l8-4.7" />
      <path d="M12 12v9.2" />
    </Icon>
  );
}

export function InventoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.6 21 7l-9 4.4L3 7Z" />
      <path d="M3 12l9 4.4L21 12" />
      <path d="M3 17l9 4.4L21 17" />
    </Icon>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
    </Icon>
  );
}

export function SalesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </Icon>
  );
}

export function FinanceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </Icon>
  );
}

export function AnalyticsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 21h18" />
      <rect x="4.5" y="12" width="3.6" height="6" rx="1" />
      <rect x="10.2" y="7" width="3.6" height="11" rx="1" />
      <rect x="15.9" y="3.5" width="3.6" height="14.5" rx="1" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h11M19 6h1M4 12h4M12 12h8M4 18h8M16 18h4" />
      <circle cx="17" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </Icon>
  );
}

/** Small accent marks for stat tiles. */
export function OrgIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 20.5 12 12 21 3.5 12Z" />
    </Icon>
  );
}

export function RoleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9Z" />
    </Icon>
  );
}

export function CurrencyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10M9.5 9.5h4a2 2 0 0 1 0 4h-4" />
    </Icon>
  );
}

export function WorkspaceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5v11" />
    </Icon>
  );
}

export function SpoolIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3M12 17.5v3" />
    </Icon>
  );
}

export const NAV_ICONS = {
  dashboard: DashboardIcon,
  production: ProductionIcon,
  models: ModelsIcon,
  inventory: InventoryIcon,
  printers: PrinterIcon,
  sales: SalesIcon,
  finance: FinanceIcon,
  analytics: AnalyticsIcon,
  settings: SettingsIcon,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
