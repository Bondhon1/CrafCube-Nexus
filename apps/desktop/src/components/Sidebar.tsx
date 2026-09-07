import { NavLink, useLocation } from 'react-router-dom';
import { CURRENT_PHASE, NAVIGATION } from '@/app/navigation';
import { useSession } from '@/app/SessionProvider';

export function Sidebar() {
  const { can } = useSession();
  const location = useLocation();

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-surface-border bg-surface-raised/40 p-3">
      {NAVIGATION.filter((section) => can(section.capability)).map((section) => {
        const open = location.pathname.startsWith(section.path) && section.path !== '/';
        return (
          <div key={section.path}>
            <NavLink
              to={section.children?.[0]?.path ?? section.path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive || open
                    ? 'bg-accent/10 text-accent'
                    : 'text-slate-300 hover:bg-white/5'
                }`
              }
              end={section.path === '/'}
            >
              <span className="w-4 text-center opacity-70">{section.icon}</span>
              {section.label}
            </NavLink>

            {open && section.children && (
              <div className="ml-6 mt-0.5 flex flex-col border-l border-surface-border pl-2">
                {section.children.map((child) => {
                  const locked = (child.phase ?? 1) > CURRENT_PHASE;
                  return (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        `rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                          isActive
                            ? 'text-accent'
                            : locked
                              ? 'text-slate-600 hover:text-slate-500'
                              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                        }`
                      }
                    >
                      {child.label}
                      {locked && <span className="ml-1.5 text-[10px] opacity-60">P{child.phase}</span>}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
