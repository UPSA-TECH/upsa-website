export default function RoleTag({ isStudent, isProfessional }: { isStudent?: boolean; isProfessional: boolean }) {
  if (!isStudent && !isProfessional) {
    return <span className="role-tag role-member">Member</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {isStudent && <span className="role-tag role-member">Student</span>}
      {isProfessional && <span className="role-tag role-mentor">Mentor / Professional</span>}
    </span>
  );
}
