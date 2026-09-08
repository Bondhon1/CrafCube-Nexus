import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AuthLayout,
  IconField,
  LockIcon,
  MailIcon,
  UserIcon,
} from '@/components/AuthLayout';

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
      <AuthLayout step="manage">
        <form onSubmit={submitCode} className="glass w-[380px] animate-fade-up">
          <h1 className="text-lg font-semibold text-mint">Confirm your email</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Enter the {CODE_LENGTH}-digit code we sent to{' '}
            <span className="text-slate-200">{email}</span>.
          </p>

          <div className="mt-6">
            <label className="label" htmlFor="code">Confirmation code</label>
            <input
              id="code"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              className="field text-center font-mono text-2xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
          </div>

          <Feedback error={error} notice={notice} />

          <button
            type="submit"
            disabled={busy || code.length !== CODE_LENGTH}
            className="btn-primary mt-5 w-full"
          >
            {busy ? 'Verifying…' : 'Confirm'}
          </button>

          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy || cooldown > 0}
              className="text-slate-400 transition-colors hover:text-mint disabled:opacity-40"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('signin'); setError(null); setNotice(null); }}
              className="text-slate-500 transition-colors hover:text-slate-300"
            >
              Use a different address
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout step="manage">
      <form onSubmit={submitCredentials} className="glass w-[380px] animate-fade-up">
        <h1 className="text-lg font-semibold">
          <span className="text-white">Craf</span>
          <span className="text-mint">Cube</span>
          <span className="ml-1.5 font-light tracking-wide text-slate-300">Nexus</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          {step === 'signin' ? 'Sign in to your workspace.' : 'Create your account.'}
        </p>

        <div className="mt-6 space-y-4">
          {step === 'signup' && (
            <div>
              <label className="label" htmlFor="name">Full name</label>
              <IconField icon={<UserIcon />}>
                <input
                  id="name"
                  className="field field-icon"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </IconField>
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <IconField icon={<MailIcon />}>
              <input
                id="email"
                type="email"
                required
                autoFocus
                className="field field-icon"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </IconField>
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <IconField icon={<LockIcon />}>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                className="field field-icon"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={step === 'signin' ? 'current-password' : 'new-password'}
              />
            </IconField>
          </div>
        </div>

        <Feedback error={error} notice={notice} />

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
          {busy ? 'Working…' : step === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          {step === 'signin' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setStep(step === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
            className="font-medium text-mint transition-colors hover:text-mint-500"
          >
            {step === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) {
    return (
      <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="mt-4 rounded-md border border-mint/25 bg-mint/10 px-3 py-2 text-sm text-mint">
        {notice}
      </p>
    );
  }
  return null;
}
