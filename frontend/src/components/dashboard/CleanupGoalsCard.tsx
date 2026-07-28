import type { CleanupSummaryResponse } from "../../api/types";

interface CleanupGoalsCardProps {
  data: CleanupSummaryResponse;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

interface Goal {
  label: string;
  current: number;
  total: number;
  color: string;
  note: string;
}

export default function CleanupGoalsCard({ data }: CleanupGoalsCardProps) {
  const goals: Goal[] = [
    {
      label: "Remove Duplicates",
      current: data.duplicate_files,
      total: data.duplicate_files,
      color: "#E5484D",
      note: data.duplicate_groups > 0
        ? `${data.duplicate_groups} group${data.duplicate_groups > 1 ? "s" : ""}`
        : "No duplicates found",
    },
    {
      label: "Compress Large Files",
      current: 0,
      total: data.large_files_10mb_plus,
      color: "#D97706",
      note: data.large_files_10mb_plus > 0
        ? `${data.large_files_10mb_plus} file${data.large_files_10mb_plus > 1 ? "s" : ""} > 10MB`
        : "No large files",
    },
    {
      label: "Name Extensionless Files",
      current: 0,
      total: data.files_without_extension,
      color: "#2563EB",
      note: data.files_without_extension > 0
        ? `${data.files_without_extension} file${data.files_without_extension > 1 ? "s" : ""} without extension`
        : "All files have extensions",
    },
  ];

  const totalGoals = goals.filter(g => g.total > 0).length;
  const resolvedGoals = goals.filter(g => g.current >= g.total && g.total > 0).length;

  return (
    <div className="cleanup-goals-card">
      <h2 className="cleanup-goals-title">Cleanup Goals</h2>

      {totalGoals === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
          No cleanup items found. Your scan looks clean!
        </p>
      ) : (
        <>
          <div className="cleanup-goals-summary">
            <span className="cleanup-goals-progress">
              {resolvedGoals}/{totalGoals} resolved
            </span>
            <span className="cleanup-goals-subtitle">
              Review opportunities to clean up
            </span>
          </div>

          <div className="cleanup-goals-list">
            {goals.map((goal) => {
              const isResolved = goal.total === 0;
              const pct = goal.total > 0
                ? Math.round((goal.current / goal.total) * 100)
                : 100;

              return (
                <div
                  key={goal.label}
                  className={`cleanup-goal-item ${isResolved ? "resolved" : ""}`}
                >
                  <div className="cleanup-goal-header">
                    <span className="cleanup-goal-indicator" style={{ backgroundColor: goal.color }} />
                    <span className="cleanup-goal-label">{goal.label}</span>
                    <span className="cleanup-goal-note">
                      {isResolved ? "Resolved" : `${formatNumber(goal.current)}/${formatNumber(goal.total)}`}
                    </span>
                  </div>
                  <div className="cleanup-goal-bar-track">
                    <div
                      className="cleanup-goal-bar-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: goal.color,
                      }}
                    />
                  </div>
                  <div className="cleanup-goal-detail">{goal.note}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
