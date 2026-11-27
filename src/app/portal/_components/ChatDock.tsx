'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { MessageSquare, ChevronUp, ChevronDown, Search, X } from 'lucide-react';
import { usePortalData } from '../_lib/PortalDataProvider';
import { useChatWidget } from '../_lib/ChatWidgetProvider';
import { byLatestMessage, shortTime, useNow } from '../_lib/time';
import type { Connection } from '../_lib/types';
import Avatar from './Avatar';
import ChatPopup from './ChatPopup';

// Keep in sync with .chat-dock-bar / .chat-popup widths in portal.css.
const DOCK_WIDTH = 340;
const POPUP_WIDTH = 360;
const GAP = 12;
const EDGE = 24;

function subscribeToResize(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

// How many chat popups fit beside the dock bar without running off the left
// edge: 3 on a wide screen, 2 on a laptop, 1 on a tablet. (Phones show one
// full-screen chat anyway - see the 640px rules in portal.css.)
function useMaxVisibleChats(): number {
  const width = useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 1440);
  const fit = Math.floor((width - EDGE * 2 - DOCK_WIDTH) / (POPUP_WIDTH + GAP));
  return Math.max(1, Math.min(3, fit));
}

export default function ChatDock() {
  const { state, currentUserId, isConnectionUnread, unreadMessageCount, isBlocked } = usePortalData();
  const { openChats, minimized, openChat } = useChatWidget();
  const now = useNow();
  const maxVisible = useMaxVisibleChats();
  const [barOpen, setBarOpen] = useState(false);
  const [query, setQuery] = useState('');

  const otherIdOf = (c: Connection) => c.memberIds.find(id => id !== currentUserId)!;
  const otherOf = (c: Connection) => state.members[otherIdOf(c)];
  // Conversations with someone I've blocked are hidden entirely.
  const myConnections = state.connections.filter(c => c.memberIds.includes(currentUserId) && !isBlocked(otherIdOf(c)));

  // The list itself: only conversations that have actually started (either
  // side sent something), newest first.
  const conversations = myConnections.filter(c => c.lastMessage).sort(byLatestMessage);
  // Search: any ACTIVE connection by name, messaged or not, so a new chat can
  // be started from here. Never cancelled connections, never non-connections.
  const term = query.trim().toLowerCase();
  const results = term
    ? myConnections
        .filter(c => c.status === 'active' && otherOf(c)?.name.toLowerCase().includes(term))
        .sort((a, b) => (otherOf(a)?.name ?? '').localeCompare(otherOf(b)?.name ?? ''))
    : [];
  const hasActiveConnections = myConnections.some(c => c.status === 'active');

  function start(connectionId: string) {
    // openChat already un-minimizes; toggling here as well used to flip a
    // minimized chat straight back to minimized.
    openChat(connectionId);
    setQuery('');
  }

  function renderRow(c: Connection) {
    const other = otherOf(c);
    if (!other) return null;
    const unread = isConnectionUnread(c.id);
    return (
      <button key={c.id} type="button" className={`chat-dock-item${unread ? ' unread' : ''}`} onClick={() => start(c.id)}>
        <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
        <span className="chat-dock-item-body">
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
          <span className="chat-dock-item-preview">
            {c.lastMessage ? c.lastMessage.text : `Start a conversation with ${other.name.split(' ')[0]}`}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="chat-dock" aria-live="off">
      <div className="chat-dock-popups">
        {openChats.slice(-maxVisible).map(id => (
          <ChatPopup key={id} connectionId={id} minimized={!!minimized[id]} />
        ))}
      </div>

      <div className={`chat-dock-bar${barOpen ? ' open' : ''}`}>
        <button type="button" className="chat-dock-bar-head" onClick={() => setBarOpen(o => !o)} aria-expanded={barOpen}>
          <MessageSquare size={16} />
          <span className="chat-dock-bar-label">Messaging</span>
          {unreadMessageCount > 0 && <span className="count">{unreadMessageCount}</span>}
          {barOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {barOpen && (
          <div className="chat-dock-panel">
            {hasActiveConnections && (
              <div className="chat-dock-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your connections"
                  aria-label="Search your connections"
                  maxLength={80}
                />
                {query && (
                  <button type="button" className="chat-dock-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            <div className="chat-dock-list">
              {term ? (
                results.length > 0 ? (
                  results.map(renderRow)
                ) : (
                  <p className="chat-dock-empty">No connections match &ldquo;{query.trim()}&rdquo;.</p>
                )
              ) : conversations.length > 0 ? (
                conversations.map(renderRow)
              ) : hasActiveConnections ? (
                <p className="chat-dock-empty">No conversations yet. Search above to message one of your connections.</p>
              ) : (
                <p className="chat-dock-empty">
                  Connect with someone to start messaging.{' '}
                  <Link href="/portal/discover" className="text-link">Browse Discover</Link>
                </p>
              )}
            </div>
            {!term && conversations.length > 0 && (
              <Link href="/portal/messages" className="chat-dock-see-all">See all conversations</Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
