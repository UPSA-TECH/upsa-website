import { BriefcaseBusiness } from 'lucide-react';

export default function Avatar({
  name,
  initials,
  color,
  size = 'md',
  imageUrl,
  professional = false,
}: {
  name: string;
  initials: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  imageUrl?: string;
  // Listing as a mentor/professional is self-serve and nobody checks the
  // employer, so this badge only says "listed as a professional". It must
  // never look like a verification mark (no check icon, no "verified").
  professional?: boolean;
}) {
  const inner = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={name} className={`avatar avatar-${size} avatar-photo`} />
  ) : (
    <span className={`avatar avatar-${size} avatar-${color}`} role="img" aria-label={name}>
      {initials}
    </span>
  );

  if (!professional) return inner;

  return (
    <span className={`avatar-wrap avatar-wrap-${size}`}>
      {inner}
      <BriefcaseBusiness className="avatar-pro-badge" role="img" aria-label="Mentor/professional" />
    </span>
  );
}
