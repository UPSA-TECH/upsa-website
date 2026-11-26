'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserSearch, Flag, MessageSquare } from 'lucide-react';
import { usePortalData } from '../../../_lib/PortalDataProvider';
import { useChatWidget } from '../../../_lib/ChatWidgetProvider';
import { ApiError } from '../../../_lib/api';
import type { Connection, ConnectionRequest } from '../../../_lib/types';
import Avatar from '../../../_components/Avatar';
import StatusPill from '../../../_components/StatusPill';
import RoleTag from '../../../_components/RoleTag';
import SendRequestModal from '../../../_components/SendRequestModal';
import { useToast } from '../../../_components/Toast';

type Relationship =
  | { kind: 'self' }
  | { kind: 'connected'; connection: Connection }
  | { kind: 'incoming'; request: ConnectionRequest }
  | { kind: 'outgoing'; request: ConnectionRequest }
  | { kind: 'none' };

// Mirrors what the backend will actually allow: an active connection in
// either direction, or any pending request in either direction, blocks a new
// request. Declined/cancelled requests and cancelled connections don't - those
// people can be asked again - so only live rows are looked at, never "the
// first request found", which could be an old declined one.
function relationshipWith(
  memberId: string,
  currentUserId: string,
  requests: ConnectionRequest[],
  connections: Connection[]
): Relationship {
  if (memberId === currentUserId) return { kind: 'self' };
  const connection = connections.find(
    c => c.status === 'active' && c.memberIds.includes(memberId) && c.memberIds.includes(currentUserId)
  );
  if (connection) return { kind: 'connected', connection };
  const pending = requests.filter(r => r.status === 'pending');
  const incoming = pending.find(r => r.fromId === memberId && r.toId === currentUserId);
  if (incoming) return { kind: 'incoming', request: incoming };
  const outgoing = pending.find(r => r.fromId === currentUserId && r.toId === memberId);
  if (outgoing) return { kind: 'outgoing', request: outgoing };
  return { kind: 'none' };
}

export default function ProfessionalDetail({ id }: { id: string }) {
  const { state, currentUserId, loadMember, reportMember, respondToRequest } = usePortalData();
  const { openChat } = useChatWidget();
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [responding, setResponding] = useState(false);
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

  const relationship = relationshipWith(id, currentUserId, state.requests, state.connections);
  const firstName = professional.name.split(' ')[0];
  const isStudentType = Boolean(professional.university && professional.major);
  const isProfessionalType = Boolean(professional.company && professional.role);

  async function handleReport() {
    if (!window.confirm(`Report ${firstName}'s profile as fake or suspicious?`)) return;
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

  async function handleRespond(requestId: string, decision: 'accepted' | 'declined') {
    setResponding(true);
    try {
      await respondToRequest(requestId, decision);
      toast(decision === 'accepted' ? `You're now connected with ${firstName}.` : 'Request declined.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not update that request. Try again.', 'error');
    } finally {
      setResponding(false);
    }
  }

  let actions: React.ReactNode;
  switch (relationship.kind) {
    case 'self':
      actions = <Link href="/portal/profile" className="btn-outline">Edit your profile</Link>;
      break;
    case 'connected':
      actions = (
        <button className="btn-primary" onClick={() => openChat(relationship.connection.id)}>
          <MessageSquare size={15} /> Message
        </button>
      );
      break;
    case 'incoming':
      actions = (
        <>
          <span className="pf-detail-actions-note">{firstName} sent you a request.</span>
          <button className="btn-primary" disabled={responding} onClick={() => handleRespond(relationship.request.id, 'accepted')}>
            Accept
          </button>
          <button className="btn-outline" disabled={responding} onClick={() => handleRespond(relationship.request.id, 'declined')}>
            Decline
          </button>
        </>
      );
      break;
    case 'outgoing':
      actions = <StatusPill status="pending" />;
      break;
    case 'none':
      actions = <button className="btn-primary" onClick={() => setModalOpen(true)}>Send connection request &rarr;</button>;
      break;
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
        <div className="pf-detail-actions">{actions}</div>
      </div>

      {relationship.kind !== 'self' && (
        <p style={{ marginBottom: 20 }}>
          <button className="btn-ghost" onClick={handleReport} disabled={reported || reporting}>
            <Flag size={15} /> {reported ? 'Reported' : reporting ? 'Reporting…' : 'Report this profile'}
          </button>
        </p>
      )}

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
            A referral is never guaranteed. It&apos;s entirely {firstName}&apos;s discretion.
          </p>
        </div>
      )}

      {professional.experience.length > 0 && (
        <div className="detail-card">
          <h3>Experience</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {professional.experience.map(exp => (
              <div key={exp.id} className="entry-row">
                <div>
                  <strong>{exp.jobTitle}</strong>
                  <div className="sub">{exp.company}{exp.employmentType ? ` · ${exp.employmentType}` : ''}</div>
                  <div className="sub">{exp.startDate ?? ''}{exp.startDate || exp.endDate ? ' - ' : ''}{exp.currentlyWorking ? 'Present' : exp.endDate ?? ''}</div>
                  {exp.description && <p style={{ marginTop: 6, fontSize: 13 }}>{exp.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {professional.education.length > 0 && (
        <div className="detail-card">
          <h3>Education</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {professional.education.map(edu => (
              <div key={edu.id} className="entry-row">
                <div>
                  <strong>{edu.school}</strong>
                  {(edu.degree || edu.fieldOfStudy) && <div className="sub">{[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}</div>}
                  <div className="sub">{edu.startYear ?? ''}{edu.startYear || edu.endYear ? ' - ' : ''}{edu.currentlyStudying ? 'Present' : edu.endYear ?? ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {professional.certifications.length > 0 && (
        <div className="detail-card">
          <h3>Licenses &amp; certifications</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {professional.certifications.map(cert => (
              <div key={cert.id} className="entry-row">
                <div>
                  <strong>{cert.name}</strong>
                  {cert.issuingOrganization && <div className="sub">{cert.issuingOrganization}</div>}
                  {cert.issueDate && <div className="sub">Issued {cert.issueDate}{cert.expirationDate ? ` · Expires ${cert.expirationDate}` : ''}</div>}
                  {cert.credentialUrl && <a href={cert.credentialUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--moss)' }}>View credential &rarr;</a>}
                </div>
              </div>
            ))}
          </div>
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
          onSent={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
