import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * A small SVG chart kit, drawn rather than pulled from a library so the marks
 * obey this app's palette and the same restraint as the rest of the UI.
 *
 * Rules the whole file follows:
 *   - one y-axis, ever; two measures of different scale get two charts
 *   - a single series carries no legend, because the title already names it
 *   - text wears text tokens; only marks wear the series colour
 *   - labels are selective — a number on every point goes unread
 *   - nothing is invented: a period with no data draws no mark
 */

/**
 * Categorical hues, in fixed order and never cycled.
 *
 * Validated against the app's #000f16 surface: every step sits inside the dark
 * lightness band, clears the chroma floor and 3:1 contrast, and the worst
 * adjacent pair separates by dE 10.5 under protanopia — so identity survives
 * colour-blindness rather than being assumed to.
 */
export const SERIES = ['#0a9c7c', '#d97706', '#8b5cf6', '#e11d48', '#0284c7', '#65a30d'] as const;

/** Single-series marks use the brand accent; magnitude needs no identity hue. */
export const ACCENT = '#0df8d0';
const SURFACE = '#000f16';
const GRID = 'rgba(255,255,255,0.06)';

const BAR_MAX_THICKNESS = 18;
const GAP = 2;

export interface Point {
  label: string;
  value: number | null;
}

/** Axis ticks are always compact; only tooltips and direct labels spell it out. */
function tickText(value: number): string {
  return compact(value);
}

function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (max <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  if (abs >= 100) return value.toFixed(0);
  return Number(value.toFixed(2)).toString();
}

/** Shared frame: title, optional legend, and the empty state. */
function Frame({
  title, subtitle, legend, empty, children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card flex flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {legend}
      </div>
      {empty ? (
        <div className="grid flex-1 place-items-center py-10 text-center">
          <p className="text-sm text-slate-500">Nothing recorded yet.</p>
        </div>
      ) : children}
    </div>
  );
}

/** Legends mirror the mark: a line key for lines, a swatch for fills. */
function Legend({ items, kind }: { items: { name: string; color: string }[]; kind: 'line' | 'fill' }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5 text-xs text-slate-400">
          {kind === 'line' ? (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} />
          ) : (
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          )}
          {item.name}
        </li>
      ))}
    </ul>
  );
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { name: string; value: string; color: string }[];
}

function Tooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  // Flip before the card edge rather than letting the readout run off it.
  const flip = state.x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[128px] rounded-lg border border-line
                 bg-ink-950/95 px-2.5 py-2 shadow-panel backdrop-blur-sm"
      style={{
        left: flip ? undefined : state.x + 12,
        right: flip ? width - state.x + 12 : undefined,
        top: Math.max(state.y - 8, 0),
      }}
    >
      <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">{state.title}</p>
      {state.rows.map((row) => (
        <div key={row.name} className="flex items-baseline gap-2">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
          {/* Value leads, name follows: the reader already knows the series. */}
          <span className="tabular text-sm font-semibold text-slate-100">{row.value}</span>
          <span className="truncate text-[11px] text-slate-500">{row.name}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line / area — trend over time
// ---------------------------------------------------------------------------

export interface Series {
  name: string;
  color?: string;
  points: Point[];
}

export function LineChart({
  title, subtitle, series, height = 200, format = compact,
}: {
  title: string;
  subtitle?: string;
  series: Series[];
  height?: number;
  format?: (value: number) => string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<TooltipState | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const values = series.flatMap((s) => s.points.map((p) => p.value))
    .filter((v): v is number => v !== null);
  const empty = values.length === 0;

  const width = 640;
  const pad = { top: 12, right: 16, bottom: 24, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = niceCeiling(Math.max(...values, 0));
  const min = Math.min(...values, 0);
  const floor = min < 0 ? -niceCeiling(Math.abs(min)) : 0;
  const span = max - floor || 1;

  const xAt = (i: number) => (labels.length <= 1
    ? pad.left + plotW / 2
    : pad.left + (i / (labels.length - 1)) * plotW);
  const yAt = (v: number) => pad.top + plotH - ((v - floor) / span) * plotH;

  // With losses on the chart the zero line is the tick that matters, and it is
  // a clean number where a midpoint between -750 and 15,000 would not be.
  const ticks = floor < 0 ? [floor, 0, max] : [0, max / 2, max];
  const colors = series.map((s, i) => s.color ?? (series.length === 1 ? ACCENT : SERIES[i % SERIES.length]));

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    if (empty || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * width;
    // The crosshair snaps to the nearest point: readers aim at a date, never
    // at a 2px line.
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(
      ((localX - pad.left) / plotW) * (labels.length - 1))));
    setIndex(i);
    setHover({
      x: ((xAt(i) / width) * rect.width),
      y: event.clientY - rect.top,
      title: labels[i],
      // One tooltip lists every series, so the pointer never has to find a line.
      rows: series.map((s, si) => ({
        name: s.name,
        value: s.points[i]?.value === null || s.points[i]?.value === undefined
          ? '—' : format(s.points[i].value as number),
        color: colors[si],
      })),
    });
  }

  return (
    <Frame
      title={title}
      subtitle={subtitle}
      empty={empty}
      legend={series.length > 1
        ? <Legend kind="line" items={series.map((s, i) => ({ name: s.name, color: colors[i] }))} />
        : undefined}
    >
      <div ref={box} className="relative" onPointerMove={onMove}
           onPointerLeave={() => { setHover(null); setIndex(null); }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img"
             aria-label={`${title}. ${series.map((s) => s.name).join(', ')}.`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[0]} stopOpacity="0.16" />
              <stop offset="100%" stopColor={colors[0]} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={yAt(tick)} y2={yAt(tick)}
                    stroke={GRID} strokeWidth="1" />
              <text x={pad.left - 8} y={yAt(tick) + 3} textAnchor="end"
                    className="fill-slate-600 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tickText(tick)}
              </text>
            </g>
          ))}

          {index !== null && (
            <line x1={xAt(index)} x2={xAt(index)} y1={pad.top} y2={pad.top + plotH}
                  stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          )}

          {series.map((s, si) => {
            const drawn = s.points
              .map((p, i) => (p.value === null ? null : `${xAt(i)},${yAt(p.value)}`))
              .filter((v): v is string => v !== null);
            if (drawn.length === 0) return null;
            const first = s.points.findIndex((p) => p.value !== null);
            const last = s.points.length - 1 - [...s.points].reverse()
              .findIndex((p) => p.value !== null);

            return (
              <g key={s.name}>
                {series.length === 1 && (
                  <polygon
                    fill={`url(#${gradientId})`}
                    points={`${xAt(first)},${yAt(floor)} ${drawn.join(' ')} ${xAt(last)},${yAt(floor)}`}
                  />
                )}
                <polyline points={drawn.join(' ')} fill="none" stroke={colors[si]}
                          strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {/* Only the last point is marked: a dot on every value is noise. */}
                {s.points[last]?.value !== null && s.points[last] !== undefined && (
                  <circle cx={xAt(last)} cy={yAt(s.points[last].value as number)} r="4"
                          fill={colors[si]} stroke={SURFACE} strokeWidth="2" />
                )}
              </g>
            );
          })}

          {labels.map((label, i) => (
            // Thin out the axis so ticks never collide.
            (labels.length <= 8 || i % Math.ceil(labels.length / 6) === 0) && (
              <text key={label} x={xAt(i)} y={height - 6} textAnchor="middle"
                    className="fill-slate-600 text-[10px]">
                {label}
              </text>
            )
          ))}
        </svg>
        <Tooltip state={hover} width={box.current?.clientWidth ?? 0} />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Columns — magnitude over a period, one hue
// ---------------------------------------------------------------------------

export function BarChart({
  title, subtitle, points, height = 200, format = compact, color = ACCENT,
}: {
  title: string;
  subtitle?: string;
  points: Point[];
  height?: number;
  format?: (value: number) => string;
  color?: string;
}) {
  const [hover, setHover] = useState<TooltipState | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const empty = values.length === 0;

  const width = 640;
  const pad = { top: 14, right: 12, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceCeiling(Math.max(...values, 0));
  const band = plotW / Math.max(points.length, 1);
  // Capped, never filling the slot: the leftover band is deliberate air.
  const thickness = Math.min(band - GAP * 2, BAR_MAX_THICKNESS);
  const peak = values.length ? Math.max(...values) : 0;

  return (
    <Frame title={title} subtitle={subtitle} empty={empty}>
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img"
             aria-label={title}>
          {[0, max / 2, max].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right}
                    y1={pad.top + plotH - (tick / (max || 1)) * plotH}
                    y2={pad.top + plotH - (tick / (max || 1)) * plotH}
                    stroke={GRID} strokeWidth="1" />
              <text x={pad.left - 8} y={pad.top + plotH - (tick / (max || 1)) * plotH + 3}
                    textAnchor="end" className="fill-slate-600 text-[10px]"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tickText(tick)}
              </text>
            </g>
          ))}

          {points.map((point, i) => {
            const x = pad.left + i * band + (band - thickness) / 2;
            const value = point.value ?? 0;
            const h = max > 0 ? (value / max) * plotH : 0;
            const y = pad.top + plotH - h;
            const r = Math.min(4, h / 2);
            return (
              <g key={point.label}>
                {/* The hit target is the whole band, not the painted bar. */}
                <rect
                  x={pad.left + i * band} y={pad.top} width={band} height={plotH}
                  fill="transparent"
                  onPointerEnter={(e) => {
                    const rect = box.current?.getBoundingClientRect();
                    if (!rect) return;
                    setHover({
                      x: ((pad.left + i * band + band / 2) / width) * rect.width,
                      y: e.clientY - rect.top,
                      title: point.label,
                      rows: [{
                        name: title,
                        value: point.value === null ? '—' : format(point.value),
                        color,
                      }],
                    });
                  }}
                  onPointerLeave={() => setHover(null)}
                />
                {point.value !== null && h > 0 && (
                  <path
                    d={`M${x},${pad.top + plotH} L${x},${y + r} Q${x},${y} ${x + r},${y}
                        L${x + thickness - r},${y} Q${x + thickness},${y} ${x + thickness},${y + r}
                        L${x + thickness},${pad.top + plotH} Z`}
                    fill={color}
                    opacity={hover && hover.title !== point.label ? 0.55 : 1}
                  />
                )}
                {/* Selective: only the tallest column is labelled. */}
                {point.value !== null && point.value === peak && peak > 0 && (
                  <text x={x + thickness / 2} y={y - 5} textAnchor="middle"
                        className="fill-slate-400 text-[10px]"
                        style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {format(point.value)}
                  </text>
                )}
              </g>
            );
          })}

          {points.map((point, i) => (
            (points.length <= 8 || i % Math.ceil(points.length / 6) === 0) && (
              <text key={point.label} x={pad.left + i * band + band / 2} y={height - 6}
                    textAnchor="middle" className="fill-slate-600 text-[10px]">
                {point.label}
              </text>
            )
          ))}
        </svg>
        <Tooltip state={hover} width={box.current?.clientWidth ?? 0} />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Stacked columns — part to whole
// ---------------------------------------------------------------------------

export interface StackedPoint {
  label: string;
  parts: number[];
}

export function StackedBarChart({
  title, subtitle, names, points, height = 200, format = compact,
}: {
  title: string;
  subtitle?: string;
  names: string[];
  points: StackedPoint[];
  height?: number;
  format?: (value: number) => string;
}) {
  const [hover, setHover] = useState<TooltipState | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const totals = points.map((p) => p.parts.reduce((sum, v) => sum + v, 0));
  const empty = totals.every((t) => t <= 0);

  const width = 640;
  const pad = { top: 14, right: 12, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceCeiling(Math.max(...totals, 0));
  const band = plotW / Math.max(points.length, 1);
  const thickness = Math.min(band - GAP * 2, BAR_MAX_THICKNESS);
  const colors = names.map((_, i) => SERIES[i % SERIES.length]);

  return (
    <Frame
      title={title} subtitle={subtitle} empty={empty}
      legend={names.length > 1
        ? <Legend kind="fill" items={names.map((n, i) => ({ name: n, color: colors[i] }))} />
        : undefined}
    >
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title}>
          {[0, max / 2, max].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right}
                    y1={pad.top + plotH - (tick / (max || 1)) * plotH}
                    y2={pad.top + plotH - (tick / (max || 1)) * plotH}
                    stroke={GRID} strokeWidth="1" />
              <text x={pad.left - 8} y={pad.top + plotH - (tick / (max || 1)) * plotH + 3}
                    textAnchor="end" className="fill-slate-600 text-[10px]"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tickText(tick)}
              </text>
            </g>
          ))}

          {points.map((point, i) => {
            const x = pad.left + i * band + (band - thickness) / 2;
            let cursor = pad.top + plotH;
            return (
              <g key={point.label}>
                <rect x={pad.left + i * band} y={pad.top} width={band} height={plotH}
                      fill="transparent"
                      onPointerEnter={(e) => {
                        const rect = box.current?.getBoundingClientRect();
                        if (!rect) return;
                        setHover({
                          x: ((pad.left + i * band + band / 2) / width) * rect.width,
                          y: e.clientY - rect.top,
                          title: point.label,
                          rows: names.map((name, ni) => ({
                            name, value: format(point.parts[ni] ?? 0), color: colors[ni],
                          })),
                        });
                      }}
                      onPointerLeave={() => setHover(null)} />
                {point.parts.map((value, pi) => {
                  if (value <= 0 || max <= 0) return null;
                  const h = (value / max) * plotH;
                  // A 2px gap in the surface colour separates segments; a
                  // stroke around each would add ink that is not data.
                  const drawn = Math.max(h - GAP, 1);
                  const y = cursor - drawn;
                  cursor -= h;
                  return (
                    <rect key={names[pi]} x={x} y={y} width={thickness} height={drawn}
                          rx={pi === point.parts.length - 1 ? 3 : 0}
                          fill={colors[pi]}
                          opacity={hover && hover.title !== point.label ? 0.55 : 1} />
                  );
                })}
              </g>
            );
          })}

          {points.map((point, i) => (
            (points.length <= 8 || i % Math.ceil(points.length / 6) === 0) && (
              <text key={point.label} x={pad.left + i * band + band / 2} y={height - 6}
                    textAnchor="middle" className="fill-slate-600 text-[10px]">
                {point.label}
              </text>
            )
          ))}
        </svg>
        <Tooltip state={hover} width={box.current?.clientWidth ?? 0} />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Ranked horizontal bars — comparing named things
