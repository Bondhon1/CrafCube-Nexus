import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { AuthLayout } from '@/components/AuthLayout';

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
    <AuthLayout step="print">
      <form onSubmit={submit} className="glass w-[420px] animate-fade-up">
        <h1 className="text-lg font-semibold text-white">Create your organization</h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Every printer, spool and job lives inside an organization. You become its owner.
        </p>

        <div className="mt-6 space-y-4">
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
              className="field font-mono text-mint"
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
            <p className="mt-2 text-xs text-slate-500">
              Drives every cost and price figure. Changing it later does not convert past records.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !name} className="btn-primary mt-6 w-full">
          {busy ? 'Creating…' : 'Create organization'}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 w-full text-center text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          Sign out
        </button>
      </form>
    </AuthLayout>
  );
}
