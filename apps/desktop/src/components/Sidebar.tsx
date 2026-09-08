import { NavLink, useLocation } from 'react-router-dom';
import { CURRENT_PHASE, NAVIGATION } from '@/app/navigation';
import { useSession } from '@/app/SessionProvider';

export function Sidebar() {
  const { can } = useSession();
  const location = useLocation();

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line
                    bg-ink-950/60 p-3">
      {NAVIGATION.filter((section) => can(section.capability)).map((section) => {
        const open = section.path !== '/' && location.pathname.startsWith(section.path);
        return (
          <div key={section.path}>
            <NavLink
              to={section.children?.[0]?.path ?? section.path}
              end={section.path === '/'}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm
                 font-medium transition-colors ${
                   isActive || open
                     ? 'bg-mint/10 text-mint'
                     : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                 }`
              }
            >
              {({ isActive }) => (
                <>
                  {(isActive || open) && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2
                                     rounded-r bg-mint" />
                  )}
                  <span className="w-4 text-center text-base opacity-80">{section.icon}</span>
                  {section.label}
                </>
              )}
            </NavLink>

            {open && section.children && (
              <div className="ml-[22px] mb-1 mt-0.5 flex flex-col border-l border-line pl-2">
                {section.children.map((child) => {
                  const locked = (child.phase ?? 1) > CURRENT_PHASE;
                  return (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        `flex items-center justify-between rounded px-2.5 py-1.5 text-[13px]
                         transition-colors ${
                           isActive
                             ? 'text-mint'
                             : locked
                               ? 'text-slate-600 hover:text-slate-500'
                               : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
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

      <div className="mt-auto px-3 pt-4 text-[10px] tracking-[0.18em] text-slate-700">
        PHASE {CURRENT_PHASE} · FOUNDATION
      </div>
    </nav>
  );
}
