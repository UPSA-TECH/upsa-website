'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import { useToast } from './Toast';

export default function BugReportWidget() {
  const { submitBugReport } = usePortalData();
  const toast = useToast();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector('textarea')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || sending) return;
    setSending(true);
    try {
      await submitBugReport(description.trim(), pathname ?? '');
      toast("Thanks - we've got it.", 'success');
      setDescription('');
      setOpen(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send that. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" className="bug-tab" onClick={() => setOpen(true)}>
        Report a bug
      </button>

      {open && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="bug-report-title" ref={panelRef}>
            <div className="modal-head">
              <h2 id="bug-report-title">Report a bug</h2>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">&times;</button>
            </div>
            <p className="modal-sub">Saw something broken or confusing? Describe it below - screenshots aren&apos;t needed, just tell us what happened.</p>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="bug-description">What went wrong</label>
                <textarea
                  id="bug-description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={2000}
                  required
                  rows={5}
                  placeholder="e.g. I sent a connection request and the button stayed stuck on &quot;Sending...&quot;"
                />
                <span className="hint">{description.length}/2000</span>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={sending}>
                  {sending ? 'Sending…' : <>Send report &rarr;</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
