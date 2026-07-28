import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ScanResponse, ExtensionBreakdownItem } from "../api/types";
import OverviewChart from "../components/dashboard/OverviewChart";

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

const EXT_COLORS = [
  "#1F8A5A", "#E5484D", "#2563EB", "#8B5CF6",
  "#D97706", "#0891B2", "#65A30D", "#DB2777",
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [allScans, setAllScans] = useState<ScanResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const [extensions, setExtensions] = useState<ExtensionBreakdownItem[] | null>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  useEffect(() => {
    api.listScans(1, 1000)
      .then((data) => {
        setAllScans(data.scans);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const latestCompletedScan = useMemo(() => {
    const completed = allScans.filter((s) => s.status === "completed");
    if (completed.length === 0) return null;
    return completed.reduce((a, b) => (a.scan_id > b.scan_id ? a : b));
  }, [allScans]);

  useEffect(() => {
    if (!latestCompletedScan) {
      setExtensions(null);
      setExtLoading(false);
      return;
    }
    setExtLoading(true);
    setExtError(null);
    api.getScanExtensions(latestCompletedScan.scan_id, 8)
      .then((data) => setExtensions(data.extensions))
      .catch((err) => {
        setExtError(err instanceof Error ? err.message : "Failed to load extensions");
        setExtensions(null);
      })
      .finally(() => setExtLoading(false));
  }, [latestCompletedScan?.scan_id]);

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

      <OverviewChart scans={allScans} />

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
                    <td>{scan.scan_id}</td>
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

      {extLoading && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Top Extensions</h2>
          <div className="extensions-card">
            <p style={{ color: "var(--color-text-muted)", margin: 0 }}>Loading extensions...</p>
          </div>
        </div>
      )}

      {extError && !extLoading && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Top Extensions</h2>
          <div className="extensions-card">
            <p style={{ color: "var(--color-danger)", margin: 0, fontSize: 14 }}>{extError}</p>
          </div>
        </div>
      )}

      {!extLoading && !extError && latestCompletedScan && extensions && extensions.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            Top Extensions
            <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
              from scan {latestCompletedScan.scan_id}
            </span>
          </h2>
          <div className="extensions-card">
            {extensions.map((ext, i) => (
              <div key={ext.extension} className="extension-row">
                <div className="extension-icon" style={{ backgroundColor: EXT_COLORS[i % EXT_COLORS.length] }}>
                  {ext.extension.substring(0, 2).toUpperCase()}
                </div>
                <div className="extension-info">
                  <div className="extension-name">.{ext.extension}</div>
                  <div className="extension-bar-track">
                    <div
                      className="extension-bar-fill"
                      style={{ width: `${Math.max(ext.percentage, 1)}%` }}
                    />
                  </div>
                </div>
                <div className="extension-stats">
                  <div className="extension-count">{formatNumber(ext.count)} files</div>
                  <div className="extension-pct">{ext.percentage.toFixed(1)}%</div>
                </div>
                <div className="extension-size">{formatBytes(ext.total_size)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!extLoading && !extError && latestCompletedScan && extensions && extensions.length === 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Top Extensions</h2>
          <div className="extensions-card">
            <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: 14 }}>
              {latestCompletedScan.total_files === 0
                ? "No files found in the latest scan."
                : "No file extensions detected."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
