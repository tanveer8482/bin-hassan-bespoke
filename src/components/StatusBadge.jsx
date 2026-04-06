export function StatusBadge({ label, tone = "pending" }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}
