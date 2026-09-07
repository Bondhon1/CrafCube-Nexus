import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';

export function OrganizationSettings() {
  const { activeOrg, can, refresh } = useSession();
  const editable = can('org.manage') || can('users.manage');

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setName(activeOrg?.name ?? '');
    setCurrency(activeOrg?.currency ?? '');
    setTimezone(activeOrg?.timezone ?? '');
  }, [activeOrg]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setStatus(null);

    const { error } = await supabase
      .from('organizations')
      .update({ name, currency, timezone })
      .eq('id', activeOrg.id);

    setStatus(error ? error.message : 'Saved.');
    if (!error) await refresh();
    setBusy(false);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Organization</h1>
        <p className="mt-1 text-sm text-slate-400">Workspace identity and money settings.</p>
      </div>

      <form onSubmit={save} className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="field" value={name} disabled={!editable}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="slug">Slug</label>
          <input id="slug" className="field font-mono text-slate-500"
                 value={activeOrg?.slug ?? ''} disabled readOnly />
        </div>
        <div className="flex gap-4">
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <input id="currency" maxLength={3} className="field w-28 uppercase" value={currency}
                   disabled={!editable} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="tz">Timezone</label>
            <input id="tz" className="field" value={timezone} disabled={!editable}
                   onChange={(e) => setTimezone(e.target.value)} />
          </div>
        </div>

        {status && <p className="text-sm text-slate-400">{status}</p>}
        {editable && (
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </form>
    </div>
  );
}
