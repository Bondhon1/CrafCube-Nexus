import { NavLink, useLocation } from 'react-router-dom';
import { CURRENT_PHASE, NAVIGATION } from '@/app/navigation';
import { useSession } from '@/app/SessionProvider';
import { NAV_ICONS } from '@/components/icons';

export function Sidebar() {
  const { can } = useSession();
  const location = useLocation();

  return (
    <nav
      aria-label="Main"
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

      {/* Ambient system detail: low contrast, never competing with navigation. */}
      <div className="mt-auto space-y-1 px-3 pt-6">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_rgba(13,248,208,0.8)]" />
          <span className="text-[10px] tracking-[0.16em] text-slate-500">SYSTEM ONLINE</span>
        </div>
        <p className="text-[10px] tracking-[0.16em] text-slate-700">
          NEXUS CORE · PHASE {CURRENT_PHASE}
        </p>
      </div>
    </nav>
  );
}
