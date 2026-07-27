interface ScanStatusBadgeProps {
  status: "pending" | "running" | "completed" | "failed";
}

const colors: Record<string, string> = {
  pending: "yellow",
  running: "yellow",
  completed: "green",
  failed: "red",
};

export default function ScanStatusBadge({ status }: ScanStatusBadgeProps) {
  return (
    <span className={`badge badge-${colors[status]}`}>
      ● {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
