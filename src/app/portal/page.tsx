import Link from 'next/link';
import { Compass, Send, TrendingUp } from 'lucide-react';
import BrandMark from './_components/BrandMark';

export const metadata = { title: 'Welcome' };

const STEPS = [
  { icon: Compass, title: 'Discover', body: 'Search UPSA professionals by company, industry, university, and what they’re open to.' },
  { icon: Send, title: 'Connect', body: 'Send a short, direct request. No cold outreach, no guesswork about who’s open to talking.' },
  { icon: TrendingUp, title: 'Grow', body: 'Once accepted, coordinate a conversation and keep the connection going in one place.' },
];

export default function PortalLandingPage() {
  return (
    <div className="portal-guest">
      <header className="portal-guest-header">
        <Link href="/portal" className="portal-guest-brand"><BrandMark /></Link>
        <Link href="/" className="portal-guest-back">&larr; unitedpsa.org</Link>
      </header>

      <section className="portal-hero-split">
        <div className="portal-hero-copy">
          <span className="sec-tag">Community &amp; Mentor Portal</span>
          <h1>Find your <em>mentor</em>. Grow the network.</h1>
          <p className="lede">
            A home for UPSA students, alumni, and professionals to find mentorship, discuss careers, and build a
            nationwide professional network.
          </p>
          <div className="portal-hero-actions">
            <Link href="/portal/sign-up" className="btn-primary">Create an account &rarr;</Link>
            <Link href="/portal/sign-in" className="btn-outline">Sign in</Link>
          </div>
          <p className="portal-hero-fine">
            Free, always. No subscription, donation, or payment is ever required. Referrals mentioned by a
            professional are never guaranteed, providing one is entirely at that individual&apos;s discretion.
          </p>
        </div>

        <div className="portal-hero-panel">
          <span className="sec-tag">How it works</span>
          <ol className="portal-hero-steps">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.title}>
                  <span className="portal-hero-step-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="portal-hero-step-icon"><Icon size={26} strokeWidth={2.2} /></span>
                  <div>
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
