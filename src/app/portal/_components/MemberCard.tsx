import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Member } from '../_lib/types';
import Avatar from './Avatar';

const TOP_SKILLS = 3;

export function memberKind(m: Member): 'professional' | 'student' {
  return m.company && m.role ? 'professional' : 'student';
}

function subtitle(m: Member): string {
  if (memberKind(m) === 'professional') return `${m.role} · ${m.company}`;
  return [m.major, m.university].filter(Boolean).join(' · ') || m.headline;
}

function chips(m: Member): string[] {
  // A student's university is already in the subtitle, so it isn't repeated.
  const list = [memberKind(m) === 'professional' ? m.university : '', m.industry ?? '', ...m.skills.slice(0, TOP_SKILLS)];
  return [...new Set(list.map(s => s.trim()).filter(Boolean))];
}

/**
 * The one member card used on Discover, Dashboard suggestions and
 * Connections. With `href` the whole card is a link (so the footer must not
 * hold buttons); without it only the avatar and name link to the profile,
 * and the footer can hold actions.
 */
export default function MemberCard({
  member,
  href,
  meta,
  footer,
  className = '',
}: {
  member: Member;
  href?: string;
  meta?: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  const kind = memberKind(member);
  const profileHref = `/portal/professionals/${member.id}`;
  const chipList = chips(member);
  const avatar = <Avatar name={member.name} initials={member.initials} color={member.avatarColor} imageUrl={member.avatarUrl} size="md" />;

  const body = (
    <>
      <div className="member-card-head">
        {href ? avatar : <Link href={profileHref} className="member-card-avatar-link" tabIndex={-1} aria-hidden="true">{avatar}</Link>}
        <div className="member-card-id">
          <div className="member-card-name-row">
            {href ? (
              <h3 className="member-card-name">{member.name}</h3>
            ) : (
              <h3 className="member-card-name"><Link href={profileHref}>{member.name}</Link></h3>
            )}
            <span className={`member-card-tag member-card-tag-${kind}`}>{kind === 'professional' ? 'Professional' : 'Student'}</span>
          </div>
          <div className="member-card-sub">{subtitle(member)}</div>
          {meta && <div className="member-card-meta">{meta}</div>}
        </div>
      </div>
      {chipList.length > 0 && (
        <ul className="member-card-chips" aria-label="Highlights">
          {chipList.map(c => <li key={c}>{c}</li>)}
        </ul>
      )}
      {member.bio && <p className="member-card-bio">{member.bio}</p>}
      <div className="member-card-foot">{footer}</div>
    </>
  );

  return href ? (
    <Link href={href} className={`member-card member-card-link ${className}`}>{body}</Link>
  ) : (
    <article className={`member-card ${className}`}>{body}</article>
  );
}

/** Footer shared by Discover and Dashboard suggestions. */
export function BrowseFooter({ member }: { member: Member }) {
  return (
    <>
      {member.referralsAvailable ? <span className="avail-pill referrals">Open to referrals</span> : <span />}
      <span className="member-card-cta">View profile <span aria-hidden="true">&rarr;</span></span>
    </>
  );
}
