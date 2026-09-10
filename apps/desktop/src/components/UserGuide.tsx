import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GUIDE, type GuideBlock } from '@/components/guide-content';
import { LogoMark } from '@/components/Logo';

/**
 * Per-workspace, so someone who joins a second organisation is not shown the
 * guide again as if they were new. Bumping the version reopens it for everyone,
 * which is the point when the guide has changed materially.
 */
const SEEN_KEY = 'nexus.guide.seen.v1';

function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'yes';
  } catch {
    // Private windows and locked-down profiles throw here. Showing the guide
    // again is a far smaller failure than crashing the app on load.
    return false;
  }
}

function rememberSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'yes');
  } catch {
    /* nothing to do; the guide simply opens again next time */
  }
}

/** True the first time this install reaches the workspace. */
export function useFirstRun(): [boolean, () => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasSeenGuide()) setOpen(true);
  }, []);

  return [open, useCallback(() => setOpen(false), [])];
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case 'text':
      return <p className="text-sm leading-relaxed text-slate-400">{block.text}</p>;

    case 'rule':
      return (
        <div className="rounded-lg border border-mint/25 bg-mint/[0.06] px-4 py-3">
          <p className="text-sm leading-relaxed text-mint/90">{block.text}</p>
        </div>
      );

    case 'steps':
      return (
        <ol className="space-y-2.5">
          {block.items.map((item, i) => (
            <li key={item} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center
                               rounded-full border border-mint/30 text-[11px] font-medium text-mint">
                {i + 1}
              </span>
              <span className="text-sm leading-relaxed text-slate-400">{item}</span>
            </li>
          ))}
        </ol>
      );

    case 'points':
      return (
        <dl className="space-y-2.5">
          {block.items.map((item) => (
            <div key={item.term} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="shrink-0 text-sm font-medium text-slate-200 sm:w-40">
                {item.term}
              </dt>
              <dd className="text-sm leading-relaxed text-slate-400">{item.detail}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

export function UserGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const step = GUIDE[index];
  const last = index === GUIDE.length - 1;

  const finish = useCallback(() => {
    rememberSeen();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, GUIDE.length - 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [finish]);

  function goTo(route: string) {
    finish();
    navigate(route);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
         role="dialog" aria-modal="true" aria-label="User guide">
      <div className="card flex max-h-[86vh] w-[min(880px,94vw)] flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <LogoMark className="h-7 w-7" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                User guide
              </p>
              <p className="text-sm font-semibold text-slate-100">
                {index + 1} of {GUIDE.length} · {step.title}
              </p>
            </div>
          </div>
          <button onClick={finish} aria-label="Close the guide"
                  className="rounded p-1 text-slate-500 transition-colors hover:bg-white/5
                             hover:text-slate-200">
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Contents: the guide is navigated, not just paged through. */}
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-line py-3 md:block">
            <ul>
              {GUIDE.map((entry, i) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setIndex(i)}
                    aria-current={i === index ? 'step' : undefined}
                    className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-xs
                                transition-colors ${
                      i === index
                        ? 'bg-mint/[0.07] text-mint'
                        : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      i === index ? 'bg-mint' : i < index ? 'bg-slate-600' : 'bg-line-bright'
                    }`} />
                    <span className="truncate">{entry.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-100">{step.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{step.summary}</p>

            <div className="mt-5 space-y-4">
              {step.body.map((block, i) => <Block key={i} block={block} />)}
            </div>

            {step.route && (
              <button onClick={() => goTo(step.route as string)}
                      className="btn-ghost mt-6 text-xs">
                {step.routeLabel ?? 'Open'} →
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
          <button onClick={finish} className="text-xs text-slate-500 hover:text-slate-300">
            {last ? 'Close' : 'Skip the guide'}
          </button>

          <div className="flex items-center gap-2">
            <button onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                    disabled={index === 0} className="btn-ghost text-xs disabled:opacity-30">
              Back
            </button>
            {last ? (
              <button onClick={finish} className="btn-primary text-xs">Get started</button>
            ) : (
              <button onClick={() => setIndex((i) => Math.min(i + 1, GUIDE.length - 1))}
                      className="btn-primary text-xs">
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
