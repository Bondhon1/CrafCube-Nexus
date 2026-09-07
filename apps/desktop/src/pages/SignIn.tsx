import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type Mode = 'signin' | 'signup';

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });

    if (result.error) {
      setError(result.error.message);
    } else if (mode === 'signup' && !result.data.session) {
      // Project has email confirmation enabled.
      setNotice('Check your inbox to confirm the address, then sign in.');
    }
    setBusy(false);
  }

  return (
    <div className="grid h-full place-items-center bg-surface">
      <form onSubmit={submit} className="card w-[380px]">
        <h1 className="font-mono text-lg font-semibold text-accent">CrafCube Nexus</h1>
        <p className="mt-1 text-sm text-slate-400">
          {mode === 'signin' ? 'Sign in to your workspace.' : 'Create your account.'}
        </p>

        <div className="mt-5 space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="label" htmlFor="name">Full name</label>
              <input
                id="name"
                className="field"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-3 text-sm text-accent">{notice}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
          className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-200"
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
