'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCheck, Sparkles } from 'lucide-react';
import { PLACEHOLDER_NAME, usePortalData } from '../../_lib/PortalDataProvider';
import { useChatWidget } from '../../_lib/ChatWidgetProvider';
import { ApiError } from '../../_lib/api';
import { shortTime, useNow } from '../../_lib/time';
import type { Connection, ConnectionRequest, Member } from '../../_lib/types';
import Avatar from '../../_components/Avatar';
import CardSkeleton from '../../_components/CardSkeleton';
import MemberCard, { BrowseFooter } from '../../_components/MemberCard';
import StatusPill from '../../_components/StatusPill';
import { useToast } from '../../_components/Toast';

const RECENT_ACTIVITY_DAYS = 30;
const RECENT_ACTIVITY_LIMIT = 5;
const ATTENTION_LIMIT = 4;

type AttentionItem =
  | { kind: 'request'; at: string; request: ConnectionRequest }
  | { kind: 'message'; at: string; connection: Connection };

function activityLabel(r: ConnectionRequest, outgoing: boolean, name: string): string {
  if (outgoing) return r.requestType === 'referral' ? `You asked ${name} for a referral` : `You asked ${name} to connect`;
  return r.requestType === 'referral' ? `${name} asked you for a referral` : `${name} asked to connect`;
}

