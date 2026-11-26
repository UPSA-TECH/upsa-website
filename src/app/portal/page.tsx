import fs from 'fs';
import path from 'path';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import BrandMark from './_components/BrandMark';
import AuthPanel, { type AuthMode } from './_components/AuthPanel';

export const metadata = { title: 'Welcome' };

// Drop a photo at public/portal-hero.jpg and the next build shows it behind
// the sign-in card. Until then that panel is the moss gradient, which is
// designed to stand on its own.
const HERO_IMAGE = '/portal-hero.jpg';
const hasHeroImage = fs.existsSync(path.join(process.cwd(), 'public', HERO_IMAGE));

// /portal is both the landing page and the sign-in/sign-up page.
// /portal/sign-in and /portal/sign-up redirect here (see their page.tsx).
export default async function PortalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { userId } = await auth();
  if (userId) redirect('/portal/dashboard');

  const { mode } = await searchParams;
  const initialMode: AuthMode = mode === 'sign-up' ? 'sign-up' : 'sign-in';

  return (
    <div className="portal-guest">
      <header className="portal-guest-header">
        <Link href="/portal" className="portal-guest-brand"><BrandMark /></Link>
        <Link href="/" className="portal-guest-back">&larr; unitedpsa.org</Link>
      </header>

      {/* A div, not <main>: the root layout already wraps every page in <main>. */}
      <div className="portal-entry">
        <div className="portal-entry-intro">
          <span className="sec-tag">Community &amp; Mentor Portal</span>
          <h1>Find your <em>mentor</em>. Grow the network.</h1>
          <p className="lede">
            A home for UPSA students, alumni, and professionals to find mentorship, discuss careers, and build a
            nationwide professional network.
          </p>
          <p className="portal-hero-fine">
            <strong>Free, always.</strong> No subscription, donation, or payment is ever required. Referrals mentioned
            by a professional are never guaranteed, providing one is entirely at that individual&apos;s discretion.
          </p>
        </div>

        <div className={`portal-entry-visual${hasHeroImage ? ' has-image' : ''}`}>
          {hasHeroImage && (
            <Image
              src={HERO_IMAGE}
              alt=""
              fill
              priority
              sizes="(max-width: 960px) 100vw, 46vw"
              className="portal-entry-visual-img"
            />
          )}
          <AuthPanel key={initialMode} initialMode={initialMode} />
        </div>
      </div>
    </div>
  );
}
