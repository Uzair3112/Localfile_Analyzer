import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { DuplicateListResponse } from "../api/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function Duplicates() {
  const [scanId, setScanId] = useState<number | null>(null);
  const [data, setData] = useState<DuplicateListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listScans(1, 1)
      .then((res) => {
        const completed = res.scans.find((s) => s.status === "completed");
        if (completed) {
          setScanId(completed.scan_id);
        }
      })
      .catch(() => {});
  }, []);

  const fetchDuplicates = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getScanDuplicates(id);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scanId !== null) {
      fetchDuplicates(scanId);
    }
  }, [scanId, fetchDuplicates]);

  return (
    <div className="page">
      <h1>Duplicates</h1>

      {loading && (
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          Loading duplicates...
        </p>
      )}

      {error && (
        <div className="scan-error-message" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {data && data.total_groups === 0 && !loading && (
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          No duplicate files found in the latest scan.
        </p>
      )}

      {data && data.total_groups > 0 && (
        <>
          <div className="scan-stats-grid" style={{ marginTop: 24 }}>
            <div className="scan-stat-card">
              <div className="scan-stat-label">Duplicate Groups</div>
              <div className="scan-stat-value">{formatNumber(data.total_groups)}</div>
            </div>
            <div className="scan-stat-card">
              <div className="scan-stat-label">Duplicate Files</div>
              <div className="scan-stat-value">{formatNumber(data.total_duplicates)}</div>
            </div>
            <div className="scan-stat-card">
              <div className="scan-stat-label">Wasted Space</div>
              <div className="scan-stat-value">{formatBytes(data.total_wasted_bytes)}</div>
            </div>
          </div>

          {data.groups.map((group) => (
            <div key={group.hash} style={{ marginTop: 24 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>
                  {group.hash.substring(0, 16)}...
                </h3>
                <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {group.files.length} copies · {formatBytes(group.files[0].size)} each ·{" "}
                  <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>
                    {formatBytes(group.total_savings)} waste
                  </span>
                </span>
              </div>

              <div className="file-table-wrapper">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Path</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.files.map((f) => (
                      <tr key={f.id} className="file-table-row">
                        <td className="file-table-filename">{f.filename}</td>
                        <td style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          maxWidth: 400,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {f.full_path}
                        </td>
                        <td>{formatBytes(f.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && !error && data === null && (
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          No completed scans found. Run a scan first to see duplicates.
        </p>
      )}
    </div>
  );
}
