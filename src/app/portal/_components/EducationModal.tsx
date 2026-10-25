'use client';

import { useEffect, useRef, useState } from 'react';
import type { Education } from '../_lib/types';
import { usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import { useToast } from './Toast';

export default function EducationModal({ existing, onClose }: { existing: Education | null; onClose: () => void }) {
  const { addEducation, updateEducation } = usePortalData();
  const toast = useToast();
  const [school, setSchool] = useState(existing?.school ?? '');
  const [degree, setDegree] = useState(existing?.degree ?? '');
  const [fieldOfStudy, setFieldOfStudy] = useState(existing?.fieldOfStudy ?? '');
  const [startYear, setStartYear] = useState(existing?.startYear?.toString() ?? '');
  const [endYear, setEndYear] = useState(existing?.endYear?.toString() ?? '');
  const [currentlyStudying, setCurrentlyStudying] = useState(existing?.currentlyStudying ?? false);
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
    if (!school.trim() || saving) return;
    setSaving(true);
    const fields = {
      school: school.trim(),
      degree: degree.trim(),
      fieldOfStudy: fieldOfStudy.trim(),
      startYear: startYear ? Number(startYear) : undefined,
      endYear: currentlyStudying ? undefined : endYear ? Number(endYear) : undefined,
      currentlyStudying,
    };
    try {
      if (existing) await updateEducation(existing.id, fields);
      else await addEducation(fields);
      toast(existing ? 'Education updated.' : 'Education added.', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that. Try again.', 'error');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="education-modal-title" ref={panelRef}>
        <div className="modal-head">
          <h2 id="education-modal-title">{existing ? 'Edit education' : 'Add education'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="edu-school">School / University</label>
            <input id="edu-school" value={school} onChange={e => setSchool(e.target.value)} required placeholder="e.g. UCF" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edu-degree">Degree <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="edu-degree" value={degree} onChange={e => setDegree(e.target.value)} placeholder="e.g. BS" />
            </div>
            <div className="field">
              <label htmlFor="edu-field">Field of study <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="edu-field" value={fieldOfStudy} onChange={e => setFieldOfStudy(e.target.value)} placeholder="e.g. Computer Science" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edu-start">Start year <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="edu-start" type="number" value={startYear} onChange={e => setStartYear(e.target.value)} placeholder="2020" />
            </div>
            <div className="field">
              <label htmlFor="edu-end">End year <span className="hint" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id="edu-end" type="number" value={endYear} onChange={e => setEndYear(e.target.value)} disabled={currentlyStudying} placeholder="2024" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, cursor: 'pointer' }}>
            <input type="checkbox" checked={currentlyStudying} onChange={e => setCurrentlyStudying(e.target.checked)} />
            Currently studying here
          </label>

          <div className="modal-actions">
            <button type="button" className="btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={!school.trim() || saving}>
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
