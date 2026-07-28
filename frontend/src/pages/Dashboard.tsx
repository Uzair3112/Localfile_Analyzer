import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ScanResponse } from "../api/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function statusClass(status: string): string {
  return status === "completed" ? "completed"
    : status === "running" ? "running"
    : status === "failed" ? "failed"
    : "pending";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [allScans, setAllScans] = useState<ScanResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listScans(1, 1000)
      .then((data) => {
        setAllScans(data.scans);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const recentScans = allScans.slice(0, 5);
  const totalFiles = allScans.reduce((s, r) => s + r.total_files, 0);
  const totalSize = allScans.reduce((s, r) => s + r.total_size, 0);

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <div className="scan-stats-grid" style={{ marginTop: 24 }}>
        <div className="scan-stat-card">
          <div className="scan-stat-label">Total Scans</div>
          <div className="scan-stat-value">{allScans.length}</div>
        </div>
        <div className="scan-stat-card">
          <div className="scan-stat-label">Files Found</div>
          <div className="scan-stat-value">{formatNumber(totalFiles)}</div>
        </div>
        <div className="scan-stat-card">
          <div className="scan-stat-label">Total Size</div>
          <div className="scan-stat-value">{formatBytes(totalSize)}</div>
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Recent Scans</h2>
          {recentScans.length > 0 && (
            <button className="btn-secondary" onClick={() => navigate("/scans")}>
              View All
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
        ) : recentScans.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)", lineHeight: 1.8 }}>
            <p>No scans yet.</p>
            <p>Click <strong>"New Scan"</strong> in the top bar to analyze a folder.</p>
          </div>
        ) : (
          <div className="scans-table-wrapper">
            <table className="scans-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Folder</th>
                  <th>Status</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Lines</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.map((scan) => (
                  <tr
                    key={scan.scan_id}
                    className="scans-table-row"
                    onClick={() => navigate(`/scans/${scan.scan_id}`)}
                  >
                    <td>#{scan.scan_id}</td>
                    <td className="scans-table-path" title={scan.folder_path}>{scan.folder_path}</td>
                    <td>
                      <span className={`scan-status-badge ${statusClass(scan.status)}`}>
                        {scan.status === "completed" && "● Completed"}
                        {scan.status === "running" && "● Running"}
                        {scan.status === "pending" && "● Pending"}
                        {scan.status === "failed" && "● Failed"}
                      </span>
                    </td>
                    <td>{formatNumber(scan.total_files)}</td>
                    <td>{formatBytes(scan.total_size)}</td>
                    <td>{formatNumber(scan.total_lines)}</td>
                    <td className="scans-table-date">
                      {scan.started_at
                        ? new Date(scan.started_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
