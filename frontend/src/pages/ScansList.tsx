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
    : status === "cancelled" ? "cancelled"
    : "pending";
}

export default function ScansList() {
  const navigate = useNavigate();
  const [scans, setScans] = useState<ScanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScans = () => {
    api.listScans(1, 50)
      .then((data) => {
        setScans(data.scans);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchScans();
    const interval = setInterval(fetchScans, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="page">
        <h1>Scans</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Loading scans...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>Scans</h1>
        <div className="scan-error-message" style={{ marginTop: 16 }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Scans</h1>
        <span style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
          {scans.length} scan{scans.length !== 1 ? "s" : ""}
        </span>
      </div>

      {scans.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          No scans yet. Click "New Scan" in the top bar to analyze a folder.
        </p>
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
              {scans.map((scan) => (
                <tr
                  key={scan.scan_id}
                  className="scans-table-row"
                  onClick={() => navigate(`/scans/${scan.scan_id}`)}
                >
                  <td>{scan.scan_id}</td>
                  <td className="scans-table-path" title={scan.folder_path}>{scan.folder_path}</td>
                  <td>
                    <span className={`scan-status-badge ${statusClass(scan.status)}`}>
                      {scan.status === "completed" && "● Completed"}
                      {scan.status === "running" && "● Running"}
                      {scan.status === "pending" && "● Pending"}
                      {scan.status === "failed" && "● Failed"}
                      {scan.status === "cancelled" && "● Cancelled"}
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
  );
}
