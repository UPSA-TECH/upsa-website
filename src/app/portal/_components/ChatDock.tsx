'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { usePortalData } from '../_lib/PortalDataProvider';
import { useChatWidget } from '../_lib/ChatWidgetProvider';
import ChatPopup from './ChatPopup';

export default function ChatDock() {
  const { state, currentUserId, isConnectionUnread } = usePortalData();
  const { openChats, minimized, openChat, toggleMinimize } = useChatWidget();

  const myConnections = state.connections.filter(c => c.memberIds.includes(currentUserId));
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
          <span>Messaging</span>
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
                return (
                  <button
                    key={c.id}
                    className="chat-dock-item"
                    onClick={() => {
                      openChat(c.id);
                      if (minimized[c.id]) toggleMinimize(c.id);
                    }}
                  >
                    <span className="chat-dock-item-name">
                      {other.name}
                      {isConnectionUnread(c.id) && <span className="thread-item-unread-dot" aria-label="Unread" />}
                    </span>
                    <span className="chat-dock-item-preview">{c.lastMessage ? c.lastMessage.text : 'Say hello'}</span>
                  </button>
                );
              })
            )}
            <Link href="/portal/messages" className="chat-dock-see-all">See all conversations</Link>
          </div>
        )}
      </div>
    </div>
  );
}