export default function DashboardPage() {
  const { currentUser, currentUserId, state, loadProfessionals, getCachedProfessionals, respondToRequest, isConnectionUnread } =
    usePortalData();
  const { openChat } = useChatWidget();
  const toast = useToast();
  const now = useNow();
  const [respondingId, setRespondingId] = useState<string | null>(null);

  function pickSuggested(list: Member[]): Member[] {
    const alreadyInTouch = new Set([
      ...state.requests.map(r => (r.fromId === currentUserId ? r.toId : r.fromId)),
      ...state.connections.flatMap(c => c.memberIds),
    ]);
    return list.filter(m => m.id !== currentUserId && !alreadyInTouch.has(m.id)).slice(0, 3);
  }

  // Dashboard and Discover both start from the same unfiltered query, so if
  // Discover (or an earlier Dashboard visit) already fetched it this
  // session, show that immediately instead of blanking to a skeleton and
  // re-fetching every time you switch back here.
  const cached = getCachedProfessionals();
  const [suggested, setSuggested] = useState<Member[]>(() => (cached ? pickSuggested(cached) : []));
  const [suggestedLoading, setSuggestedLoading] = useState(() => cached === null);

  useEffect(() => {
    // Still refreshes in the background even when cached data was shown
    // right away, so the suggestions don't go stale for the rest of the
    // session - it just doesn't flash a loading state to do it.
    loadProfessionals({})
      .then(({ members: list }) => setSuggested(pickSuggested(list)))
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

  // Newest first by actual time - state.requests is incoming-then-outgoing in
  // API order, so slicing it directly used to hide incoming requests.
  const activityCutoff = new Date(now - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const recentActivity = state.requests
    .filter(r => (r.fromId === currentUserId || r.toId === currentUserId) && r.createdAtIso >= activityCutoff)
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
    .slice(0, RECENT_ACTIVITY_LIMIT);

  // What's waiting on me: requests to answer and conversations I haven't read.
  const attentionItems: AttentionItem[] = [
    ...incomingPending.map(request => ({ kind: 'request' as const, at: request.createdAtIso, request })),
    ...activeConnections
      .filter(c => c.lastMessage && isConnectionUnread(c.id))
      .map(connection => ({ kind: 'message' as const, at: connection.lastMessage!.createdAtIso, connection })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  async function handleRespond(requestId: string, decision: 'accepted' | 'declined') {
    setRespondingId(requestId);
    try {
      await respondToRequest(requestId, decision);
      toast(decision === 'accepted' ? 'Request accepted.' : 'Request declined.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not update that request. Try again.', 'error');
    } finally {
      setRespondingId(null);
    }
  }

  // Mirrors the backend's Profile.is_actually_complete(): photo, name, bio,
  // location, and either the student or the professional fields filled in.
  const hasType = Boolean((currentUser.university && currentUser.major) || (currentUser.company && currentUser.role));
  const completenessUnits = [
    currentUser.hasAvatar,
    Boolean(currentUser.name && currentUser.name !== PLACEHOLDER_NAME),
    Boolean(currentUser.bio.trim()),
    Boolean(currentUser.location?.trim()),
    hasType,
  ];
  const completeness = Math.round((completenessUnits.filter(Boolean).length / completenessUnits.length) * 100);

  return (
    <>
      <div className="portal-page-head">
        <h1>Welcome back, {currentUser.name.split(' ')[0]}</h1>
        <p>Here&apos;s what&apos;s happening in your UPSA network.</p>
      </div>

      <div className="profile-grid" style={{ marginBottom: 22 }}>
        {completeness < 100 ? (
          <div className="detail-card">
            <h3>Profile completeness</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${completeness}%` }} />
              </div>
              <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: 'var(--ink-2)' }}>{completeness}%</span>
            </div>
            <p style={{ marginTop: 12 }}>
              <Link href="/portal/profile" style={{ color: 'var(--moss)', fontWeight: 600 }}>Finish your profile &rarr;</Link>
            </p>
          </div>
        ) : (
          <div className="detail-card">
            <h3>Needs your attention</h3>
            {attentionItems.length === 0 ? (
              <div className="attention-empty">
                <CheckCheck size={18} aria-hidden="true" />
                <div>
                  <strong>You&apos;re all caught up.</strong>
                  <Link href="/portal/discover" className="text-link">Find someone new in Discover &rarr;</Link>
                </div>
              </div>
            ) : (
              <ul className="attention-list">
                {attentionItems.slice(0, ATTENTION_LIMIT).map(item => {
                  if (item.kind === 'request') {
                    const r = item.request;
                    const other = state.members[r.fromId];
                    if (!other) return null;
                    const busy = respondingId === r.id;
                    return (
                      <li className="attention-row" key={`r${r.id}`}>
                        <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
                        <div className="attention-row-body">
                          <Link href={`/portal/professionals/${other.id}`} className="attention-row-title">
                            {activityLabel(r, false, other.name)}
                          </Link>
                          <time className="attention-row-time" dateTime={r.createdAtIso}>{shortTime(r.createdAtIso, now)}</time>
                        </div>
                        <div className="attention-row-actions">
                          <button className="btn-primary btn-sm" disabled={busy} onClick={() => handleRespond(r.id, 'accepted')}>Accept</button>
                          <button className="btn-outline btn-sm" disabled={busy} onClick={() => handleRespond(r.id, 'declined')}>Decline</button>
                        </div>
                      </li>
                    );
                  }
                  const c = item.connection;
                  const other = state.members[c.memberIds.find(id => id !== currentUserId)!];
                  if (!other) return null;
                  return (
                    <li key={`c${c.id}`}>
                      <button type="button" className="attention-row attention-row-button" onClick={() => openChat(c.id)}>
                        <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
                        <div className="attention-row-body">
                          <span className="attention-row-title">
                            {other.name}
                            <span className="thread-item-unread-dot" aria-label="Unread" />
                          </span>
                          <span className="attention-row-preview">{c.lastMessage!.text}</span>
                        </div>
                        <time className="attention-row-time" dateTime={item.at}>{shortTime(item.at, now)}</time>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {attentionItems.length > ATTENTION_LIMIT && (
              <p className="attention-more">
                +{attentionItems.length - ATTENTION_LIMIT} more &middot; <Link href="/portal/requests" className="text-link">Requests</Link>
                {' '}&middot; <Link href="/portal/messages" className="text-link">Messages</Link>
              </p>
            )}
          </div>
        )}
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
        <div className="member-grid" style={{ marginBottom: 32 }}>
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : suggested.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 32 }}>
          <span>No new suggestions right now, check back soon or browse everyone in Discover.</span>
        </div>
      ) : (
        <div className="member-grid" style={{ marginBottom: 32 }}>
          {suggested.map(pro => (
            <MemberCard key={pro.id} member={pro} href={`/portal/professionals/${pro.id}`} footer={<BrowseFooter />} />
          ))}
        </div>
      )}

      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>Recent activity</h2>
      {recentActivity.length === 0 ? (
        <div className="empty-state compact">
          <Sparkles className="empty-state-icon" aria-hidden="true" />
          <span>No activity in the last {RECENT_ACTIVITY_DAYS} days.</span>
          <div className="empty-state-actions">
            <Link href="/portal/discover" className="btn-outline btn-sm">Find someone to connect with</Link>
          </div>
        </div>
      ) : (
        <div className="req-list">
          {recentActivity.map(r => {
            const outgoingReq = r.fromId === currentUserId;
            const other = state.members[outgoingReq ? r.toId : r.fromId];
            if (!other) return null;
            return (
              <div className="req-card req-card-static" key={r.id}>
                <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
                <div className="req-card-body">
                  <div className="req-card-top">
                    <Link href={`/portal/professionals/${other.id}`} className="req-card-name">
                      {activityLabel(r, outgoingReq, other.name)}
                    </Link>
                    <StatusPill status={r.status} />
                  </div>
                  <time className="req-card-sub" dateTime={r.createdAtIso}>{shortTime(r.createdAtIso, now)}</time>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
