import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';
import { Compass, Send, ShieldCheck } from 'lucide-react';
import { portalClerkAppearance } from '@/lib/portal-clerk-appearance';
import BrandMark from '../../_components/BrandMark';

export const metadata = { title: 'Create Account' };

export default function PortalSignUpPage() {
  return (
    <div className="portal-guest">
      <header className="portal-guest-header">
        <Link href="/portal" className="portal-guest-brand"><BrandMark /></Link>
        <Link href="/portal" className="portal-guest-back">&larr; Back</Link>
      </header>

      <div className="portal-auth-shell">
        <div className="portal-auth-intro">
          <div className="portal-auth-intro-inner">
            <span className="sec-tag">Community &amp; Mentor Portal</span>
            <h2>Find your <em>mentor</em>.<br />Grow the network.</h2>
            <p>A home for UPSA students, alumni, and professionals to find mentorship, discuss careers, and build a nationwide professional network.</p>
            <ul className="portal-auth-points">
              <li><Compass /> Search UPSA professionals by company, industry, university, and what they&apos;re open to.</li>
              <li><Send /> Send a short, direct request. No cold outreach, no guessing who&apos;s open to talking.</li>
              <li><ShieldCheck /> Free, always. No subscription or payment is ever required.</li>
            </ul>
          </div>
        </div>

        <div className="portal-auth-form-side">
          <div className="portal-auth-card">
            <h1>Create your account</h1>
            <p className="sub">Join the UPSA Community &amp; Mentor Portal. It&apos;s free.</p>

            <SignUp
              path="/portal/sign-up"
              routing="path"
              signInUrl="/portal/sign-in"
              forceRedirectUrl="/portal/onboarding"
              appearance={portalClerkAppearance}
            />

            <p className="portal-auth-foot" style={{ marginTop: 18 }}>
              The portal is free to use. No payment or donation is ever required to access mentorship or networking.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
