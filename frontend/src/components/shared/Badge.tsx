interface BadgeProps {
  label: string;
  color?: "green" | "yellow" | "red" | "blue" | "purple";
}

export default function Badge({ label, color = "green" }: BadgeProps) {
  return <span className={`badge badge-${color}`}>{label}</span>;
}
