import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useScanPolling } from "../hooks/useScanPolling";
import { api } from "../api/client";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function ScanDetail() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const id = scanId ? parseInt(scanId, 10) : null;
  const { scan, loading, error } = useScanPolling(id);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteScan(id);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete scan");
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  };

  if (!id) {
    return (
      <div className="page">
        <h1>Scans</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          Click "New Scan" in the top bar to start a scan.
        </p>
      </div>
    );
  }

  if (loading && !scan) {
    return (
      <div className="page">
        <h1>Scan #{id}</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Loading scan...</p>
      </div>
    );
  }

  if (error && !scan) {
    return (
      <div className="page">
        <h1>Scan #{id}</h1>
        <div className="scan-error-message" style={{ marginTop: 16 }}>{error}</div>
        <Link to="/" style={{ display: "inline-block", marginTop: 16, color: "var(--color-primary)" }}>Back to Dashboard</Link>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="page">
        <h1>Scan #{id}</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Scan not found.</p>
        <Link to="/" style={{ display: "inline-block", marginTop: 16, color: "var(--color-primary)" }}>Back to Dashboard</Link>
      </div>
    );
  }

  const statusClass = scan.status === "completed" ? "completed"
    : scan.status === "running" ? "running"
    : scan.status === "failed" ? "failed"
    : "pending";

  return (
    <div className="page">
      <div className="scan-detail-header">
        <h1>Scan #{scan.scan_id}</h1>
        <span className={`scan-status-badge ${statusClass}`}>
          {scan.status === "completed" && "● Completed"}
          {scan.status === "running" && "● Running"}
          {scan.status === "pending" && "● Pending"}
          {scan.status === "failed" && "● Failed"}
        </span>
      </div>

      <div className="scan-path">{scan.folder_path}</div>

      <div className="scan-stats-grid">
        <div className="scan-stat-card">
          <div className="scan-stat-label">Total Files</div>
          <div className="scan-stat-value">{formatNumber(scan.total_files)}</div>
        </div>
        <div className="scan-stat-card">
          <div className="scan-stat-label">Total Size</div>
          <div className="scan-stat-value">{formatBytes(scan.total_size)}</div>
        </div>
        <div className="scan-stat-card">
          <div className="scan-stat-label">Total Lines</div>
          <div className="scan-stat-value">{formatNumber(scan.total_lines)}</div>
        </div>
      </div>

      {scan.error_message && (
        <div className="scan-error-message">{scan.error_message}</div>
      )}

      {scan.status === "running" && (
        <div style={{ marginTop: 16, color: "var(--color-text-muted)", fontSize: 14 }}>
          Scan in progress — results update every 1.5 seconds...
        </div>
      )}

      {deleteError && (
        <div className="scan-error-message" style={{ marginTop: 12 }}>{deleteError}</div>
      )}

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Link to="/scans" style={{ color: "var(--color-primary)" }}>Back to Scans</Link>
        <button
          className="btn-danger"
          onClick={() => setShowConfirm(true)}
          disabled={deleting || scan.status === "running"}
          style={{ marginLeft: "auto" }}
        >
          {deleting ? "Deleting..." : "Delete Scan"}
        </button>
      </div>

      {showConfirm && (
        <div className="dialog-overlay" onClick={() => setShowConfirm(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="dialog-title">Delete Scan #{scan.scan_id}?</h2>
            <div className="dialog-body">
              <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
                This will permanently remove this scan and all its data (files, duplicates, todos).
              </p>
            </div>
            {deleteError && <div className="dialog-error">{deleteError}</div>}
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={() => setShowConfirm(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
