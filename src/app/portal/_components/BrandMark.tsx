export default function BrandMark({
  subtitle = 'Mentor Portal',
  on = 'light',
}: {
  subtitle?: string;
  /** Which background this sits on - picks the matching logo variant (the dark
   * mark reads fine on paper/cream, but needs a white cutout on the moss sidebar). */
  on?: 'light' | 'dark';
}) {
  const src = on === 'dark' ? '/images/logos/upsa-logo-white.png' : '/images/logos/upsa-logo-portal.png';
  return (
    <span className="brand-mark">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="UPSA" className="brand-mark-logo" />
      <span className="brand-mark-text">
        <strong>UPSA</strong>
        <small>{subtitle}</small>
      </span>
    </span>
  );
}
