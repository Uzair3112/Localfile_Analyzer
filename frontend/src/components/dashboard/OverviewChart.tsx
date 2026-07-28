import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { ScanResponse } from "../../api/types";

interface OverviewChartProps {
  scans: ScanResponse[];
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function OverviewChart({ scans }: OverviewChartProps) {
  const chartData = useMemo(() => {
    return scans
      .filter((s) => s.status === "completed")
      .slice(0, 10)
      .reverse()
      .map((s) => ({
        name: `${s.scan_id}`,
        files: s.total_files,
        lines: s.total_lines,
        folder: s.folder_path,
        date: s.completed_at
          ? new Date(s.completed_at).toLocaleDateString()
          : "",
      }));
  }, [scans]);

  if (chartData.length === 0) return null;

  return (
    <div className="overview-chart-card">
      <h2 className="overview-chart-title">Files Scanned Per Run</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
          <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Legend />
          <Bar dataKey="files" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name="Files" />
          <Bar dataKey="lines" fill="#2563EB" radius={[4, 4, 0, 0]} name="Lines" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
