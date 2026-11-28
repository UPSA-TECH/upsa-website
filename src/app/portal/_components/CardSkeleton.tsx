export default function CardSkeleton() {
  return (
    <div className="member-card" aria-hidden="true">
      <div className="member-card-head">
        <span className="avatar avatar-md skeleton" />
        <div className="member-card-id" style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 16, width: '65%', borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 11, width: '50%', borderRadius: 4, marginTop: 9 }} />
        </div>
      </div>
      <div className="skeleton" style={{ height: 11, width: '85%', borderRadius: 4 }} />
      <div className="skeleton" style={{ height: 11, width: '60%', borderRadius: 4 }} />
      <div className="member-card-foot">
        <div className="skeleton" style={{ height: 11, width: '35%', borderRadius: 4 }} />
      </div>
    </div>
  );
}
