'use client';

import { MessageSquareOff } from 'lucide-react';
import { usePortalData } from '../../_lib/PortalDataProvider';
import { useChatWidget } from '../../_lib/ChatWidgetProvider';
import Avatar from '../../_components/Avatar';

export default function MessagesIndexPage() {
  const { state, currentUserId, isConnectionUnread } = usePortalData();
  const { openChat } = useChatWidget();
  const connections = state.connections.filter(c => c.memberIds.includes(currentUserId));

  return (
    <>
      <div className="portal-page-head">
        <h1>Messages</h1>
        <p>Conversations with your active and past connections. Click one to chat - it opens in a window at the bottom of the screen, so you can keep browsing while you talk.</p>
      </div>

      {connections.length === 0 ? (
        <div className="empty-state">
          <MessageSquareOff className="empty-state-icon" aria-hidden="true" />
          <span>No conversations yet. They start once a connection is accepted.</span>
        </div>
      ) : (
        <div className="thread-list thread-list-standalone">
          {connections.map(c => {
            const otherId = c.memberIds.find(id => id !== currentUserId)!;
            const other = state.members[otherId];
            if (!other) return null;
            const last = c.lastMessage;
            const unread = isConnectionUnread(c.id);
            return (
              <button className="thread-item" key={c.id} onClick={() => openChat(c.id)}>
                <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
                <div>
                  <div className="thread-item-name">
                    {other.name}
                    {unread && <span className="thread-item-unread-dot" aria-label="Unread" />}
                  </div>
                  <div className="thread-item-preview">{last ? last.text : 'Say hello'}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
