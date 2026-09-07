import { useState } from 'react';
import { ROLE_LABELS } from '@crafcube/types';
import { useSession } from '@/app/SessionProvider';

export function TopBar() {
  const { activeOrg, memberships, role, user, switchOrg, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-border px-5">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-semibold tracking-tight text-accent">
          CrafCube Nexus
        </span>
        {memberships.length > 1 ? (
          <select
            value={activeOrg?.id ?? ''}
            onChange={(e) => switchOrg(e.target.value)}
            className="rounded-md border border-surface-border bg-surface px-2 py-1 text-sm"
          >
            {memberships.map((m) => (
              <option key={m.organization_id} value={m.organization_id}>
                {m.organization.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-400">{activeOrg?.name}</span>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
            {(user?.email ?? '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="text-slate-300">{user?.email}</span>
          {role && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">
              {ROLE_LABELS[role]}
            </span>
          )}
        </button>

        {menuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-surface-border bg-surface-raised py-1 shadow-xl">
            <button
              onClick={() => void signOut()}
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
