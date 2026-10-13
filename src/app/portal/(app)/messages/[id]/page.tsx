'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useChatWidget } from '../../../_lib/ChatWidgetProvider';

// Chat is now a floating popup (see ChatDock), not a sub-page - this route
// stays only so an old bookmark or link to a specific conversation still
// works: it opens that conversation's popup, then sends you to the inbox.
export default function MessageThreadRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openChat } = useChatWidget();

  useEffect(() => {
    if (id) openChat(id);
    router.replace('/portal/messages');
  }, [id, openChat, router]);

  return null;
}
