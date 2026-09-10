import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOUR } from '@/components/tour';

/**
 * Bumping the version reopens the tour for everyone, which is the point when
 * the tour has changed materially.
 */
const SEEN_KEY = 'nexus.tour.seen.v1';

function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'yes';
  } catch {
    // Private windows and locked-down profiles throw here. Showing the tour
    // again is a far smaller failure than crashing the app on load.
    return false;
  }
}

function rememberSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'yes');
  } catch {
    /* nothing to do; it simply offers itself again next time */
  }
}

/** True the first time this install reaches the workspace. */
export function useFirstRun(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!hasSeenTour()) setOpen(true);
  }, []);
  return [open, useCallback(() => setOpen(false), [])];
}

interface Rect { top: number; left: number; width: number; height: number }

const PADDING = 8;
const CALLOUT_WIDTH = 320;
const GAP = 14;

/**
 * Waits for the step's element to exist, then reports where it is.
 *
 * The element usually appears a frame or two after the route changes, and
 * sometimes after a fetch resolves, so this polls briefly rather than reading
 * the DOM once and giving up.
 */
function useTargetRect(target: string | undefined, step: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const frame = useRef<number>();

  useLayoutEffect(() => {
    setRect(null);
    if (!target) return;

    const deadline = Date.now() + 2500;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        // Bring it into view before measuring, or the spotlight lands on a
        // rectangle that is scrolled off screen.
        el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        const box = el.getBoundingClientRect();
        setRect({
          top: box.top - PADDING, left: box.left - PADDING,
          width: box.width + PADDING * 2, height: box.height + PADDING * 2,
        });
        return;
      }
      if (Date.now() < deadline) frame.current = requestAnimationFrame(measure);
    };

    frame.current = requestAnimationFrame(measure);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, step]);

  return rect;
}

/** Where the callout sits so it never covers what it is pointing at. */
function place(rect: Rect | null): React.CSSProperties {
  if (!rect) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }

  const below = rect.top + rect.height + GAP;
  const roomBelow = window.innerHeight - below > 190;
  const roomRight = window.innerWidth - (rect.left + rect.width) > CALLOUT_WIDTH + GAP * 2;

  // Prefer beside a tall target (the sidebar), below a wide one (a button).
  if (rect.height > 240 && roomRight) {
    return {
      left: Math.min(rect.left + rect.width + GAP, window.innerWidth - CALLOUT_WIDTH - GAP),
      top: Math.min(Math.max(rect.top, GAP), window.innerHeight - 220),
    };
  }

  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - CALLOUT_WIDTH / 2, GAP),
    window.innerWidth - CALLOUT_WIDTH - GAP,
  );
  return roomBelow
    ? { left, top: below }
    : { left, top: Math.max(rect.top - GAP - 178, GAP) };
}

export function UserGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const stop = TOUR[index];
  const last = index === TOUR.length - 1;
  const rect = useTargetRect(stop.target, index);

  // Each stop drives the router: the tour walks the app rather than describing it.
  useEffect(() => { navigate(stop.route); }, [navigate, stop.route]);

  const finish = useCallback(() => {
    rememberSeen();
    onClose();
  }, [onClose]);

  const go = useCallback((delta: number) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), TOUR.length - 1));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [finish, go]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true"
         aria-label={`Guided tour, step ${index + 1} of ${TOUR.length}`}>
      {/* Four panels rather than one dark sheet with a hole: the cut-out stays
          crisp, and the highlighted control keeps its real colours. */}
      {rect ? (
        <>
          <Shade style={{ left: 0, top: 0, width: '100%', height: Math.max(rect.top, 0) }} />
          <Shade style={{ left: 0, top: rect.top, width: Math.max(rect.left, 0),
                          height: rect.height }} />
          <Shade style={{ left: rect.left + rect.width, top: rect.top,
                          width: '100%', height: rect.height }} />
          <Shade style={{ left: 0, top: rect.top + rect.height,
                          width: '100%', height: '100%' }} />
          <div
            className="pointer-events-none absolute rounded-lg ring-2 ring-mint
                       transition-all duration-300"
            style={{
              left: rect.left, top: rect.top, width: rect.width, height: rect.height,
              boxShadow: '0 0 0 1px rgba(13,248,208,0.35), 0 0 28px -4px rgba(13,248,208,0.55)',
            }}
          />
        </>
      ) : (
        <Shade style={{ inset: 0 }} />
      )}

      <div
        className="absolute w-[320px] rounded-xl border border-mint/25 bg-ink-950/95 p-4
                   shadow-panel backdrop-blur-sm transition-all duration-300"
        style={place(rect)}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-mint">
            {index + 1} / {TOUR.length}
          </span>
          <button onClick={finish} className="text-[11px] text-slate-500 hover:text-slate-300">
            Skip
          </button>
        </div>

        <h2 className="mt-2 text-sm font-semibold text-slate-100">{stop.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{stop.text}</p>

        {stop.target && !rect && (
          <p className="mt-2 text-[11px] text-slate-600">
            That control is not on screen — it may need a permission you do not have.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden="true">
            {TOUR.map((entry, i) => (
              <span key={entry.id} className={`h-1 rounded-full transition-all ${
                i === index ? 'w-4 bg-mint' : 'w-1 bg-line-bright'}`} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => go(-1)} disabled={index === 0}
                    className="btn-ghost px-2.5 py-1 text-xs disabled:opacity-30">
              Back
            </button>
            <button onClick={() => (last ? finish() : go(1))}
                    className="btn-primary px-3 py-1 text-xs">
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One panel of the dimmed surround. Clicks are swallowed, not passed through. */
function Shade({ style }: { style: React.CSSProperties }) {
  return <div className="absolute bg-black/65 transition-all duration-300" style={style} />;
}
