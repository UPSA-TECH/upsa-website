'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// How many floating chat popups can be open at once - matches the LinkedIn-
// style pattern this is based on. Opening a fourth closes the oldest rather
// than letting the dock overflow off the edge of the screen.
const MAX_OPEN_CHATS = 3;

type ChatWidgetContextValue = {
  openChats: string[]; // connection ids, oldest first
  minimized: Record<string, boolean>;
  openChat: (connectionId: string) => void;
  closeChat: (connectionId: string) => void;
  toggleMinimize: (connectionId: string) => void;
};

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

export function ChatWidgetProvider({ children }: { children: ReactNode }) {
  const [openChats, setOpenChats] = useState<string[]>([]);
  const [minimized, setMinimized] = useState<Record<string, boolean>>({});

  const openChat = useCallback((connectionId: string) => {
    setMinimized(prev => ({ ...prev, [connectionId]: false }));
    setOpenChats(prev => {
      const without = prev.filter(id => id !== connectionId);
      const next = [...without, connectionId];
      return next.length > MAX_OPEN_CHATS ? next.slice(next.length - MAX_OPEN_CHATS) : next;
    });
  }, []);

  const closeChat = useCallback((connectionId: string) => {
    setOpenChats(prev => prev.filter(id => id !== connectionId));
    setMinimized(prev => {
      if (!(connectionId in prev)) return prev;
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
  }, []);

  const toggleMinimize = useCallback((connectionId: string) => {
    setMinimized(prev => ({ ...prev, [connectionId]: !prev[connectionId] }));
  }, []);

  const value = useMemo(
    () => ({ openChats, minimized, openChat, closeChat, toggleMinimize }),
    [openChats, minimized, openChat, closeChat, toggleMinimize]
  );

  return <ChatWidgetContext.Provider value={value}>{children}</ChatWidgetContext.Provider>;
}

export function useChatWidget() {
  const ctx = useContext(ChatWidgetContext);
  if (!ctx) throw new Error('useChatWidget must be used within ChatWidgetProvider');
  return ctx;
}
