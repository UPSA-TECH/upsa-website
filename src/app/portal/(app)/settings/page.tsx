'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { usePortalData } from '../../_lib/PortalDataProvider';
import { useToast } from '../../_components/Toast';
import { ApiError } from '../../_lib/api';

export default function SettingsPage() {
  const { currentUser, updateProfile, setDeactivated } = usePortalData();
  const { user } = useUser();
  const toast = useToast();

  async function toggleReferrals(value: boolean) {
    try {
      await updateProfile({ referralsAvailable: value });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that change. Try again.', 'error');
    }
  }

  async function handleDeactivate() {
    if (!window.confirm('Deactivate your account? Your profile will stop appearing in Discover.')) return;
    try {
      await setDeactivated(true);
      toast('Account deactivated.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not deactivate your account. Try again.', 'error');
    }
  }

  return (
    <>
      <div className="portal-page-head">
        <h1>Settings &amp; Privacy</h1>
        <p>Control what other members can see and how you show up in Discover.</p>
      </div>

      <div className="settings-section">
        <h2>Account</h2>
        <p className="desc">Signed in as <strong>{user?.primaryEmailAddress?.emailAddress ?? '...'}</strong></p>
      </div>

      <div className="settings-section">
        <h2>Discoverability</h2>
        <p className="desc">
          {currentUser.isProfessional
            ? "You're listed as a mentor/professional, so you're automatically visible in Discover, no switch needed."
            : <>Not listed yet. List yourself as a mentor/professional from your <Link href="/portal/profile" style={{ color: 'var(--moss)', fontWeight: 600 }}>Profile</Link>.</>}
        </p>
        <div className="settings-row">
          <div className="copy">
            <strong>Open to referral conversations</strong>
            <span>Shown as a note on your profile and offered as a request reason. A referral is never guaranteed, this only signals you&apos;re open to the conversation.</span>
          </div>
          <label className="switch">
            <input aria-label="Open to referral conversations" type="checkbox" checked={currentUser.referralsAvailable} onChange={e => toggleReferrals(e.target.checked)} />
            <span className="track" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h2>Email notifications</h2>
        <p className="desc">We email you when someone sends you a connection request, accepts yours, or messages you. The email only says that something happened. It never includes what was written.</p>
        <div className="settings-row">
          <div className="copy">
            <strong>Email me about new activity</strong>
            <span>Message emails are sent at most once every 15 minutes per conversation.</span>
          </div>
          <label className="switch">
            <input
              aria-label="Email me about new activity"
              type="checkbox"
              checked={currentUser.emailNotifications}
              onChange={async e => {
                try {
                  await updateProfile({ emailNotifications: e.target.checked });
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : 'Could not save that change. Try again.', 'error');
                }
              }}
            />
            <span className="track" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h2>Privacy</h2>
        <p className="desc">These are built in and not something you need to manage.</p>
        <div className="settings-row">
          <div className="copy">
            <strong>Your email stays private</strong>
            <span>Other members never see your email address, even after a connection is accepted. They only see the profile details you add.</span>
          </div>
          <span className="switch"><input type="checkbox" defaultChecked disabled /><span className="track" /></span>
        </div>
        <div className="settings-row">
          <div className="copy">
            <strong>Resumes only go to who you send them to</strong>
            <span>Sent straight from your computer into a specific conversation - never stored on your profile or visible to anyone else.</span>
          </div>
          <span className="switch"><input type="checkbox" defaultChecked disabled /><span className="track" /></span>
        </div>
      </div>

      <div className="settings-section danger-zone">
        <h2>Deactivate account</h2>
        <p className="desc">Your profile stops appearing in Discover. You can reactivate any time.</p>
        <button className="btn-outline btn-sm" onClick={handleDeactivate}>Deactivate account</button>
      </div>
    </>
  );
}
