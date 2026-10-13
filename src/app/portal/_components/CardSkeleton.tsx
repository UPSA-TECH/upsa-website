export default function CardSkeleton() {
  return (
    <div className="pf-card" aria-hidden="true">
      <div className="pf-card-top">
        <span className="avatar avatar-md skeleton" />
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 15, width: '70%', borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 11, width: '50%', borderRadius: 4, marginTop: 8 }} />
        </div>
      </div>
      <div className="skeleton" style={{ height: 11, width: '80%', borderRadius: 4 }} />
      <div className="skeleton" style={{ height: 11, width: '60%', borderRadius: 4 }} />
    </div>
  );
}
