import { useCallback, useEffect, useState } from 'react';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@crafcube/types';
import type { OrganizationMemberWithProfile, Role } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';

export function Users() {
  const { activeOrg, user, can } = useSession();
  const manage = can('users.manage');

  const [members, setMembers] = useState<OrganizationMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('organization_members')
      .select('*, profile:profiles(id, email, full_name, avatar_url)')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: true });

    if (err) setError(err.message);
    else setMembers((data ?? []) as unknown as OrganizationMemberWithProfile[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  async function changeRole(memberId: string, role: Role) {
    const { error: err } = await supabase
      .from('organization_members')
      .update({ role })
      .eq('id', memberId);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-slate-400">
          Members of {activeOrg?.name}. Role changes are written to the audit log.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="card p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="px-4 py-6 text-slate-500">Loading…</td></tr>
            )}
            {!loading && members.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-slate-500">No members.</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.id} className="border-b border-surface-border/60 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{m.profile?.full_name ?? m.profile?.email ?? m.user_id}</div>
                  <div className="text-xs text-slate-500">
                    {m.profile?.email}
                    {m.user_id === user?.id && <span className="ml-2 text-accent">you</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{m.status}</td>
                <td className="px-4 py-3">
                  {manage ? (
                    <select
                      value={m.role}
                      onChange={(e) => void changeRole(m.id, e.target.value as Role)}
                      className="rounded-md border border-surface-border bg-surface px-2 py-1 text-sm"
                    >
                      {[...ROLES].reverse().map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-400">{ROLE_LABELS[m.role]}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold">Roles</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {[...ROLES].reverse().map((r) => (
            <div key={r} className="flex gap-3">
              <dt className="w-40 shrink-0 text-slate-300">{ROLE_LABELS[r]}</dt>
              <dd className="text-slate-500">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
