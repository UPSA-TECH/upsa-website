export default function RoleTag({ isProfessional }: { isProfessional: boolean }) {
  if (isProfessional) {
    return <span className="role-tag role-mentor">Mentor / Professional</span>;
  }
  return <span className="role-tag role-member">Member</span>;
}
