import { BadgeCheck } from 'lucide-react';

export default function Avatar({
  name,
  initials,
  color,
  size = 'md',
  imageUrl,
  verified = false,
}: {
  name: string;
  initials: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  imageUrl?: string;
  verified?: boolean;
}) {
  const inner = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={name} className={`avatar avatar-${size} avatar-photo`} />
  ) : (
    <span className={`avatar avatar-${size} avatar-${color}`} role="img" aria-label={name}>
      {initials}
    </span>
  );

  if (!verified) return inner;

  return (
    <span className={`avatar-wrap avatar-wrap-${size}`}>
      {inner}
      <BadgeCheck className="avatar-verified-badge" aria-label="Verified mentor/professional" />
    </span>
  );
}