// ---------------------------------------------------------------------------

export function RankedBars({
  title, subtitle, points, format = compact, color = ACCENT, height,
}: {
  title: string;
  subtitle?: string;
  points: Point[];
  format?: (value: number) => string;
  color?: string;
  height?: number;
}) {
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(...values, 0);
  const empty = points.length === 0 || max <= 0;

  return (
    <Frame title={title} subtitle={subtitle} empty={empty}>
      <ul className="space-y-2.5" style={height ? { minHeight: height } : undefined}>
        {points.map((point) => (
          <li key={point.label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-slate-300">{point.label}</span>
              {/* Every bar is labelled here because there is one per row and
                  the value is the point of the comparison. */}
              <span className="tabular shrink-0 text-slate-400">
                {point.value === null ? '—' : format(point.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full transition-[width] duration-500"
                   style={{ width: `${max > 0 ? ((point.value ?? 0) / max) * 100 : 0}%`,
                            background: color }} />
            </div>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — the trend inside a stat tile
// ---------------------------------------------------------------------------

export function Sparkline({ values, color = ACCENT }: { values: number[]; color?: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${18 - ((v - min) / span) * 16}`)
      .join(' ');
  }, [values]);

  if (!path) return null;
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
      <polyline points={path} fill="none" stroke={color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
