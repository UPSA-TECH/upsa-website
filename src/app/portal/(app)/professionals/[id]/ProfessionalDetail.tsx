'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserSearch, Flag } from 'lucide-react';
import { usePortalData } from '../../../_lib/PortalDataProvider';
import { ApiError } from '../../../_lib/api';
import Avatar from '../../../_components/Avatar';
import StatusPill from '../../../_components/StatusPill';
import RoleTag from '../../../_components/RoleTag';
import SendRequestModal from '../../../_components/SendRequestModal';
import { useToast } from '../../../_components/Toast';

export default function ProfessionalDetail({ id }: { id: string }) {
  const { state, currentUserId, loadMember, reportMember } = usePortalData();
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  const professional = state.members[id];

  useEffect(() => {
    if (professional) return;
    loadMember(id).then(member => {
      if (!member) setNotFound(true);
    });
  }, [id, professional, loadMember]);

  if (!professional) {
    if (!notFound) return null;
    return (
      <div className="empty-state">
        <UserSearch className="empty-state-icon" aria-hidden="true" />
        <span>We couldn&apos;t find that profile.</span>
        <p style={{ marginTop: 14 }}><Link href="/portal/discover" className="btn-outline btn-sm">Back to Discover</Link></p>
      </div>
    );
  }

  const existingRequest = state.requests.find(r => r.fromId === currentUserId && r.toId === id);
  const canRequest = !existingRequest || ['declined', 'cancelled'].includes(existingRequest.status);
  const isStudentType = Boolean(professional.university && professional.major);
  const isProfessionalType = Boolean(professional.company && professional.role);

  async function handleReport() {
    if (!window.confirm(`Report ${professional.name.split(' ')[0]}'s profile as fake or suspicious?`)) return;
    setReporting(true);
    try {
      await reportMember(id);
      setReported(true);
      toast('Reported. Thanks for flagging it.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send that report. Try again.', 'error');
    } finally {
      setReporting(false);
    }
  }

  return (
    <>
      <div className="pf-detail-head">
        <Avatar
          name={professional.name}
          initials={professional.initials}
          color={professional.avatarColor}
          imageUrl={professional.avatarUrl}
          size="lg"
          verified={professional.isProfessional}
        />
        <div className="pf-detail-info">
          <div style={{ marginBottom: 8 }}><RoleTag isStudent={isStudentType} isProfessional={professional.isProfessional} /></div>
          <h1>{professional.name}</h1>
          {isProfessionalType && <div className="headline">{professional.role} &middot; {professional.company}</div>}
          {isStudentType && <div className="headline">{professional.major} &middot; {professional.university}</div>}
          {professional.location && <div className="meta-line">{professional.location}</div>}
        </div>
        <div className="pf-detail-actions">
          {justSent || (existingRequest && existingRequest.status === 'pending') ? (
            <StatusPill status="pending" />
          ) : existingRequest && !canRequest ? (
            <StatusPill status={existingRequest.status} />
          ) : canRequest ? (
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Send connection request &rarr;</button>
          ) : null}
        </div>
      </div>

      <p style={{ marginBottom: 20 }}>
        <button className="btn-ghost" onClick={handleReport} disabled={reported || reporting}>
          <Flag size={15} /> {reported ? 'Reported' : reporting ? 'Reporting…' : 'Report this profile'}
        </button>
      </p>

      <div className="detail-card">
        <h3>About</h3>
        <p>{professional.bio}</p>
      </div>

      {isProfessionalType && professional.referralsAvailable && (
        <div className="detail-card">
          <h3>Open to</h3>
          <div className="pf-card-avail">
            <span className="avail-pill referrals">Considers referrals</span>
          </div>
          <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
            A referral is never guaranteed. It&apos;s entirely {professional.name.split(' ')[0]}&apos;s discretion.
          </p>
        </div>
      )}

      {professional.skills.length > 0 && (
        <div className="detail-card">
          <h3>Skills &amp; expertise</h3>
          <div className="skill-pills">
            {professional.skills.map(s => <span key={s}>{s}</span>)}
          </div>
        </div>
      )}

      {modalOpen && (
        <SendRequestModal
          professional={professional}
          onClose={() => setModalOpen(false)}
          onSent={() => { setModalOpen(false); setJustSent(true); }}
        />
      )}
    </>
  );
}
