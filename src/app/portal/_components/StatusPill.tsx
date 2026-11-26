const LABELS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Not available',
  expired: 'Expired',
  cancelled: 'Cancelled',
  active: 'Active',
};

export default function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{LABELS[status] ?? status}</span>;
}
