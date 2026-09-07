import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function CreateOrganization() {
  const { refresh, signOut } = useSession();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('create_organization', {
      p_name: name,
      p_slug: effectiveSlug,
      p_currency: currency,
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
  }

  return (
    <div className="grid h-full place-items-center bg-surface">
      <form onSubmit={submit} className="card w-[420px]">
        <h1 className="text-lg font-semibold">Create your organization</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every printer, spool and job lives inside an organization. You become its owner.
        </p>

        <div className="mt-5 space-y-3">
          <div>
            <label className="label" htmlFor="org-name">Name</label>
            <input
              id="org-name"
              required
              className="field"
              placeholder="CrafCube Studio"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="org-slug">Slug</label>
            <input
              id="org-slug"
              required
              pattern="[a-z0-9][a-z0-9-]{1,60}"
              className="field font-mono"
              value={effectiveSlug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
            />
          </div>
          <div>
            <label className="label" htmlFor="org-currency">Currency</label>
            <input
              id="org-currency"
              required
              maxLength={3}
              className="field w-28 uppercase"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
            <p className="mt-1 text-xs text-slate-500">
              Drives every cost and price figure. Changing it later does not convert past records.
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={busy || !name} className="btn-primary mt-5 w-full">
          {busy ? 'Creating…' : 'Create organization'}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-300"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
