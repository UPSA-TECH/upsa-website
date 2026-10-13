'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SendHorizontal, Paperclip, FileText, Download, Minus, X, Hand, MessageCircleOff } from 'lucide-react';
import { OPEN_THREAD_INTERVAL_MS, usePortalData } from '../_lib/PortalDataProvider';
import { useChatWidget } from '../_lib/ChatWidgetProvider';
import { ApiError } from '../_lib/api';
import Avatar from './Avatar';
import { useToast } from './Toast';

export default function ChatPopup({ connectionId, minimized }: { connectionId: string; minimized: boolean }) {
  const { state, currentUserId, sendMessage, loadMessages, shareResumeWithConnection, downloadResumeById } = usePortalData();
  const { closeChat, toggleMinimize } = useChatWidget();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);

  const connection = state.connections.find(c => c.id === connectionId);
  const threadMessages = state.messages.filter(m => m.connectionId === connectionId);
  const otherId = connection?.memberIds.find(id => id !== currentUserId);
  const other = otherId ? state.members[otherId] : undefined;

  useEffect(() => {
    if (minimized) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [threadMessages.length, connectionId, minimized]);

  // Only polls while expanded - a minimized popup is just a title bar, no
  // point refreshing a thread nobody's looking at.
  useEffect(() => {
    if (minimized) return;
    const refresh = () => {
      if (!document.hidden) loadMessages(connectionId).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, OPEN_THREAD_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connectionId, loadMessages, minimized]);

  useEffect(() => {
    if (!attachOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [attachOpen]);

  if (!connection || !other) {
    return (
      <div className="chat-popup">
        <div className="chat-popup-head">
          <span className="chat-popup-head-name"><MessageCircleOff size={15} /> Not found</span>
          <button className="chat-popup-icon-btn" onClick={() => closeChat(connectionId)} aria-label="Close"><X size={16} /></button>
        </div>
      </div>
    );
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendMessage(connectionId, text);
      setDraft('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send that message. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleShareResume() {
    setAttachOpen(false);
    if (!state.resume) {
      toast('Upload a resume on your Profile first.', 'info');
      return;
    }
    setSharing(true);
    try {
      await shareResumeWithConnection(connectionId);
      toast('Resume shared.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not share your resume. Try again.', 'error');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className={`chat-popup${minimized ? ' minimized' : ''}`}>
      <div
        className="chat-popup-head"
        onClick={() => { if (minimized) toggleMinimize(connectionId); }}
        role={minimized ? 'button' : undefined}
        tabIndex={minimized ? 0 : undefined}
      >
        <Avatar name={other.name} initials={other.initials} color={other.avatarColor} imageUrl={other.avatarUrl} size="sm" />
        <span className="chat-popup-head-name">{other.name}</span>
        <span className="chat-popup-head-actions">
          <button
            type="button"
            className="chat-popup-icon-btn"
            onClick={e => { e.stopPropagation(); toggleMinimize(connectionId); }}
            aria-label={minimized ? 'Expand' : 'Minimize'}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="chat-popup-icon-btn"
            onClick={e => { e.stopPropagation(); closeChat(connectionId); }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </span>
      </div>

      {!minimized && (
        <>
          <div className="chat-scroll chat-popup-scroll" ref={scrollRef}>
            {threadMessages.length === 0 ? (
              <div className="chat-empty"><Hand size={16} /> Say hello to {other.name.split(' ')[0]}</div>
            ) : (
              threadMessages.map(m => (
                <div className={`chat-bubble ${m.senderId === currentUserId ? 'mine' : 'theirs'}${m.attachment === 'resume' ? ' has-attachment' : ''}`} key={m.id}>
                  {m.attachment === 'resume' ? (
                    m.resumeId ? (
                      <button
                        className="resume-bubble"
                        onClick={() =>
                          downloadResumeById(m.resumeId!, m.resumeFileName ?? 'resume').catch(() =>
                            toast('Could not download that resume. Try again.', 'error')
                          )
                        }
                      >
                        <span className="resume-bubble-icon"><FileText size={16} /></span>
                        <span className="resume-bubble-info">
                          <span className="resume-bubble-name">{m.resumeFileName ?? 'Resume'}</span>
                          <span className="resume-bubble-meta">{m.resumeSizeLabel ?? ''} &middot; tap to download</span>
                        </span>
                        <Download size={15} />
                      </button>
                    ) : (
                      <span className="resume-bubble resume-bubble-gone">
                        <FileText size={16} /> Resume no longer available
                      </span>
                    )
                  ) : (
                    m.text
                  )}
                  <span className="time">{m.time}</span>
                </div>
              ))
            )}
          </div>
          <form className="chat-input-row chat-popup-input" onSubmit={handleSend}>
            <div className="chat-attach" ref={attachRef}>
              <button
                type="button"
                className="chat-attach-btn"
                onClick={() => setAttachOpen(o => !o)}
                disabled={sharing}
                aria-label="Attach"
                aria-expanded={attachOpen}
              >
                <Paperclip size={16} />
              </button>
              {attachOpen && (
                <div className="chat-attach-menu">
                  <button type="button" onClick={handleShareResume} disabled={sharing}>
                    <FileText size={15} /> {sharing ? 'Sharing…' : 'Share your resume'}
                  </button>
                  {!state.resume && <Link href="/portal/profile" className="chat-attach-hint">No resume yet &rarr; upload one</Link>}
                </div>
              )}
            </div>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={`Message ${other.name.split(' ')[0]}…`}
              aria-label="Message"
              disabled={sending}
            />
            <button type="submit" className="chat-popup-send" disabled={sending || !draft.trim()} aria-label="Send">
              <SendHorizontal size={16} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
