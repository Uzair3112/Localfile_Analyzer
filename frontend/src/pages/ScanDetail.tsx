import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useScanPolling } from "../hooks/useScanPolling";
import { api } from "../api/client";
import type { ScannedFile, LargestFoldersResponse } from "../api/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const PAGE_SIZE = 50;
const EXTENSIONS = ["", ".py", ".js", ".ts", ".md", ".json", ".html", ".css", ".txt", ".yml", ".yaml", ".sh"];

export default function ScanDetail() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const id = scanId ? parseInt(scanId, 10) : null;
  const { scan, loading, error } = useScanPolling(id);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesPage, setFilesPage] = useState(1);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [fileExt, setFileExt] = useState("");
  const [fileSort, setFileSort] = useState("filename");
  const [fileOrder, setFileOrder] = useState("asc");
  const [showSettings, setShowSettings] = useState(false);
  const [overrideHidden, setOverrideHidden] = useState(true);
  const [overrideNodeModules, setOverrideNodeModules] = useState(true);
  const [overrideMaxSize, setOverrideMaxSize] = useState(52428800);

  const [largestFiles, setLargestFiles] = useState<ScannedFile[] | null>(null);
  const [largestFolders, setLargestFolders] = useState<LargestFoldersResponse | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!id || scan?.status !== "completed") return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const data = await api.getScanFiles(id, {
        page: filesPage,
        page_size: PAGE_SIZE,
        extension: fileExt || undefined,
        search: fileSearch || undefined,
        sort: fileSort,
        order: fileOrder,
      });
      setFiles(data.files);
      setFilesTotal(data.total);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setFilesLoading(false);
    }
  }, [id, scan?.status, filesPage, fileExt, fileSearch, fileSort, fileOrder]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (!id || scan?.status !== "completed") {
      setLargestFiles(null);
      setLargestFolders(null);
      return;
    }
    api.getScanFiles(id, { sort: "size", order: "desc", page_size: 5 })
      .then((data) => setLargestFiles(data.files))
      .catch(() => setLargestFiles(null));
    api.getScanLargestFolders(id, 5)
      .then(setLargestFolders)
      .catch(() => setLargestFolders(null));
  }, [id, scan?.status]);

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

  const handleSort = (col: string) => {
    if (fileSort === col) {
      setFileOrder(fileOrder === "asc" ? "desc" : "asc");
    } else {
      setFileSort(col);
      setFileOrder("asc");
    }
    setFilesPage(1);
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
        <h1>Scan {id}</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Loading scan...</p>
      </div>
    );
  }

  if (error && !scan) {
    return (
      <div className="page">
        <h1>Scan {id}</h1>
        <div className="scan-error-message" style={{ marginTop: 16 }}>{error}</div>
        <Link to="/" style={{ display: "inline-block", marginTop: 16, color: "var(--color-primary)" }}>Back to Dashboard</Link>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="page">
        <h1>Scan {id}</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Scan not found.</p>
        <Link to="/" style={{ display: "inline-block", marginTop: 16, color: "var(--color-primary)" }}>Back to Dashboard</Link>
      </div>
    );
  }

  const statusClass = scan.status === "completed" ? "completed"
    : scan.status === "running" ? "running"
    : scan.status === "failed" ? "failed"
    : "pending";

  const totalPages = Math.ceil(filesTotal / PAGE_SIZE);

  const sortIndicator = (col: string) => {
    if (fileSort !== col) return "";
    return fileOrder === "asc" ? " ▲" : " ▼";
  };

  return (
    <div className="page">
      <div className="scan-detail-header">
        <h1>Scan {scan.scan_id}</h1>
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

      {/* Per-scan settings override dialog */}
      {showSettings && (
        <div className="dialog-overlay" onClick={() => setShowSettings(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="dialog-title">Scan Settings Override</h2>
            <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="dialog-label">
                <input type="checkbox" checked={overrideHidden} onChange={(e) => setOverrideHidden(e.target.checked)} />
                {" "}Ignore hidden files
              </label>
              <label className="dialog-label">
                <input type="checkbox" checked={overrideNodeModules} onChange={(e) => setOverrideNodeModules(e.target.checked)} />
                {" "}Ignore node_modules
              </label>
              <label className="dialog-label">
                Max file size (bytes)
                <input
                  type="number"
                  className="settings-input"
                  value={overrideMaxSize}
                  onChange={(e) => setOverrideMaxSize(Number(e.target.value))}
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="scan-error-message" style={{ marginTop: 12 }}>{deleteError}</div>
      )}

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Link to="/scans" style={{ color: "var(--color-primary)" }}>Back to Scans</Link>
        {scan.status === "completed" && (
          <button className="btn-secondary" onClick={() => setShowSettings(true)} style={{ fontSize: 13 }}>
            View Settings Used
          </button>
        )}
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
            <h2 className="dialog-title">Delete Scan {scan.scan_id}?</h2>
            <div className="dialog-body">
              <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
                This will permanently remove this scan and all its data (files, duplicates).
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

      {scan.status === "completed" && id && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Files
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
                ({filesTotal} total)
              </span>
            </h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="file-table-filter"
                value={fileExt}
                onChange={(e) => { setFileExt(e.target.value); setFilesPage(1); }}
              >
                <option value="">All extensions</option>
                {EXTENSIONS.filter(Boolean).map((ext) => (
                  <option key={ext} value={ext}>{ext}</option>
                ))}
              </select>
              <input
                className="file-table-filter"
                type="text"
                placeholder="Search files..."
                value={fileSearch}
                onChange={(e) => { setFileSearch(e.target.value); setFilesPage(1); }}
                style={{ width: 180 }}
              />
            </div>
          </div>

          {filesLoading ? (
            <p style={{ color: "var(--color-text-muted)", padding: 20 }}>Loading files...</p>
          ) : filesError ? (
            <div className="scan-error-message">{filesError}</div>
          ) : files.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", padding: 20 }}>
              {fileSearch || fileExt ? "No files match the current filters." : "No files found in this scan."}
            </p>
          ) : (
            <>
              <div className="file-table-wrapper">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th className="file-table-sortable" onClick={() => handleSort("filename")}>
                        Filename{sortIndicator("filename")}
                      </th>
                      <th className="file-table-sortable" onClick={() => handleSort("extension")}>
                        Type{sortIndicator("extension")}
                      </th>
                      <th className="file-table-sortable" onClick={() => handleSort("size")}>
                        Size{sortIndicator("size")}
                      </th>
                      <th className="file-table-sortable" onClick={() => handleSort("line_count")}>
                        Lines{sortIndicator("line_count")}
                      </th>
                      <th className="file-table-sortable" onClick={() => handleSort("modified_at")}>
                        Modified{sortIndicator("modified_at")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} className="file-table-row" title={f.full_path}>
                        <td className="file-table-filename">{f.filename}</td>
                        <td><span className="file-ext-badge">{f.extension || "-"}</span></td>
                        <td>{formatBytes(f.size)}</td>
                        <td>{f.line_count != null ? formatNumber(f.line_count) : <span className="file-table-null">-</span>}</td>
                        <td className="file-table-date">
                          {f.modified_at ? new Date(f.modified_at).toLocaleDateString() : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16, alignItems: "center" }}>
                  <button
                    className="btn-secondary"
                    disabled={filesPage <= 1}
                    onClick={() => setFilesPage((p) => Math.max(1, p - 1))}
                    style={{ padding: "6px 14px", fontSize: 13 }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    Page {filesPage} of {totalPages}
                  </span>
                  <button
                    className="btn-secondary"
                    disabled={filesPage >= totalPages}
                    onClick={() => setFilesPage((p) => p + 1)}
                    style={{ padding: "6px 14px", fontSize: 13 }}
                  >
                    Next
                  </button>
                </div>
              )}

              {largestFiles && largestFiles.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Largest Files</h3>
                  <div className="extensions-card">
                    {largestFiles.map((f, i) => (
                      <div key={f.id} className="largest-file-row">
                        <span className="largest-file-rank">{i + 1}.</span>
                        <div className="largest-file-info">
                          <div className="largest-file-name" title={f.filename}>{f.filename}</div>
                          <div className="largest-file-path" title={f.full_path}>{f.full_path}</div>
                        </div>
                        <span className="largest-file-ext">{f.extension ?? "\u2014"}</span>
                        <span className="largest-file-size">{formatBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {largestFolders && largestFolders.folders.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Largest Folders</h3>
                  <div className="extensions-card">
                    {largestFolders.folders.map((f, i) => {
                      const displayPath = f.folder_path.startsWith(scan.folder_path)
                        ? f.folder_path.slice(scan.folder_path.length) || "/"
                        : f.folder_path;
                      return (
                        <div key={f.folder_path} className="largest-folder-row">
                          <span className="largest-folder-rank">{i + 1}.</span>
                          <div className="largest-folder-info">
                            <div className="largest-folder-name" title={f.folder_path}>{displayPath}</div>
                          </div>
                          <span className="largest-folder-count">{formatNumber(f.file_count)} files</span>
                          <span className="largest-folder-size">{formatBytes(f.total_size)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
