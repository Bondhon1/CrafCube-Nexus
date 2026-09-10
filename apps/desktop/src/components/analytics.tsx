import type { ReactNode } from 'react';

const TONES = {
  neutral: 'text-slate-100',
  good: 'text-mint',
  warn: 'text-amber-300',
  bad: 'text-red-400',
  muted: 'text-slate-400',
} as const;

/**
 * A single figure with its label and an optional caption.
 *
 * The caption exists so an em dash can say *why* there is no number. A blank
 * metric reads as a bug; "no print hours this month" reads as the truth.
 */
export function Figure({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="card accent-rule relative overflow-hidden">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`tabular mt-2 text-xl font-semibold ${TONES[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** A labelled 0-100 bar. A null percentage renders the track and says why. */
export function Meter({
  label,
  percent,
  hint,
}: {
  label: string;
  percent: number | null;
  hint?: string;
}) {
  const width = percent === null ? 0 : Math.max(Math.min(percent, 100), 0);
  return (
    <div className="card">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <p className={`tabular text-sm font-semibold ${
          percent === null ? 'text-slate-600' : 'text-slate-100'
        }`}>
          {percent === null ? '—' : `${percent.toFixed(1)}%`}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-mint transition-[width] duration-500"
             style={{ width: `${width}%` }} />
      </div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Says plainly that a screen has nothing to show, rather than showing zeros. */
export function NotEnoughData({ children }: { children: ReactNode }) {
  return (
    <div className="card grid place-items-center px-4 py-14 text-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
