import type { ReactNode } from 'react';
import authBg from '@/assets/auth-bg.webp';
import { BrandLockup } from '@/components/Logo';
import { WindowControls } from '@/components/WindowControls';

interface AuthLayoutProps {
  children: ReactNode;
  /** Highlighted step in the top-right rail. */
  step?: 'manage' | 'print' | 'deliver';
}

const STEPS = ['manage', 'print', 'deliver'] as const;

/**
 * Full-bleed brand artwork with the lockup on the left and the form panel on
 * the right. The whole surface is a drag region since there is no native frame.
 */
export function AuthLayout({ children, step = 'manage' }: AuthLayoutProps) {
  return (
    <div className="drag relative h-full overflow-hidden bg-ink-900">
      <img
        src={authBg}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Darkening wash keeps text legible over the brighter parts of the photo. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,8,13,0.92) 0%, rgba(0,8,13,0.55) 45%, rgba(0,8,13,0.75) 100%)',
        }}
      />

      <div className="absolute right-0 top-0 z-20 flex items-center">
        <nav className="no-drag mr-3 hidden items-center gap-3 text-[11px] tracking-[0.2em] lg:flex">
          <span className="rule" />
          {STEPS.map((name, i) => (
            <span key={name} className="flex items-center gap-3">
              {i > 0 && <span className="text-slate-600">/</span>}
              <span className={name === step ? 'text-mint' : 'text-slate-500'}>
                {name.toUpperCase()}
              </span>
            </span>
          ))}
        </nav>
        <WindowControls />
      </div>

      <div className="relative z-10 grid h-full grid-cols-1 items-center gap-8 px-14 lg:grid-cols-2">
        <div className="hidden lg:block">
          <BrandLockup />
        </div>
        <div className="no-drag flex justify-center lg:justify-end lg:pr-10">{children}</div>
      </div>
    </div>
  );
}

/** Leading-icon wrapper for auth inputs. */
export function IconField({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
        {icon}
      </span>
      {children}
    </div>
  );
}

export function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="3" width="13" height="10" rx="1.6" />
      <path d="M1.8 4 L8 8.6 L14.2 4" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="7" width="10" height="7" rx="1.6" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M2.8 13.5c0-2.6 2.3-4.2 5.2-4.2s5.2 1.6 5.2 4.2" />
    </svg>
  );
}
