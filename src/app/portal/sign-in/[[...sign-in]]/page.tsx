import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { Compass, MessageCircle, ShieldCheck } from 'lucide-react';
import { portalClerkAppearance } from '@/lib/portal-clerk-appearance';
import BrandMark from '../../_components/BrandMark';

export const metadata = { title: 'Sign In' };

export default function PortalSignInPage() {
  return (
    <div className="portal-guest">
      <header className="portal-guest-header">
        <Link href="/portal" className="portal-guest-brand"><BrandMark /></Link>
        <Link href="/portal" className="portal-guest-back">&larr; Back</Link>
      </header>

      <div className="portal-auth-shell">
        <div className="portal-auth-intro">
          <div className="portal-auth-intro-inner">
            <span className="sec-tag">Welcome back</span>
            <h2>Your network<br /><em>picked up right where</em><br />you left it.</h2>
            <p>Pending requests, open conversations, and the people you&apos;ve connected with are all exactly where you left them.</p>
            <ul className="portal-auth-points">
              <li><Compass /> Keep discovering UPSA professionals by company, industry, or university.</li>
              <li><MessageCircle /> Jump back into conversations with people you&apos;ve connected with.</li>
              <li><ShieldCheck /> Free, always. No payment is ever required.</li>
            </ul>
          </div>
        </div>

        <div className="portal-auth-form-side">
          <div className="portal-auth-card">
            <h1>Sign in</h1>
            <p className="sub">Continue to your UPSA Portal.</p>

            <SignIn
              path="/portal/sign-in"
              routing="path"
              signUpUrl="/portal/sign-up"
              forceRedirectUrl="/portal/dashboard"
              appearance={portalClerkAppearance}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
