'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Users, MessageSquare, Ban, MoreHorizontal, UserMinus } from 'lucide-react';
import { usePortalData } from '../../_lib/PortalDataProvider';
import { useChatWidget } from '../../_lib/ChatWidgetProvider';
import { ApiError } from '../../_lib/api';
import type { Member } from '../../_lib/types';
import MemberCard from '../../_components/MemberCard';
import StatusPill from '../../_components/StatusPill';
import { useToast } from '../../_components/Toast';

type Pending = 'cancel' | 'block' | null;

function ConnectionMenu({
  member,
  canCancel,
  busy,
  onCancel,
  onBlock,
}: {
  member: Member;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
  onBlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstName = member.name.split(' ')[0];

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      setPending(null);
    }
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="card-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-icon"
        aria-label={`More options for ${member.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(o => !o);
          setPending(null);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="card-menu-pop" role="menu">
          {pending === null ? (
            <>
              {canCancel && (
                <button type="button" role="menuitem" className="card-menu-item" onClick={() => setPending('cancel')}>
                  <UserMinus size={15} aria-hidden="true" /> Cancel connection
                </button>
              )}
              <button type="button" role="menuitem" className="card-menu-item danger" onClick={() => setPending('block')}>
                <Ban size={15} aria-hidden="true" /> Block
              </button>
            </>
          ) : (
            <div className="card-menu-confirm">
              <p>
                {pending === 'cancel'
                  ? `End your connection with ${firstName}? You'll need a new request to message again.`
                  : `Block ${firstName}? Neither of you will be able to see each other's profile or message. You can undo this in Settings.`}
              </p>
              <div className="card-menu-confirm-actions">
                <button type="button" className="btn-outline btn-sm" onClick={() => setPending(null)} disabled={busy}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (pending === 'cancel') onCancel();
                    else onBlock();
                    setOpen(false);
                    setPending(null);
                  }}
                >
                  {pending === 'cancel' ? 'Cancel connection' : 'Block'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  const { state, currentUserId, cancelConnection, blockMember, isBlocked } = usePortalData();
  const { openChat, closeChat } = useChatWidget();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const connections = state.connections.filter(
    c => c.memberIds.includes(currentUserId) && !isBlocked(c.memberIds.find(id => id !== currentUserId)!)
  );

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
        <p>People you&apos;ve connected with.</p>
      </div>

      {connections.length === 0 ? (
        <div className="empty-state">
          <Users className="empty-state-icon" aria-hidden="true" />
          <span>No connections yet. Accepted requests will show up here.</span>
          <div className="empty-state-actions"><Link href="/portal/discover" className="btn-outline btn-sm">Browse Discover</Link></div>
        </div>
      ) : (
        <div className="member-grid">
          {connections.map(c => {
            const otherId = c.memberIds.find(id => id !== currentUserId)!;
            const other = state.members[otherId];
            if (!other) return null;
            const busy = busyId === c.id;
            const cancelled = c.status === 'cancelled';
            return (
              <MemberCard
                key={c.id}
                member={other}
                className={cancelled ? 'is-cancelled' : ''}
                meta={`Connected ${c.since.toLowerCase()}`}
                footer={
                  <>
                    {cancelled ? <StatusPill status={c.status} /> : <span />}
                    <div className="member-card-actions">
                      <button className="btn-outline btn-sm" onClick={() => openChat(c.id)}>
                        <MessageSquare size={15} /> Message
                      </button>
                      <ConnectionMenu
                        member={other}
                        canCancel={!cancelled}
                        busy={busy}
                        onCancel={() =>
                          run(c.id, () => cancelConnection(c.id), 'Connection cancelled.', 'Could not cancel that connection. Try again.')
                        }
                        onBlock={() =>
                          run(
                            c.id,
                            async () => {
                              await blockMember(other.id);
                              closeChat(c.id);
                            },
                            `${other.name.split(' ')[0]} is blocked. You can undo this in Settings.`,
                            'Could not block this member. Try again.'
                          )
                        }
                      />
                    </div>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}
