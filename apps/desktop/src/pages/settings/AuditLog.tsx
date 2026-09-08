import { useEffect, useState } from 'react';
import type { AuditLog as AuditLogRow } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';

/** Renders the changed keys of an update rather than two full JSON blobs. */
function summarize(row: AuditLogRow): string {
  if (row.action === 'insert') return 'created';
  if (row.action === 'delete') return 'deleted';
  const before = row.before ?? {};
  const after = row.after ?? {};
  const changed = Object.keys(after).filter(
    (k) => k !== 'updated_at' && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  if (changed.length === 0) return 'updated';
  return changed
    .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`)
    .join(', ');
}

export function AuditLog() {
  const { activeOrg } = useSession();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    setLoading(true);

    void supabase
      .from('audit_logs')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setRows((data ?? []) as AuditLogRow[]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeOrg]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-slate-400">
          Last 100 changes. Entries are append-only and cannot be edited or deleted.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="card p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-slate-500">Nothing logged yet.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line/60 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-300">{row.entity_table}</td>
                <td className="px-4 py-3 text-slate-400">{summarize(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
