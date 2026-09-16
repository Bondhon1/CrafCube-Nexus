import { Link, NavLink, useLocation } from 'react-router-dom';
import { CURRENT_PHASE, NAVIGATION } from '@/app/navigation';
import { describeSetup, downloadPercent, useSlicerSetup } from '@/lib/slicerSetup';
import { useSession } from '@/app/SessionProvider';
import { NAV_ICONS } from '@/components/icons';

export function Sidebar({ onOpenGuide }: { onOpenGuide: () => void }) {
  const { can } = useSession();
  const setup = useSlicerSetup();
  const setupLine = describeSetup(setup);
  const percent = downloadPercent(setup);
  const location = useLocation();

  return (
    <nav
      aria-label="Main"
      data-tour="nav"
      className="relative z-10 flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto
                 border-r border-line bg-ink-950/40 p-3"
    >
      {NAVIGATION.filter((section) => can(section.capability)).map((section) => {
        const open = section.path !== '/' && location.pathname.startsWith(section.path);
        const IconComponent = NAV_ICONS[section.icon];

        return (
          <div key={section.path}>
            <NavLink
              to={section.children?.[0]?.path ?? section.path}
              end={section.path === '/'}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm
                 font-medium transition-colors duration-150 ${
                   isActive || open
                     ? 'text-mint'
                     : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                 }`
              }
              style={({ isActive }: { isActive: boolean }) =>
                isActive || open
                  ? {
                      // Fades to the right so the row reads as lit from the
                      // active indicator rather than filled with a block.
                      background:
                        'linear-gradient(90deg, rgba(0,220,190,0.13), rgba(0,220,190,0.025))',
                    }
                  : undefined
              }
            >
              {({ isActive }) => (
                <>
                  {(isActive || open) && (
                    <span
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-mint"
                      style={{ boxShadow: '0 0 14px rgba(30,230,190,0.5)' }}
                    />
                  )}
                  <IconComponent className="shrink-0" />
                  {section.label}
                </>
              )}
            </NavLink>

            {open && section.children && (
              <div className="mb-1 ml-[26px] mt-0.5 flex flex-col border-l border-line pl-2">
                {section.children.map((child) => {
                  const locked = (child.phase ?? 1) > CURRENT_PHASE;
                  return (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        `flex items-center justify-between rounded px-2.5 py-1.5 text-[13px]
                         transition-colors duration-150 ${
                           isActive
                             ? 'text-mint'
                             : locked
                               ? 'text-slate-600 hover:text-slate-500'
                               : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                         }`
                      }
                    >
                      {child.label}
                      {locked && (
                        <span className="rounded border border-line px-1 text-[9px] font-medium
                                         tracking-wide text-slate-600">
                          P{child.phase}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-auto pt-6">
        {/* Quiet and only while it matters: once a slicer is ready there is
            nothing to say, and costing simply works. */}
        {setupLine && setup?.phase !== 'checking' && (
          <Link to="/settings/slicer"
                className="mb-2 block rounded-lg border border-line px-3 py-2 transition-colors
                           hover:border-mint/30">
            <p className={`text-[11px] ${setup?.phase === 'failed' ? 'text-amber-300' : 'text-slate-400'}`}>
              {setupLine}
            </p>
            {percent !== null && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-mint transition-[width] duration-300"
                     style={{ width: `${percent}%` }} />
              </div>
            )}
          </Link>
        )}
        <button
          onClick={onOpenGuide}
          data-tour="guide-button"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs
                     text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-mint"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2H7v12H3.5A1.5 1.5 0 0 1 2 12.5Z" />
            <path d="M14 3.5A1.5 1.5 0 0 0 12.5 2H9v12h3.5a1.5 1.5 0 0 0 1.5-1.5Z" />
          </svg>
          User guide
        </button>
      </div>

      {/* Ambient system detail: low contrast, never competing with navigation. */}
      <div className="space-y-1 px-3 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_rgba(13,248,208,0.8)]" />
          <span className="text-[10px] tracking-[0.16em] text-slate-500">SYSTEM ONLINE</span>
        </div>
      </div>
    </nav>
  );
}
