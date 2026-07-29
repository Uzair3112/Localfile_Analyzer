import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { DuplicateListResponse, DuplicateGroup, DuplicateDeleteResponse } from "../api/types";

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
  const [searchParams] = useSearchParams();
  const scanIdParam = searchParams.get("scanId");
  const [scanId, setScanId] = useState<number | null>(scanIdParam ? parseInt(scanIdParam, 10) : null);
  const [data, setData] = useState<DuplicateListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<DuplicateDeleteResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (scanIdParam) {
      setScanId(parseInt(scanIdParam, 10));
      return;
    }
    api.listScans(1, 1)
      .then((res) => {
        const completed = res.scans.find((s) => s.status === "completed");
        if (completed) {
          setScanId(completed.scan_id);
        }
      })
      .catch(() => {});
  }, [scanIdParam]);

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

  const allFiles = useMemo(() => {
    if (!data) return [];
    return data.groups.flatMap((g) => g.files);
  }, [data]);

  const selectedCount = selectedIds.size;

  const toggleFile = (fileId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const toggleGroup = (group: DuplicateGroup, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const f of group.files) {
        if (checked) {
          next.add(f.id);
        } else {
          next.delete(f.id);
        }
      }
      return next;
    });
  };

  const selectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(allFiles.map((f) => f.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleDelete = async () => {
    if (!scanId || selectedIds.size === 0) return;
    setDeleting(true);
    setShowConfirm(false);
    setDeleteResult(null);
    try {
      const result = await api.deleteDuplicateFiles(scanId, [...selectedIds]);
      setDeleteResult(result);
      if (result.total_failed === 0) {
        setSelectedIds(new Set());
        fetchDuplicates(scanId);
      }
    } catch (err) {
      setDeleteResult({
        deleted: [],
        failed: [{ id: 0, filename: "", full_path: "", success: false, error: err instanceof Error ? err.message : "Delete failed" }],
        total_deleted: 0,
        total_failed: 1,
      });
    } finally {
      setDeleting(false);
    }
  };

  const allSelected = allFiles.length > 0 && selectedIds.size === allFiles.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < allFiles.length;

  return (
    <div className="page">
      <h1>Duplicates {scanId ? <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)" }}>(Scan {scanId})</span> : null}</h1>

      {!scanId && !loading && (
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          Select a scan from <Link to="/scans" style={{ color: "var(--color-primary)" }}>Scans</Link> to view its duplicates.
        </p>
      )}

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
          No duplicate files found in this scan.
        </p>
      )}

      {deleteResult && (
        <div
          className="delete-result-banner"
          style={{
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 8,
            background: deleteResult.total_failed === 0 ? "var(--color-primary-light, #E6F4EC)" : "#FEF3C7",
            color: deleteResult.total_failed === 0 ? "var(--color-primary, #1F8A5A)" : "#92400E",
          }}
        >
          <strong>
            {deleteResult.total_deleted} file{deleteResult.total_deleted !== 1 ? "s" : ""} deleted
            {deleteResult.total_failed > 0 ? `, ${deleteResult.total_failed} failed` : ""}
          </strong>
          {deleteResult.failed.length > 0 && (
            <ul style={{ marginTop: 8, fontSize: 13, margin: 0, paddingLeft: 20 }}>
              {deleteResult.failed.map((f, i) => (
                <li key={i}>{f.filename}: {f.error}</li>
              ))}
            </ul>
          )}
        </div>
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

          {selectedCount > 0 && (
            <div
              className="delete-bar"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 16,
                padding: "12px 16px",
                background: "var(--color-danger-light, #FBEAEA)",
                borderRadius: 8,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {selectedCount} file{selectedCount !== 1 ? "s" : ""} selected
              </span>
              <button
                className="btn-danger"
                onClick={() => setShowConfirm(true)}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Selected"}
              </button>
            </div>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              cursor: "pointer",
              marginTop: 16,
              padding: "4px 0",
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={(e) => selectAll(e.target.checked)}
            />
            Select all ({allFiles.length} files)
          </label>

          {data.groups.map((group, idx) => {
            const groupAllSelected = group.files.every((f) => selectedIds.has(f.id));
            const groupSomeSelected = group.files.some((f) => selectedIds.has(f.id)) && !groupAllSelected;

            return (
              <div key={group.hash} style={{ marginTop: 24 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={groupAllSelected}
                      ref={(el) => { if (el) el.indeterminate = groupSomeSelected; }}
                      onChange={(e) => toggleGroup(group, e.target.checked)}
                    />
                    <h3 style={{ fontSize: 16, fontWeight: 600 }}>Group {idx + 1}</h3>
                  </label>
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
                        <th style={{ width: 40 }}></th>
                        <th>Filename</th>
                        <th>Path</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.files.map((f) => (
                        <tr
                          key={f.id}
                          className={`file-table-row${selectedIds.has(f.id) ? " selected" : ""}`}
                        >
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(f.id)}
                              onChange={() => toggleFile(f.id)}
                            />
                          </td>
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
            );
          })}

          {showConfirm && (
            <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Delete {selectedCount} file{selectedCount !== 1 ? "s" : ""}?</h3>
                <p style={{ color: "var(--color-text-muted)", marginTop: 8, fontSize: 14 }}>
                  This will permanently delete the selected files from your disk.
                  This action cannot be undone.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
                  <button className="btn-cancel" onClick={() => setShowConfirm(false)} disabled={deleting}>
                    Keep Files
                  </button>
                  <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                    {deleting ? "Deleting..." : `Delete ${selectedCount} file${selectedCount !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !error && data === null && scanId && (
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>
          No data available for this scan.
        </p>
      )}
    </div>
  );
}
