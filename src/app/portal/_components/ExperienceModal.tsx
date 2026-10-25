'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkExperience } from '../_lib/types';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import { useToast } from './Toast';

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance', 'Self-employed'];

export default function ExperienceModal({ existing, onClose }: { existing: WorkExperience | null; onClose: () => void }) {
  const { addExperience, updateExperience } = usePortalData();
  const toast = useToast();
  const [jobTitle, setJobTitle] = useState(existing?.jobTitle ?? '');
  const [company, setCompany] = useState(existing?.company ?? '');
  const [employmentType, setEmploymentType] = useState(existing?.employmentType ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? '');
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [currentlyWorking, setCurrentlyWorking] = useState(existing?.currentlyWorking ?? false);
  const [description, setDescription] = useState(existing?.description ?? '');
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
    if (!jobTitle.trim() || !company.trim() || saving) return;
    setSaving(true);
    const fields = {
      jobTitle: jobTitle.trim(),
      company: company.trim(),
      employmentType,
      startDate: startDate || undefined,
      endDate: currentlyWorking ? undefined : endDate || undefined,
      currentlyWorking,
      description: description.trim(),
    };
    try {
      if (existing) await updateExperience(existing.id, fields);
      else await addExperience(fields);
      toast(existing ? 'Experience updated.' : 'Experience added.', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that. Try again.', 'error');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="experience-modal-title" ref={panelRef}>
        <div className="modal-head">
          <h2 id="experience-modal-title">{existing ? 'Edit experience' : 'Add experience'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="exp-title">Job title</label>
              <input id="exp-title" value={jobTitle} onChange={e => setJobTitle(e.target.value)} required placeholder="e.g. Software Engineer" />
            </div>
            <div className="field">
              <label htmlFor="exp-company">Company</label>
              <input id="exp-company" value={company} onChange={e => setCompany(e.target.value)} required placeholder="e.g. Microsoft" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="exp-type">Employment type <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <select id="exp-type" value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
              <option value="">Not specified</option>
              {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="exp-start">Start date <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="exp-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exp-end">End date <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="exp-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={currentlyWorking} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, cursor: 'pointer' }}>
            <input type="checkbox" checked={currentlyWorking} onChange={e => setCurrentlyWorking(e.target.checked)} />
            I currently work here
          </label>
          <div className="field">
            <label htmlFor="exp-desc">Description <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea id="exp-desc" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={!jobTitle.trim() || !company.trim() || saving}>
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
