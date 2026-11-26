'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { usePortalData } from '../_lib/PortalDataProvider';
import { useChatWidget } from '../_lib/ChatWidgetProvider';
import { byLatestMessage, shortTime, useNow } from '../_lib/time';
import ChatPopup from './ChatPopup';

export default function ChatDock() {
  const { state, currentUserId, isConnectionUnread, unreadMessageCount } = usePortalData();
  const { openChats, minimized, openChat } = useChatWidget();
  const now = useNow();

  const myConnections = state.connections.filter(c => c.memberIds.includes(currentUserId)).sort(byLatestMessage);
  const [barOpen, setBarOpen] = useState(false);

  return (
    <div className="chat-dock" aria-live="off">
      <div className="chat-dock-popups">
        {openChats.map(id => (
          <ChatPopup key={id} connectionId={id} minimized={!!minimized[id]} />
        ))}
      </div>

      <div className="chat-dock-bar">
        <button className="chat-dock-bar-head" onClick={() => setBarOpen(o => !o)} aria-expanded={barOpen}>
          <MessageSquare size={16} />
          <span className="chat-dock-bar-label">Messaging</span>
          {unreadMessageCount > 0 && <span className="count">{unreadMessageCount}</span>}
          {barOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {barOpen && (
          <div className="chat-dock-list">
            {myConnections.length === 0 ? (
              <p className="chat-dock-empty">No conversations yet.</p>
            ) : (
              myConnections.map(c => {
                const otherId = c.memberIds.find(id => id !== currentUserId)!;
                const other = state.members[otherId];
                if (!other) return null;
                const unread = isConnectionUnread(c.id);
                return (
                  <button
                    key={c.id}
                    className={`chat-dock-item${unread ? ' unread' : ''}`}
                    // openChat already un-minimizes; toggling here as well
                    // flipped a minimized chat straight back to minimized.
                    onClick={() => openChat(c.id)}
                  >
                    <span className="chat-dock-item-row">
                      <span className="chat-dock-item-name">
                        {other.name}
                        {unread && <span className="thread-item-unread-dot" aria-label="Unread" />}
                      </span>
                      {c.lastMessage && (
                        <time className="chat-dock-item-time" dateTime={c.lastMessage.createdAtIso}>
                          {shortTime(c.lastMessage.createdAtIso, now)}
                        </time>
                      )}
                    </span>
                    <span className="chat-dock-item-preview">{c.lastMessage ? c.lastMessage.text : 'Say hello'}</span>
                  </button>
                );
              })
            )}
            {myConnections.length > 0 && <Link href="/portal/messages" className="chat-dock-see-all">See all conversations</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
