import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Step = 'signin' | 'signup' | 'confirm';

/** Supabase codes are six digits; the email template must expose {{ .Token }}. */
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/** GoTrue words an unconfirmed address differently across versions. */
function isUnconfirmedEmail(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('not confirmed') || m.includes('email_not_confirmed');
}

export function SignIn() {
  const [step, setStep] = useState<Step>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'confirm') codeInput.current?.focus();
  }, [step]);

  const toConfirmStep = useCallback((message: string) => {
    setStep('confirm');
    setCode('');
    setNotice(message);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, []);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (step === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        // An unconfirmed account is not a failure — it needs the code step.
        if (isUnconfirmedEmail(err.message)) {
          await supabase.auth.resend({ type: 'signup', email });
          toConfirmStep('That address is not confirmed yet. We sent you a new code.');
        } else {
          setError(err.message);
        }
      }
    } else {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (err) setError(err.message);
      else if (!data.session) toConfirmStep(`We sent a ${CODE_LENGTH}-digit code to ${email}.`);
    }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // On success the session arrives via onAuthStateChange; nothing to do here.
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  async function resend() {
    if (cooldown > 0) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resend({ type: 'signup', email });
    if (err) {
      setError(err.message);
    } else {
      setNotice(`New code sent to ${email}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
    setBusy(false);
  }

  if (step === 'confirm') {
    return (
      <div className="grid h-full place-items-center bg-surface">
        <form onSubmit={submitCode} className="card w-[380px]">
          <h1 className="font-mono text-lg font-semibold text-accent">Confirm your email</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter the {CODE_LENGTH}-digit code we sent to{' '}
            <span className="text-slate-200">{email}</span>.
          </p>

          <div className="mt-5">
            <label className="label" htmlFor="code">Confirmation code</label>
            <input
              id="code"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              className="field text-center font-mono text-xl tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          {notice && !error && <p className="mt-3 text-sm text-accent">{notice}</p>}

          <button
            type="submit"
            disabled={busy || code.length !== CODE_LENGTH}
            className="btn-primary mt-5 w-full"
          >
            {busy ? 'Verifying…' : 'Confirm'}
          </button>

          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy || cooldown > 0}
              className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('signin');
                setError(null);
                setNotice(null);
              }}
              className="text-slate-500 hover:text-slate-300"
            >
              Use a different address
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center bg-surface">
      <form onSubmit={submitCredentials} className="card w-[380px]">
        <h1 className="font-mono text-lg font-semibold text-accent">CrafCube Nexus</h1>
        <p className="mt-1 text-sm text-slate-400">
          {step === 'signin' ? 'Sign in to your workspace.' : 'Create your account.'}
        </p>

        <div className="mt-5 space-y-3">
          {step === 'signup' && (
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
              autoComplete={step === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {notice && !error && <p className="mt-3 text-sm text-accent">{notice}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? 'Working…' : step === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => {
            setStep(step === 'signin' ? 'signup' : 'signin');
            setError(null);
            setNotice(null);
          }}
          className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-200"
        >
          {step === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
