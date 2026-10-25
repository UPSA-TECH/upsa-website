'use client';

import { useEffect, useRef, useState } from 'react';
import type { Certification } from '../_lib/types';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import { useToast } from './Toast';

export default function CertificationModal({ existing, onClose }: { existing: Certification | null; onClose: () => void }) {
  const { addCertification, updateCertification } = usePortalData();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [issuingOrganization, setIssuingOrganization] = useState(existing?.issuingOrganization ?? '');
  const [issueDate, setIssueDate] = useState(existing?.issueDate ?? '');
  const [expirationDate, setExpirationDate] = useState(existing?.expirationDate ?? '');
  const [credentialUrl, setCredentialUrl] = useState(existing?.credentialUrl ?? '');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector('input')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const fields = {
      name: name.trim(),
      issuingOrganization: issuingOrganization.trim(),
      issueDate: issueDate || undefined,
      expirationDate: expirationDate || undefined,
      credentialUrl: credentialUrl.trim(),
    };
    try {
      if (existing) await updateCertification(existing.id, fields);
      else await addCertification(fields);
      toast(existing ? 'Certification updated.' : 'Certification added.', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that. Try again.', 'error');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="certification-modal-title" ref={panelRef}>
        <div className="modal-head">
          <h2 id="certification-modal-title">{existing ? 'Edit certification' : 'Add certification'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="cert-name">Certification name</label>
            <input id="cert-name" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. AWS Certified Solutions Architect" />
          </div>
          <div className="field">
            <label htmlFor="cert-org">Issuing organization <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input id="cert-org" value={issuingOrganization} onChange={e => setIssuingOrganization(e.target.value)} placeholder="e.g. Amazon Web Services" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="cert-issue">Issue date <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="cert-issue" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cert-exp">Expiration date <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="cert-exp" type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="cert-url">Credential URL <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input id="cert-url" type="url" value={credentialUrl} onChange={e => setCredentialUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={!name.trim() || saving}>
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
