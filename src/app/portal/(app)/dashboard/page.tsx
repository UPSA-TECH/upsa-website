'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { usePortalData } from '../../_lib/PortalDataProvider';
import type { Member } from '../../_lib/types';
import Avatar from '../../_components/Avatar';
import CardSkeleton from '../../_components/CardSkeleton';
import StatusPill from '../../_components/StatusPill';

export default function DashboardPage() {
  const { currentUser, currentUserId, state, loadProfessionals } = usePortalData();
  const [suggested, setSuggested] = useState<Member[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(true);

  useEffect(() => {
    loadProfessionals({})
      .then(({ members: list }) => {
        const alreadyInTouch = new Set([
          ...state.requests.map(r => (r.fromId === currentUserId ? r.toId : r.fromId)),
          ...state.connections.flatMap(c => c.memberIds),
        ]);
        setSuggested(list.filter(m => m.id !== currentUserId && !alreadyInTouch.has(m.id)).slice(0, 3));
      })
      .finally(() => setSuggestedLoading(false));
    // Only ever needs to run once on mount, against whatever's already loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outgoing = state.requests.filter(r => r.fromId === currentUserId);
  const incomingPending = state.requests.filter(r => r.toId === currentUserId && r.status === 'pending');
  const activeConnections = state.connections.filter(
    c => c.memberIds.includes(currentUserId) && c.status === 'active'
  );
  const pendingOutgoing = outgoing.filter(r => r.status === 'pending');

  const recentActivity = [...state.requests]
    .filter(r => r.fromId === currentUserId || r.toId === currentUserId)
    .slice(-4)
    .reverse();

  const profileFieldsFilled = [currentUser.name, currentUser.university, currentUser.bio, currentUser.major].filter(Boolean).length;
  const completeness = Math.round((profileFieldsFilled / 4) * 100);

  return (
    <>
      <div className="portal-page-head">
        <h1>Welcome back, {currentUser.name.split(' ')[0]}</h1>
        <p>Here&apos;s what&apos;s happening in your UPSA network.</p>
      </div>

      <div className="profile-grid" style={{ marginBottom: 22 }}>
        <div className="detail-card">
          <h3>Profile completeness</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${completeness}%` }} />
            </div>
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: 'var(--ink-2)' }}>{completeness}%</span>
          </div>
          {completeness < 100 && (
            <p style={{ marginTop: 12 }}>
              <Link href="/portal/profile" style={{ color: 'var(--moss)', fontWeight: 600 }}>Finish your profile &rarr;</Link>
            </p>
          )}
        </div>
        <div className="detail-card">
          <h3>Snapshot</h3>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-num">{incomingPending.length}</div>
              <div className="stat-label">Incoming requests</div>
            </div>
            <div className="stat-tile">
              <div className="stat-num">{pendingOutgoing.length}</div>
              <div className="stat-label">Awaiting reply</div>
            </div>
            <div className="stat-tile">
              <div className="stat-num">{activeConnections.length}</div>
              <div className="stat-label">Active connections</div>
            </div>
          </div>
        </div>
      </div>

      <div className="portal-page-head-row" style={{ marginBottom: 14 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: 'var(--ink)' }}>Suggested for you</h2>
        <Link href="/portal/discover" className="btn-ghost" style={{ padding: 0 }}>See all &rarr;</Link>
      </div>
      {suggestedLoading ? (
        <div className="pf-grid" style={{ marginBottom: 32 }}>
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : suggested.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 32 }}>
          <span>No new suggestions right now, check back soon or browse everyone in Discover.</span>
        </div>
      ) : (
        <div className="pf-grid" style={{ marginBottom: 32 }}>
          {suggested.map(pro => (
            <Link href={`/portal/professionals/${pro.id}`} key={pro.id} className="pf-card">
              <div className="pf-card-top">
                <Avatar name={pro.name} initials={pro.initials} color={pro.avatarColor} imageUrl={pro.avatarUrl} size="md" />
                <div>
                  <div className="pf-card-name">{pro.name}</div>
                  <div className="pf-card-headline">{pro.role} &middot; {pro.company}</div>
                </div>
              </div>
              {pro.referralsAvailable && (
                <div className="pf-card-avail">
                  <span className="avail-pill referrals">Open to referrals</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>Recent activity</h2>
      {recentActivity.length === 0 ? (
        <div className="empty-state">
          <Sparkles className="empty-state-icon" aria-hidden="true" />
          <span>Nothing yet. Head to Discover to send your first request.</span>
        </div>
      ) : (
        <div className="req-list">
          {recentActivity.map(r => {
            const outgoingReq = r.fromId === currentUserId;
            const other = state.members[outgoingReq ? r.toId : r.fromId];
            if (!other) return null;
            return (
              <div className="req-card" key={r.id}>
                <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
                <div className="req-card-body">
                  <div className="req-card-top">
                    <span className="req-card-name">
                      {outgoingReq ? `You requested ${other.name}` : `${other.name} requested to connect`}
                    </span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="req-card-sub">{r.createdAt}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
