import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '@crafcube/types';
import { useSession } from '@/app/SessionProvider';
import { LogoMark, Wordmark } from '@/components/Logo';
import { WindowControls } from '@/components/WindowControls';

/**
 * The window's own title bar: drag region, brand, organization switcher, user
 * menu and the custom window buttons. Replaces the native frame.
 */
export function TitleBar() {
  const { activeOrg, memberships, role, user, switchOrg, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const root = useRef<HTMLElement>(null);

  // Close either popover on any outside click.
  useEffect(() => {
    if (!menuOpen && !orgOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setOrgOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, orgOpen]);

  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <header
      ref={root}
      className="drag relative z-30 flex h-11 shrink-0 items-stretch justify-between
                 border-b border-line bg-ink-950/80 backdrop-blur"
    >
      <div className="flex items-center gap-2.5 pl-4">
        <LogoMark className="h-5 w-5" />
        <Wordmark className="text-[13px]" />

        {activeOrg && (
          <>
            <span className="mx-1 text-line-bright">/</span>
            <div className="no-drag relative">
              <button
                type="button"
                onClick={() => { setOrgOpen((v) => !v); setMenuOpen(false); }}
                disabled={memberships.length <= 1}
                className="flex max-w-[200px] items-center gap-1.5 rounded px-2 py-1 text-[13px]
                           text-slate-300 transition-colors hover:bg-white/5
                           disabled:hover:bg-transparent"
              >
                <span className="truncate">{activeOrg.name}</span>
                {memberships.length > 1 && <Chevron />}
              </button>

              {orgOpen && (
                <div className="absolute left-0 top-full mt-1 w-56 overflow-hidden rounded-lg
                                border border-line bg-ink-850 py-1 shadow-panel">
                  {memberships.map((m) => (
                    <button
                      key={m.organization_id}
                      onClick={() => { switchOrg(m.organization_id); setOrgOpen(false); }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm
                                  transition-colors hover:bg-white/5 ${
                                    m.organization_id === activeOrg.id
                                      ? 'text-mint'
                                      : 'text-slate-300'
                                  }`}
                    >
                      <span className="truncate">{m.organization.name}</span>
                      <span className="ml-2 shrink-0 text-[11px] text-slate-500">
                        {ROLE_LABELS[m.role]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-stretch">
        <div className="no-drag relative flex items-center pr-2">
          <button
            type="button"
            onClick={() => { setMenuOpen((v) => !v); setOrgOpen(false); }}
            className="flex items-center gap-2 rounded px-2 py-1 text-[13px]
                       transition-colors hover:bg-white/5"
          >
            <span className="grid h-6 w-6 place-items-center rounded-md bg-mint/15
                             text-[10px] font-bold text-mint">
              {initials}
            </span>
            <span className="max-w-[180px] truncate text-slate-300">{user?.email}</span>
            <Chevron />
          </button>

          {menuOpen && (
            <div className="absolute right-2 top-full mt-1 w-52 overflow-hidden rounded-lg
                            border border-line bg-ink-850 shadow-panel">
              <div className="border-b border-line px-3 py-2.5">
                <p className="truncate text-sm text-slate-200">
                  {user?.user_metadata?.full_name ?? user?.email}
                </p>
                {role && <p className="mt-0.5 text-[11px] text-mint">{ROLE_LABELS[role]}</p>}
              </div>
              <button
                onClick={() => void signOut()}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-300
                           transition-colors hover:bg-white/5"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        <WindowControls />
      </div>
    </header>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor"
         strokeWidth="1.6" className="opacity-50">
      <polyline points="2,3.5 5,6.5 8,3.5" />
    </svg>
  );
}
