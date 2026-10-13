'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users, MessageSquare, CheckCircle2, Ban, Paperclip } from 'lucide-react';
import { usePortalData } from '../../_lib/PortalDataProvider';
import { useChatWidget } from '../../_lib/ChatWidgetProvider';
import { REQUEST_TYPE_LABELS } from '../../_lib/types';
import { ApiError } from '../../_lib/api';
import Avatar from '../../_components/Avatar';
import StatusPill from '../../_components/StatusPill';
import { useToast } from '../../_components/Toast';

export default function ConnectionsPage() {
  const { state, currentUserId, completeConnection, cancelConnection } = usePortalData();
  const { openChat } = useChatWidget();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const connections = state.connections.filter(c => c.memberIds.includes(currentUserId));

  async function run(id: string, action: () => Promise<void>, successMsg: string, failMsg: string) {
    setBusyId(id);
    try {
      await action();
      toast(successMsg, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : failMsg, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="portal-page-head">
        <h1>My Connections</h1>
        <p>People you&apos;ve connected with. Mark a connection complete once you&apos;ve had your conversation.</p>
      </div>

      {connections.length === 0 ? (
        <div className="empty-state">
          <Users className="empty-state-icon" aria-hidden="true" />
          <span>No connections yet. Accepted requests will show up here.</span>
          <p style={{ marginTop: 14 }}><Link href="/portal/discover" className="btn-outline btn-sm">Browse Discover</Link></p>
        </div>
      ) : (
        <div className="conn-grid">
          {connections.map(c => {
            const otherId = c.memberIds.find(id => id !== currentUserId)!;
            const other = state.members[otherId];
            if (!other) return null;
            const sourceRequest = state.requests.find(r => r.id === c.requestId);
            const busy = busyId === c.id;
            return (
              <div className="conn-card" key={c.id}>
                <div className="conn-card-top">
                  <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="md" />
                  <div>
                    <div className="conn-card-name">{other.name}</div>
                    <div className="conn-card-sub">{other.role ? `${other.role} · ${other.company}` : other.headline}</div>
                  </div>
                </div>
                <div className="conn-card-sub">
                  Connected {c.since}
                  {sourceRequest && <> &middot; {REQUEST_TYPE_LABELS[sourceRequest.requestType]}</>}
                </div>

                <div className="conn-card-sub">
                  {state.resumeSharedWith.includes(c.id) ? (
                    <span style={{ color: 'var(--moss)', fontWeight: 600 }}>Resume shared with {other.name.split(' ')[0]}</span>
                  ) : state.resume ? (
                    <button className="btn-ghost" style={{ padding: 0 }} onClick={() => openChat(c.id)}>
                      <Paperclip size={15} /> Share your resume from the chat
                    </button>
                  ) : (
                    <span>No resume uploaded yet. <Link href="/portal/profile" style={{ color: 'var(--moss)', fontWeight: 600 }}>Add one</Link> to share it in chat.</span>
                  )}
                </div>

                <div className="conn-card-foot">
                  <StatusPill status={c.status} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-outline btn-sm" onClick={() => openChat(c.id)}>
                      <MessageSquare size={15} /> Message
                    </button>
                    {c.status === 'active' && (
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => run(c.id, () => completeConnection(c.id), 'Connection marked complete.', 'Could not update that connection. Try again.')}
                      >
                        <CheckCircle2 size={15} /> Mark complete
                      </button>
                    )}
                  </div>
                </div>
                {c.status === 'active' && (
                  <button
                    className="btn-ghost"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={busy}
                    onClick={() => run(c.id, () => cancelConnection(c.id), 'Connection cancelled.', 'Could not cancel that connection. Try again.')}
                  >
                    <Ban size={15} /> Cancel connection
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
