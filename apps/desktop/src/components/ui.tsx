import { useEffect, type ReactNode } from 'react';

/** Page heading with optional actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      {/* min-w-0 lets the heading block shrink so long titles wrap instead of
          pushing the actions off the row. */}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-0 ${className}`}>{children}</div>;
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, right = false }: { children?: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
}

export function Td({
  children,
  right = false,
  className = '',
}: {
  children?: ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 align-top ${right ? 'text-right tabular-nums' : ''} ${className}`}>
      {children}
    </td>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line/60 last:border-0 hover:bg-white/[0.02]">{children}</tr>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

const TONES = {
  mint: 'border-mint/30 bg-mint/10 text-mint',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-red-500/30 bg-red-500/10 text-red-300',
  slate: 'border-line bg-white/5 text-slate-400',
} as const;

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}

/** Centred modal. Escape closes; the backdrop is click-to-dismiss. */
export function Modal({
  title,
  onClose,
  children,
  width = 'w-[460px]',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`card max-h-[85vh] overflow-y-auto ${width}`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Grams with a thousands separator; the unit is rendered dimmer. */
export function Grams({ value }: { value: number | string | null | undefined }) {
  const n = Number(value ?? 0);
  return (
    <span>
      {n.toLocaleString(undefined, { maximumFractionDigits: 1 })}
      <span className="ml-1 text-slate-600">g</span>
    </span>
  );
}

export function Money({ value, currency }: { value: number | string | null | undefined; currency: string }) {
  const n = Number(value ?? 0);
  return (
    <span>
      <span className="mr-1 text-slate-600">{currency}</span>
      {n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
