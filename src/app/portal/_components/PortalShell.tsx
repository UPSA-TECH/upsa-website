'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { LayoutDashboard, Compass, Inbox, Users, MessageSquare, UserCircle, Settings, LogOut, Menu, X, Bell, UserX } from 'lucide-react';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import Avatar from './Avatar';
import RoleTag from './RoleTag';
import BrandMark from './BrandMark';
import BugReportWidget from './BugReportWidget';
import { useToast } from './Toast';

const NAV_ITEMS = [
  { href: '/portal/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portal/discover', label: 'Discover', icon: Compass },
  { href: '/portal/requests', label: 'Requests', icon: Inbox, countKey: 'incoming' as const },
  { href: '/portal/connections', label: 'Connections', icon: Users },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare, countKey: 'messages' as const },
  { href: '/portal/profile', label: 'My Profile', icon: UserCircle },
  { href: '/portal/settings', label: 'Settings', icon: Settings },
];

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useClerk();
  const { currentUser, currentUserId, state, setDeactivated, unreadMessageCount } = usePortalData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Signing in (unlike signing up) skips onboarding, so send anyone who never
  // finished it there instead of showing an empty "New member" profile - and
  // send anyone whose profile predates the mandatory fields (bio, skills,
  // photo) added later back through it too, since onboardingComplete covers
  // both cases. Not a one-time thing: it stays enforced on every visit until
  // the profile actually is complete.
  const needsOnboarding = !currentUser.onboardingComplete;
  useEffect(() => {
    if (needsOnboarding) router.replace('/portal/onboarding');
  }, [needsOnboarding, router]);

  const incomingCount = state.requests.filter(r => r.toId === currentUserId && r.status === 'pending').length;

  async function handleReactivate() {
    setReactivating(true);
    try {
      await setDeactivated(false);
      toast('Account reactivated.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not reactivate your account. Try again.', 'error');
    } finally {
      setReactivating(false);
    }
  }

  return (
    <div className="portal-shell">
      <aside className={`portal-sidebar${open ? ' open' : ''}`}>
        <div className="portal-sidebar-brand">
          <BrandMark on="dark" />
        </div>

        <div className="portal-sidebar-user">
          <Avatar name={currentUser.name} initials={currentUser.initials} color={currentUser.avatarColor} imageUrl={currentUser.avatarUrl} size="md" />
          <div>
            <div className="name">{currentUser.name}</div>
            <div className="role">{currentUser.headline}</div>
            <div style={{ marginTop: 6 }}><RoleTag isStudent={Boolean(currentUser.university && currentUser.major)} isProfessional={currentUser.isProfessional} /></div>
          </div>
        </div>

        <nav className="portal-nav" aria-label="Portal navigation">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || (item.href !== '/portal/dashboard' && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? 'active' : ''}
                onClick={() => setOpen(false)}
              >
                <span className="portal-nav-label"><Icon size={18} strokeWidth={2} />{item.label}</span>
                {item.countKey === 'incoming' && incomingCount > 0 && <span className="count">{incomingCount}</span>}
                {item.countKey === 'messages' && unreadMessageCount > 0 && <span className="count">{unreadMessageCount}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="portal-sidebar-foot">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut(() => router.push('/portal'));
            }}
          >
            <LogOut size={15} strokeWidth={2.25} /> Log out
          </button>
          <Link href="/" onClick={() => setOpen(false)}>&larr; Back to unitedpsa.org</Link>
        </div>
      </aside>

      <div className="portal-main">
        <div className={`portal-topbar${scrolled ? ' scrolled' : ''}`}>
          <button className="portal-mobile-toggle" onClick={() => setOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={open}>
            {open ? <X size={18} /> : <Menu size={18} />}
            Menu
          </button>
          {incomingCount > 0 && (
            <Link href="/portal/requests" className="portal-topbar-badge">
              <Bell size={15} strokeWidth={2} /> {incomingCount} new request{incomingCount === 1 ? '' : 's'}
            </Link>
          )}
        </div>
        <div className="portal-content">
          {currentUser.visible || needsOnboarding ? children : (
            <div className="empty-state">
              <UserX className="empty-state-icon" aria-hidden="true" />
              <span>Your account is deactivated.</span>
              <p style={{ marginTop: 14 }}>
                <button className="btn-primary btn-sm" onClick={handleReactivate} disabled={reactivating}>
                  {reactivating ? 'Working…' : 'Reactivate account'}
                </button>
              </p>
            </div>
          )}
        </div>
      </div>

      {open && <div className="portal-sidebar-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <BugReportWidget />
    </div>
  );
}
