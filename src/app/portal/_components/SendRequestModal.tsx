'use client';

import { useEffect, useRef, useState } from 'react';
import type { Member, RequestType } from '../_lib/types';
import { REQUEST_TYPE_LABELS } from '../_lib/types';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import { useToast } from './Toast';

export default function SendRequestModal({
  professional,
  onClose,
  onSent,
}: {
  professional: Member;
  onClose: () => void;
  onSent: () => void;
}) {
  const { sendRequest } = usePortalData();
  const toast = useToast();
  const [sending, setSending] = useState(false);

  // Everyone verified can be sent a general "connect" request; referral is a
  // bigger, more specific ask, so it's only offered when the person opted in.
  const availableTypes: RequestType[] = ['connect', ...(professional.referralsAvailable ? (['referral'] as const) : [])];

  const [requestType, setRequestType] = useState<RequestType>('connect');
  const [message, setMessage] = useState(
    `Hi ${professional.name.split(' ')[0]}, I'd love to connect and learn more about your path. Would you be open to a short conversation?`
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector('textarea')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await sendRequest(professional.id, requestType, message.trim());
      toast(`Request sent to ${professional.name.split(' ')[0]}.`, 'success');
      onSent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send that request. Try again.', 'error');
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="send-request-title" ref={panelRef}>
        <div className="modal-head">
          <h2 id="send-request-title">Send a request to {professional.name.split(' ')[0]}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <p className="modal-sub">A short, specific message gets the best response.</p>

        <form onSubmit={handleSubmit}>
          {availableTypes.length > 1 && (
            <fieldset className="field type-choice-field">
              <legend>Reason for reaching out</legend>
              <div className="type-choice-group">
                {availableTypes.map(type => (
                  <label key={type} className={`type-choice${requestType === type ? ' active' : ''}`}>
                    <input
                      type="radio"
                      name="request-type"
                      value={type}
                      checked={requestType === type}
                      onChange={() => setRequestType(type)}
                    />
                    {REQUEST_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="field">
            <label htmlFor="req-message">Your message</label>
            <textarea
              id="req-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={600}
              required
              rows={5}
            />
            <span className="hint">{message.length}/600</span>
          </div>

          {requestType === 'referral' && (
            <p className="hint" style={{ marginBottom: 16 }}>
              A referral is never guaranteed. This only asks {professional.name.split(' ')[0]} to discuss it, the decision is entirely their call.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={sending}>
              {sending ? 'Sending…' : <>Send request &rarr;</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
