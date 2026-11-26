'use client';

import { useState } from 'react';
import { ClerkLoading, SignIn, SignUp } from '@clerk/nextjs';
import { portalClerkAppearance } from '@/lib/portal-clerk-appearance';

export type AuthMode = 'sign-in' | 'sign-up';

const COPY: Record<AuthMode, { title: string; sub: string; switchText: string; switchLabel: string }> = {
  'sign-in': {
    title: 'Welcome back',
    sub: 'Sign in to pick up your requests and conversations.',
    switchText: 'New to the UPSA portal?',
    switchLabel: 'Create an account',
  },
  'sign-up': {
    title: 'Create your account',
    sub: 'Join the UPSA Community & Mentor Portal. It’s free.',
    switchText: 'Already a member?',
    switchLabel: 'Sign in',
  },
};

// Sign-in and sign-up share one page (/portal), so Clerk runs with hash
// routing: its in-between steps (verify code, second factor, OAuth callback)
// live in the URL hash instead of needing their own /portal/... routes.
export default function AuthPanel({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const copy = COPY[mode];

  function switchTo(next: AuthMode) {
    if (next === mode) return;
    setMode(next);
    // Keep the URL shareable (/portal?mode=sign-up) and drop any half-finished
    // step from the other flow that Clerk left in the hash.
    const url = new URL(window.location.href);
    if (next === 'sign-up') url.searchParams.set('mode', 'sign-up');
    else url.searchParams.delete('mode');
    url.hash = '';
    window.history.replaceState(null, '', url);
  }

  return (
    <div className="portal-auth-card portal-entry-card">
      <div className="auth-switch" role="tablist" aria-label="Sign in or create an account">
        <button type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => switchTo('sign-in')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => switchTo('sign-up')}>
          Create account
        </button>
      </div>

      <h2 className="portal-entry-card-title">{copy.title}</h2>
      <p className="sub">{copy.sub}</p>

      <div className="portal-entry-clerk" role="tabpanel">
        <ClerkLoading>
          <div className="auth-skeleton" aria-hidden="true">
            <span className="auth-skeleton-pill" />
            <span className="auth-skeleton-line" />
            <span className="auth-skeleton-field" />
            <span className="auth-skeleton-pill dark" />
          </div>
        </ClerkLoading>
        {mode === 'sign-in' ? (
          <SignIn
            routing="hash"
            signUpUrl="/portal?mode=sign-up"
            forceRedirectUrl="/portal/dashboard"
            appearance={portalClerkAppearance}
          />
        ) : (
          <SignUp
            routing="hash"
            signInUrl="/portal"
            forceRedirectUrl="/portal/onboarding"
            appearance={portalClerkAppearance}
          />
        )}
      </div>

      <p className="portal-auth-foot">
        {copy.switchText}{' '}
        <button type="button" className="auth-switch-link" onClick={() => switchTo(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          {copy.switchLabel}
        </button>
      </p>
    </div>
  );
}
