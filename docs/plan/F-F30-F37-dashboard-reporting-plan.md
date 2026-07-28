# Plan: F — Dashboard & Reporting (F30–F37)

**Status:** F30, F31, F35 already implemented · F32, F33, F34, F36, F37 not started
**Pre-requisites:** F26–F29 complete (file browsing, extensions)
**Target:** Complete the Dashboard with overview chart, largest files/folders lists, scan history/comparison view, and cleanup goals widget
**Design reference:** PRD §5.3 (Reporting & History), PRD §7.1 (Dashboard layout, stat cards, overview chart, recent activity, right-side widgets), PDD §5 (Frontend component architecture)

---

## Current State Summary

**F30 (Dashboard Layout)** — Already implemented in `frontend/src/pages/Dashboard.tsx:74-222`:
- Full dashboard page rendered inside `.page` container
- Stat cards row (Total Scans, Files Found, Total Size)
- Recent Scans table (first 5 scans, clickable rows → navigate to scan detail)
- Top Extensions card (from `api.getScanExtensions` using latest completed scan)
- All handled: loading, empty, error states

**F31 (Stat Cards)** — Already implemented:
- Three stat cards inline in `Dashboard.tsx:78-91`: Total Scans, Files Found, Total Size
- Uses existing `.scan-stats-grid`, `.scan-stat-card`, `.scan-stat-label`, `.scan-stat-value` CSS classes
- `formatNumber()` and `formatBytes()` helper functions

**F35 (Recent Scans Table)** — Already implemented in `Dashboard.tsx:93-155`:
- Shows first 5 scans from `allScans` array
- Columns: ID, Folder, Status (colored pill), Files, Size, Lines, Started
- "View All" button navigates to `/scans`
- Empty state with guidance text

**What all five features still need:**
- `docs/features.md` and `docs/CurrentProgress.md` show F32, F33, F34, F36, F37 as `[ ]` — must be updated to `[x]` after implementation
- Dashboard layout needs to accommodate new sections (chart, largest files, largest folders, cleanup goals)

---

## F32 — Overview Chart

### Objective
Add a bar chart (Recharts) to the Dashboard showing files/lines scanned per scan run, with hover tooltips. This replaces the "Earnings" chart from the reference UI design (PRD §7.1: "Overview chart card: bar chart of files scanned per month or per scan run").

### Implementation Steps

#### 32.1 Backend — no new endpoint needed

The existing `GET /scans` endpoint (paginated list) returns all the data needed:
- `scan_id` → x-axis label
- `total_files` → primary bar value
- `total_lines` → secondary bar value (optional, for comparison)
- `started_at` → date for tooltip
- `folder_path` → tooltip context

The frontend already fetches all scans into `allScans` state. No backend changes needed.

#### 32.2 Create OverviewChart component — `frontend/src/components/dashboard/OverviewChart.tsx`

Create the component:

```tsx
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
      .slice()
      .reverse()
      .map((s) => ({
        name: `#${s.scan_id}`,
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
            formatter={(value: number, name: string) => {
              const label = name === "files" ? "Files" : "Lines";
              return [formatNumber(value), label];
            }}
            labelFormatter={(label: string) => `${label} — ${chartData.find(d => d.name === label)?.folder ?? ""}`}
          />
          <Legend />
          <Bar dataKey="files" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name="Files" />
          <Bar dataKey="lines" fill="#2563EB" radius={[4, 4, 0, 0]} name="Lines" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Design notes:
- Only completed scans are charted (running/pending have incomplete data)
- Scans are reversed so newest is on the right (time-series order)
- Uses `ResponsiveContainer` for responsive width
- Green bar for files, blue bar for lines (matches reference color scheme)
- Rounded top corners on bars (`radius={[4, 4, 0, 0]}`)
- Tooltip shows scan ID, folder path, date, file count, line count

#### 32.3 Add CSS — `frontend/src/App.css`

```css
.overview-chart-card {
  background: var(--color-card);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  margin-top: 32px;
}

.overview-chart-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
}
```

#### 32.4 Integrate into Dashboard — `frontend/src/pages/Dashboard.tsx`

Add import:
```tsx
import OverviewChart from "../components/dashboard/OverviewChart";
```

Insert the component in the JSX after the stat cards and before the Recent Scans section:

```tsx
{/* Overview Chart */}
{allScans.filter(s => s.status === "completed").length > 0 && (
  <OverviewChart scans={allScans} />
)}
```

Only render when there are completed scans to chart.

#### 32.5 Acceptance Criteria for F32

1. **Dashboard with scans** — chart appears showing bars per scan run
2. **No completed scans** — chart is absent (no empty space)
3. **Hover tooltip** — shows scan ID, folder, date, file count, line count
4. **Responsive** — chart resizes with window; bars scale proportionally
5. **Single scan** — one bar shown; tooltip works
6. **Many scans (20+)** — all bars visible, x-axis labels may overlap (acceptable at >15 bars; future improvement: rotate labels or paginate)
7. **Legend** — shows Files (green) and Lines (blue)

---

## F33 — Largest Files List

### Objective
Query + UI card showing the top N largest files in the latest completed scan. Displayed as a sortable list with filename, path, size, and extension badge.

### Implementation Steps

#### 33.1 Backend — no new endpoint needed

The existing `GET /scans/{scan_id}/files?sort=size&order=desc&page_size=10` endpoint already supports this query. Just need a small wrapper or reuse the existing `api.getScanFiles()` with appropriate params.

Alternatively, add a dedicated lightweight endpoint that returns only the top N files (id, filename, extension, size, full_path) without pagination metadata. The existing endpoint works fine — use it directly.

**Decision:** Use existing `api.getScanFiles(scanId, { sort: "size", order: "desc", page_size: limit })` from frontend. No backend changes needed.

#### 33.2 Add to Dashboard — `frontend/src/pages/Dashboard.tsx`

Add state:
```tsx
const [largestFiles, setLargestFiles] = useState<ScannedFile[] | null>(null);
const [filesLoading, setFilesLoading] = useState(false);
const [filesError, setFilesError] = useState<string | null>(null);
```

Add fetch logic in the same `useEffect` that fetches extensions (or a new one triggered by `latestCompletedScan?.scan_id`):

```tsx
useEffect(() => {
  if (!latestCompletedScan) {
    setLargestFiles(null);
    return;
  }
  setFilesLoading(true);
  setFilesError(null);
  api.getScanFiles(latestCompletedScan.scan_id, {
    sort: "size",
    order: "desc",
    page_size: 10,
  })
    .then((data) => setLargestFiles(data.files))
    .catch((err) => {
      setFilesError(err instanceof Error ? err.message : "Failed to load largest files");
      setLargestFiles(null);
    })
    .finally(() => setFilesLoading(false));
}, [latestCompletedScan?.scan_id]);
```

Add import:
```tsx
import type { ScanResponse, ExtensionBreakdownItem, ScannedFile } from "../api/types";
```

Add UI section after the extensions card:

```tsx
{/* Largest Files */}
{!filesLoading && !filesError && largestFiles && largestFiles.length > 0 && (
  <div style={{ marginTop: 32 }}>
    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
      Largest Files
      <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
        from #{latestCompletedScan.scan_id}
      </span>
    </h2>
    <div className="extensions-card">
      {largestFiles.map((f, i) => (
        <div key={f.id} className="largest-file-row">
          <span className="largest-file-rank">#{i + 1}</span>
          <div className="largest-file-info">
            <div className="largest-file-name" title={f.filename}>{f.filename}</div>
            <div className="largest-file-path" title={f.full_path}>{f.full_path}</div>
          </div>
          <span className="largest-file-ext">{f.extension ?? "—"}</span>
          <span className="largest-file-size">{formatBytes(f.size)}</span>
        </div>
      ))}
    </div>
  </div>
)}

{filesLoading && (
  <div style={{ marginTop: 32 }}>
    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Largest Files</h2>
    <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
  </div>
)}

{filesError && !filesLoading && (
  <div style={{ marginTop: 32 }}>
    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Largest Files</h2>
    <p style={{ color: "var(--color-danger)", fontSize: 14 }}>{filesError}</p>
  </div>
)}
```

#### 33.3 Add CSS — `frontend/src/App.css`

```css
.largest-file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}
.largest-file-row:last-child {
  border-bottom: none;
}

.largest-file-rank {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 28px;
}

.largest-file-info {
  flex: 1;
  min-width: 0;
}

.largest-file-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.largest-file-path {
  font-size: 12px;
  font-family: monospace;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.largest-file-ext {
  font-size: 12px;
  font-family: monospace;
  color: var(--color-text-muted);
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 4px;
  min-width: 40px;
  text-align: center;
}

.largest-file-size {
  font-size: 14px;
  font-weight: 600;
  min-width: 80px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

#### 33.4 Acceptance Criteria for F33

1. **Dashboard with completed scan** — 10 largest files listed with filename, path, extension badge, size
2. **No completed scan** — section absent
3. **Scan with <10 files** — shows all files
4. **Scan with 0 files** — section absent (no data)
5. **Very long filenames/paths** — truncated with ellipsis
6. **Loading state** — shows "Loading..." without blocking rest of dashboard
7. **Error state** — shows error text, dashboard still functional

---

## F34 — Largest Folders List

### Objective
Aggregate file sizes by parent directory; show top N largest folders. This provides insight into which directories consume the most disk space.

### Implementation Steps

#### 34.1 Backend — add `GET /scans/{scan_id}/largest-folders` endpoint

**New Pydantic schema** in `backend/app/schemas/scan.py`:

```python
class LargestFolderItem(BaseModel):
    folder_path: str
    file_count: int
    total_size: int


class LargestFoldersResponse(BaseModel):
    folders: list[LargestFolderItem]
    total_folders: int
```
Append to `backend/app/schemas/scan.py`.

**New endpoint** in `backend/app/api/scans.py`:

```python
@router.get("/{scan_id}/largest-folders")
async def get_scan_largest_folders(
    scan_id: int,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    limit = max(1, min(limit, 50))

    # Use SQL to extract parent directory from full_path and aggregate
    from sqlalchemy import literal_column, func as sa_func

    # For PostgreSQL: take the directory part of full_path
    # Using regexp_replace or substring to get parent directory
    folder_expr = sa_func.regexp_replace(
        ScannedFile.full_path,
        r'/[^/]+$',  # Remove filename part (after last /)
        '',
    )

    # For Windows paths, also handle backslashes
    # Normalize: replace backslashes with forward slashes first
    normalized_path = sa_func.replace(ScannedFile.full_path, '\\', '/')
    parent_dir = sa_func.regexp_replace(normalized_path, r'/[^/]+$', '')

    grouped_query = (
        select(
            parent_dir.label("folder_path"),
            sa_func.count(ScannedFile.id).label("file_count"),
            sa_func.sum(ScannedFile.size).label("total_size"),
        )
        .where(ScannedFile.scan_id == scan_id)
        .group_by(parent_dir)
        .order_by(sa_func.sum(ScannedFile.size).desc())
        .limit(limit)
    )

    rows = (await db.execute(grouped_query)).all()

    folders = [
        LargestFolderItem(
            folder_path=row.folder_path,
            file_count=row.file_count,
            total_size=row.total_size or 0,
        )
        for row in rows
    ]

    # Count total distinct directories
    count_result = await db.execute(
        select(sa_func.count(sa_func.distinct(parent_dir)))
        .where(ScannedFile.scan_id == scan_id)
    )
    total_folders = count_result.scalar() or 0

    return LargestFoldersResponse(
        folders=folders,
        total_folders=total_folders,
    )
```

**Important — SQL considerations:**
- PostgreSQL `regexp_replace` strips the filename from `full_path` to get the parent directory
- Must handle both forward-slash and backslash paths (cross-platform: scanner normalizes paths with forward slashes — verify existing behaviour in `walker.py`/`runner.py`)
- Files at root level (no parent directory beyond the scan root) should be grouped as the root folder
- `LargestFolderItem.folder_path` should be relative to the scan root for readability, not the absolute path. This can be handled in the frontend or by passing the scan root path to the query and stripping it.

**Alternative approach (simpler SQL):** Instead of regex in SQL, do the aggregation in Python:

```python
from collections import defaultdict
from pathlib import Path

# Fetch all files for this scan (just id, full_path, size)
result = await db.execute(
    select(ScannedFile.id, ScannedFile.full_path, ScannedFile.size)
    .where(ScannedFile.scan_id == scan_id)
)
all_rows = result.all()

# Aggregate by parent directory
dir_map: dict[str, dict] = defaultdict(lambda: {"file_count": 0, "total_size": 0})
for row in all_rows:
    parent = str(Path(row.full_path).parent)
    dir_map[parent]["file_count"] += 1
    dir_map[parent]["total_size"] += (row.size or 0)

# Sort by total_size descending
sorted_dirs = sorted(dir_map.items(), key=lambda x: -x[1]["total_size"])[:limit]

folders = [
    LargestFolderItem(
        folder_path=path,
        file_count=info["file_count"],
        total_size=info["total_size"],
    )
    for path, info in sorted_dirs
]

total_folders = len(dir_map)
```

**Decision:** Use the Python aggregation approach (simpler, more portable, no regex differences across DB engines). For scans with 100k+ files, this fetches all file paths and sizes into memory — acceptable for v1 (paths + sizes for 100k files ≈ ~10 MB). Profile and optimize with SQL-level aggregation if needed later.

**Important edge case:** If the scan root path contains files directly (not in subdirectories), `Path(full_path).parent` would give the scan root itself. Consider stripping the scan root prefix to show relative paths.

#### 34.2 Add frontend API method — `frontend/src/api/client.ts`

```typescript
import type {
  ...
  LargestFoldersResponse,
} from "./types";

// Inside api object:
getScanLargestFolders: (scanId: number, limit?: number) =>
  request<LargestFoldersResponse>(
    `/scans/${scanId}/largest-folders${limit ? `?limit=${limit}` : ""}`,
  ),
```

#### 34.3 Add TypeScript types — `frontend/src/api/types.ts`

```typescript
export interface LargestFolderItem {
  folder_path: string;
  file_count: number;
  total_size: number;
}

export interface LargestFoldersResponse {
  folders: LargestFolderItem[];
  total_folders: number;
}
```

#### 34.4 Add to Dashboard — `frontend/src/pages/Dashboard.tsx`

Add state:
```tsx
const [largestFolders, setLargestFolders] = useState<LargestFoldersResponse | null>(null);
const [foldersLoading, setFoldersLoading] = useState(false);
const [foldersError, setFoldersError] = useState<string | null>(null);
```

Add import:
```tsx
import type { ..., LargestFolderItem } from "../api/types";
```

Add fetch logic alongside `largestFiles` fetch (same `useEffect`):
```tsx
api.getScanLargestFolders(latestCompletedScan.scan_id, 10)
  .then(setLargestFolders)
  .catch(() => setLargestFolders(null));
```

Add UI section after Largest Files:

```tsx
{/* Largest Folders */}
{!foldersLoading && !foldersError && largestFolders && largestFolders.folders.length > 0 && (
  <div style={{ marginTop: 32 }}>
    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
      Largest Folders
      <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 8 }}>
        from #{latestCompletedScan.scan_id}
      </span>
    </h2>
    <div className="extensions-card">
      {largestFolders.folders.map((f, i) => (
        <div key={f.folder_path} className="largest-folder-row">
          <span className="largest-folder-rank">#{i + 1}</span>
          <div className="largest-folder-info">
            <div className="largest-folder-name" title={f.folder_path}>
              {displayFolderName}
            </div>
          </div>
          <span className="largest-folder-count">{formatNumber(f.file_count)} files</span>
          <span className="largest-folder-size">{formatBytes(f.total_size)}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

The `displayFolderName` should be relative to the scan root for readability. Compute it by stripping the scan root path prefix using `latestCompletedScan.folder_path`.

```tsx
const scanRoot = latestCompletedScan?.folder_path ?? "";
const displayPath = f.folder_path.startsWith(scanRoot)
  ? f.folder_path.slice(scanRoot.length) || "/"
  : f.folder_path;
```

#### 34.5 Add CSS — `frontend/src/App.css`

```css
.largest-folder-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}
.largest-folder-row:last-child {
  border-bottom: none;
}

.largest-folder-rank {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 28px;
}

.largest-folder-info {
  flex: 1;
  min-width: 0;
}

.largest-folder-name {
  font-size: 14px;
  font-weight: 500;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.largest-folder-count {
  font-size: 13px;
  color: var(--color-text-muted);
  min-width: 80px;
  text-align: right;
}

.largest-folder-size {
  font-size: 14px;
  font-weight: 600;
  min-width: 80px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

#### 34.6 Acceptance Criteria for F34

1. **Dashboard with completed scan** — 10 largest folders listed with relative path, file count, total size
2. **No completed scan** — section absent
3. **Scan with files at root only** — one folder entry (root `/`)
4. **Scan with deep nested folders** — all paths shown, long paths truncated
5. **Sorting** — folders sorted by total size descending
6. **Loading/error states** — same pattern as F33
7. **Path display** — paths shown relative to scan root for readability

---

## F36 — Scan History / Comparison View

### Objective
A dedicated view listing all past scans with the ability to browse and compare across runs. This extends the existing ScansList page with comparison functionality.

### Implementation Steps

#### 36.1 Extend existing ScansList page — `frontend/src/pages/ScansList.tsx`

The current `ScansList.tsx` already shows a paginated list of scans. Enhance it with:

1. **Select scans for comparison** — checkboxes on each row
2. **Compare button** — enabled when 2+ scans selected
3. **Comparison modal or inline view** — side-by-side table comparing selected scans on key metrics

**Comparison metrics:**
- Total files
- Total size
- Total lines
- Number of duplicate groups
- Top extension (most common)
- Folder path

**State additions:**

```tsx
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [compareMode, setCompareMode] = useState(false);
const [compareScans, setCompareScans] = useState<ScanResponse[]>([]);
```

**UI additions:**

```tsx
{/* Comparison mode */}
{compareMode && compareScans.length >= 2 && (
  <div className="comparison-section">
    <div className="comparison-header">
      <h2>Scan Comparison</h2>
      <button className="btn-secondary" onClick={() => setCompareMode(false)}>
        Close Comparison
      </button>
    </div>
    <div className="comparison-table-wrapper">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            {compareScans.map(s => (
              <th key={s.scan_id}>Scan #{s.scan_id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Folder</td>
            {compareScans.map(s => <td key={s.scan_id}>{s.folder_path}</td>)}
          </tr>
          <tr>
            <td>Total Files</td>
            {compareScans.map(s => <td key={s.scan_id}>{formatNumber(s.total_files)}</td>)}
          </tr>
          <tr>
            <td>Total Size</td>
            {compareScans.map(s => <td key={s.scan_id}>{formatBytes(s.total_size)}</td>)}
          </tr>
          <tr>
            <td>Total Lines</td>
            {compareScans.map(s => <td key={s.scan_id}>{formatNumber(s.total_lines)}</td>)}
          </tr>
          <tr>
            <td>Status</td>
            {compareScans.map(s => (
              <td key={s.scan_id}>
                <span className={`scan-status-badge ${statusClass(s.status)}`}>
                  {s.status}
                </span>
              </td>
            ))}
          </tr>
          <tr>
            <td>Date</td>
            {compareScans.map(s => (
              <td key={s.scan_id}>
                {s.completed_at ? new Date(s.completed_at).toLocaleString() : "-"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  </div>
)}
```

**Add checkbox column to scan table:**

```tsx
<th style={{ width: 40 }}></th>  {/* Checkbox column header */}
...
<td>
  <input
    type="checkbox"
    checked={selectedIds.has(scan.scan_id)}
    onChange={(e) => {
      e.stopPropagation();
      const next = new Set(selectedIds);
      if (next.has(scan.scan_id)) {
        next.delete(scan.scan_id);
      } else {
        next.add(scan.scan_id);
      }
      setSelectedIds(next);
    }}
  />
</td>
```

**Add "Compare Selected" button** in the header area (visible when 2+ selected):

```tsx
{selectedIds.size >= 2 && (
  <button
    className="btn-primary"
    onClick={() => {
      const selected = scans.filter(s => selectedIds.has(s.scan_id));
      setCompareScans(selected);
      setCompareMode(true);
    }}
  >
    Compare Selected ({selectedIds.size})
  </button>
)}
```

#### 36.2 Add "Same Folder" grouping indicator

Add a visual cue showing which scans share the same folder path (useful for tracking changes over time):

- Group scans by folder path in the comparison table
- Show a "Same folder" badge when comparing scans with identical `folder_path`

```tsx
{/* After the comparison table row for Folder */}
{compareScans.every(s => s.folder_path === compareScans[0].folder_path) && (
  <tr>
    <td colSpan={compareScans.length + 1}>
      <span className="same-folder-badge">✓ Same folder — tracks changes over time</span>
    </td>
  </tr>
)}
```

#### 36.3 Add CSS — `frontend/src/App.css`

```css
.comparison-section {
  margin-top: 32px;
  background: var(--color-card);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.comparison-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.comparison-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.comparison-table-wrapper {
  overflow-x: auto;
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.comparison-table th,
.comparison-table td {
  padding: 10px 16px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
}

.comparison-table th {
  font-weight: 600;
  color: var(--color-text-muted);
  background: #f9fafb;
  font-size: 13px;
}

.comparison-table td:first-child {
  font-weight: 600;
  white-space: nowrap;
}

.comparison-table tbody tr:hover {
  background: #f9fafb;
}

.same-folder-badge {
  display: inline-block;
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 500;
  padding: 4px 0;
}
```

#### 36.4 Add route for comparison view (optional)

If comparison view is too large to inline, create a dedicated page `frontend/src/pages/ScanComparison.tsx` and add a route in `App.tsx`:

```tsx
<Route path="/compare?ids=1,2,3" element={<ScanComparison />} />
```

**Decision for v1:** Keep comparison inline on the ScansList page. If the page becomes too complex, extract to a dedicated component or page.

#### 36.5 Acceptance Criteria for F36

1. **ScansList page** — each row has a checkbox
2. **Select 2+ scans** — "Compare Selected" button appears
3. **Click "Compare"** — comparison table appears with side-by-side metrics
4. **Metrics compared** — folder, files, size, lines, status, date
5. **Same-folder detection** — badge shows when all selected scans share the same folder path
6. **Close comparison** — button to hide comparison view
7. **Select 0 or 1 scans** — no compare button
8. **Deselect all** — compare button disappears
9. **Long folder paths** — truncated with ellipsis in comparison view
10. **Responsive** — comparison table scrolls horizontally on narrow screens

---

## F37 — Cleanup Goals Widget (stretch)

### Objective
A UI card on the Dashboard summarizing actionable cleanup items (e.g. "12/40 duplicates resolved", "3/10 large files compressed"). Presentation only in v1 — no auto-resolution or action buttons.

### Implementation Steps

#### 37.1 Backend — no new endpoint needed

Data sources already exist:
- **Duplicates:** `GET /scans/{id}/duplicates` → `total_groups`, `total_duplicates`, `total_wasted_bytes`
- **Large files:** `GET /scans/{id}/files?sort=size&order=desc` → files exceeding a threshold (e.g., > 10 MB)
- **Files without extensions:** `GET /scans/{id}/extensions` → `files_without_extension`

All data can be derived from existing endpoints. Or create a single `GET /scans/{id}/cleanup-summary` endpoint that aggregates these.

#### 37.2 Backend — optional aggregated endpoint

Add to `backend/app/api/scans.py`:

```python
@router.get("/{scan_id}/cleanup-summary")
async def get_scan_cleanup_summary(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", ..., status=404)
    if scan.status != ScanStatus.completed:
        return _error_response("SCAN_NOT_COMPLETED", ...)

    # Duplicate info
    dup_count = await db.execute(
        select(func.count(func.distinct(Duplicate.hash)))
        .where(Duplicate.scan_id == scan_id)
    )
    dup_groups = dup_count.scalar() or 0

    dup_file_count = await db.execute(
        select(func.count(func.distinct(Duplicate.file1_id)))
        .where(Duplicate.scan_id == scan_id)
    )
    dup_files = dup_file_count.scalar() or 0

    # Large files (> 10MB = 10485760 bytes)
    large_files_count = await db.execute(
        select(func.count(ScannedFile.id))
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.size > 10485760,
        )
    )
    large_files = large_files_count.scalar() or 0

    # Extensionless files
    no_ext_count = await db.execute(
        select(func.count(ScannedFile.id))
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.extension.is_(None),
        )
    )
    no_ext_files = no_ext_count.scalar() or 0

    return {
        "duplicate_groups": dup_groups,
        "duplicate_files": dup_files,
        "large_files_10mb_plus": large_files,
        "files_without_extension": no_ext_files,
    }
```

Also add schema `CleanupSummaryResponse` in `backend/app/schemas/scan.py`:

```python
class CleanupSummaryResponse(BaseModel):
    duplicate_groups: int = 0
    duplicate_files: int = 0
    large_files_10mb_plus: int = 0
    files_without_extension: int = 0
```

#### 37.3 Add frontend API — `frontend/src/api/client.ts`

```typescript
import type { ..., CleanupSummaryResponse } from "./types";

getScanCleanupSummary: (scanId: number) =>
  request<CleanupSummaryResponse>(`/scans/${scanId}/cleanup-summary`),
```

#### 37.4 Add TypeScript type — `frontend/src/api/types.ts`

```typescript
export interface CleanupSummaryResponse {
  duplicate_groups: number;
  duplicate_files: number;
  large_files_10mb_plus: number;
  files_without_extension: number;
}
```

#### 37.5 Create CleanupGoalsCard component — `frontend/src/components/dashboard/CleanupGoalsCard.tsx`

```tsx
import type { CleanupSummaryResponse } from "../../api/types";

interface CleanupGoalsCardProps {
  data: CleanupSummaryResponse;
  formatNumber: (n: number) => string;
}

export default function CleanupGoalsCard({ data, formatNumber }: CleanupGoalsCardProps) {
  const goals = [
    {
      label: "Remove Duplicates",
      current: data.duplicate_files,
      total: data.duplicate_files,
      color: "var(--color-danger)",
      icon: "📄",
      note: data.duplicate_groups > 0
        ? `${data.duplicate_groups} group${data.duplicate_groups > 1 ? "s" : ""}`
        : "No duplicates found",
    },
    {
      label: "Compress Large Files",
      current: 0,
      total: data.large_files_10mb_plus,
      color: "#D97706",
      icon: "📦",
      note: data.large_files_10mb_plus > 0
        ? `${data.large_files_10mb_plus} file${data.large_files_10mb_plus > 1 ? "s" : ""} > 10MB`
        : "No large files",
    },
    {
      label: "Name Extensionless Files",
      current: 0,
      total: data.files_without_extension,
      color: "#2563EB",
      icon: "🏷️",
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
                    <span className="cleanup-goal-icon">{goal.icon}</span>
                    <span className="cleanup-goal-label">{goal.label}</span>
                    <span className="cleanup-goal-note">{goal.note}</span>
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
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
```

Note: `icon` emoji should NOT be used. Replace with simple text/icon badges following the project convention (e.g., a small colored square or SVG icon). The PRD specifically says "Use cleanup goals (e.g. 'Remove Duplicates 12/40 resolved')" — keep it text-only with color coding.

Revised without emojis:
- Use a small colored dot/indicator instead of emoji icon
- Or use a short text label with color

#### 37.6 Add CSS — `frontend/src/App.css`

```css
.cleanup-goals-card {
  background: var(--color-card);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.cleanup-goals-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px 0;
}

.cleanup-goals-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 16px;
}

.cleanup-goals-progress {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.cleanup-goals-subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
}

.cleanup-goals-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cleanup-goal-item {
  padding: 12px;
  border-radius: 8px;
  background: #f9fafb;
}

.cleanup-goal-item.resolved {
  opacity: 0.6;
}

.cleanup-goal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cleanup-goal-label {
  font-size: 14px;
  font-weight: 600;
}

.cleanup-goal-note {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: auto;
}

.cleanup-goal-bar-track {
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}

.cleanup-goal-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
```

#### 37.7 Integrate into Dashboard — `frontend/src/pages/Dashboard.tsx`

Add state:
```tsx
const [cleanupData, setCleanupData] = useState<CleanupSummaryResponse | null>(null);
const [cleanupLoading, setCleanupLoading] = useState(false);
```

Fetch in the same `useEffect` as other scan-dependent data:

```tsx
setCleanupLoading(true);
api.getScanCleanupSummary(latestCompletedScan.scan_id)
  .then(setCleanupData)
  .catch(() => setCleanupData(null))
  .finally(() => setCleanupLoading(false));
```

Add import:
```tsx
import CleanupGoalsCard from "../components/dashboard/CleanupGoalsCard";
```

Add UI section (placed as a right-side widget or below the extensions card):

```tsx
{/* Cleanup Goals */}
{!cleanupLoading && cleanupData && (
  <div style={{ marginTop: 32 }}>
    <CleanupGoalsCard data={cleanupData} formatNumber={formatNumber} />
  </div>
)}
```

#### 37.8 Acceptance Criteria for F37

1. **Dashboard with completed scan** — Cleanup Goals card shows duplicate count, large files count, extensionless files count
2. **No issues** — card shows "No cleanup items found"
3. **Some issues** — progress bars shown with appropriate fill levels
4. **Resolved goals** — dimmed with 100% bar
5. **No completed scan** — card absent
6. **Loading/error** — handled gracefully

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F32 | `frontend/src/components/dashboard/OverviewChart.tsx` | Create — new component with Recharts bar chart |
| 2 | F32 | `frontend/src/pages/Dashboard.tsx` | Edit — import and render OverviewChart |
| 3 | F32 | `frontend/src/App.css` | Add — `.overview-chart-card`, `.overview-chart-title` |
| 4 | F33 | `frontend/src/pages/Dashboard.tsx` | Edit — add largest files state + fetch + UI section |
| 5 | F33 | `frontend/src/App.css` | Add — `.largest-file-row`, `.largest-file-*` |
| 6 | F34 | `backend/app/schemas/scan.py` | Add — `LargestFolderItem`, `LargestFoldersResponse` schemas |
| 7 | F34 | `backend/app/api/scans.py` | Add — `GET /scans/{id}/largest-folders` endpoint |
| 8 | F34 | `frontend/src/api/types.ts` | Add — `LargestFolderItem`, `LargestFoldersResponse` interfaces |
| 9 | F34 | `frontend/src/api/client.ts` | Add — `getScanLargestFolders` method |
| 10 | F34 | `frontend/src/pages/Dashboard.tsx` | Edit — add largest folders state + fetch + UI section |
| 11 | F34 | `frontend/src/App.css` | Add — `.largest-folder-row`, `.largest-folder-*` |
| 12 | F36 | `frontend/src/pages/ScansList.tsx` | Edit — add checkboxes, compare button, comparison table |
| 13 | F36 | `frontend/src/App.css` | Add — `.comparison-section`, `.comparison-table`, etc. |
| 14 | F37 | `backend/app/schemas/scan.py` | Add — `CleanupSummaryResponse` schema |
| 15 | F37 | `backend/app/api/scans.py` | Add — `GET /scans/{id}/cleanup-summary` endpoint |
| 16 | F37 | `frontend/src/api/types.ts` | Add — `CleanupSummaryResponse` interface |
| 17 | F37 | `frontend/src/api/client.ts` | Add — `getScanCleanupSummary` method |
| 18 | F37 | `frontend/src/components/dashboard/CleanupGoalsCard.tsx` | Create — new component |
| 19 | F37 | `frontend/src/pages/Dashboard.tsx` | Edit — add cleanup goals state + fetch + render |
| 20 | F37 | `frontend/src/App.css` | Add — `.cleanup-goals-card`, `.cleanup-goal-*` |
| 21 | — | `docs/features.md` | Mark F32–F37 as `[x]` |
| 22 | — | `docs/CurrentProgress.md` | Mark F32–F37 as `[x]` |

---

## Key Design Decisions

1. **F32 — No backend changes:** The chart uses existing `GET /scans` data. All completed scans are charted. The chart is filtered to show only completed scans (running/pending excluded).

2. **F33 — No backend changes:** Reuses `GET /scans/{id}/files` with `sort=size&order=desc&page_size=10`. Keeps the backend surface area small.

3. **F34 — Python aggregation:** Instead of complex SQL `regexp_replace` for directory extraction, fetch paths + sizes and aggregate in Python with `Path(file).parent`. Simpler, portable, and debuggable. Trade-off: memory for scans with 100k+ files (~10 MB for paths + sizes). Acceptable for v1.

4. **F36 — Inline comparison vs. dedicated page:** Inline keeps navigation simple. The comparison table appears below the scan list when activated. A dedicated `/compare` route is deferred unless the page becomes unwieldy.

5. **F37 — Aggregated endpoint vs. multiple API calls:** The `GET /scans/{id}/cleanup-summary` endpoint makes 4 simple aggregate queries and returns a lightweight response. This is better than making 3-4 separate API calls from the frontend. The large-file threshold is hardcoded at 10 MB for v1; can be made configurable later.

6. **Dashboard layout decisions:** The Dashboard currently renders sections vertically (stat cards → extensions → ...). For F32-F37, maintain vertical stacking to keep the layout simple and responsive. A multi-column layout (chart left + widgets right) is a visual polish item for F44.

7. **Recharts library already available:** `recharts` is in `frontend/package.json` as a production dependency. No install needed.

8. **No new npm dependencies needed:** All F32-F37 features use existing dependencies (`recharts`, `react`, `react-router-dom`).

---

## Edge Cases Summary

| Edge Case | Where | Handling |
|---|---|---|
| No completed scans exist | F32, F33, F34, F37 | Sections absent (chart, files, folders, goals all conditional) |
| Scan with 0 files | F33, F34 | Largest files/folders sections absent |
| Single completed scan | F32 | One bar in chart |
| 20+ scans | F32 | All bars shown; x-axis labels may overlap (accept for v1) |
| All files in root (no subdirs) | F34 | One folder entry for root |
| Files at root of scan path | F34 | `Path(full_path).parent` gives root itself |
| Deep nested paths | F34, F33 | Long paths truncated with ellipsis |
| Comparison of 2+ scans | F36 | Side-by-side table with N columns |
| Comparison of same-folder scans | F36 | "Same folder" badge shown |
| Very long folder paths in comparison | F36 | CSS truncation with ellipsis |
| No duplicates in scan | F37 | "No duplicates found" in cleanup goals |
| No large files in scan | F37 | "No large files" in cleanup goals |
| All files have extensions | F37 | "All files have extensions" in cleanup goals |
| Scan not completed | F37 | Endpoint returns `SCAN_NOT_COMPLETED` |
| Delete scan while on dashboard | F32-F37 | Next re-fetch (on mount or manual refresh) will update |

---

## Frontend State Management Notes

- All Dashboard sub-features (F32-F37) derive from `latestCompletedScan` (already computed from `allScans`)
- Data fetches for extensions, largest files, largest folders, and cleanup goals are independent — they run in parallel and fail independently
- Each section handles its own loading/error/empty states
- A single `useEffect` with `Promise.allSettled` could optimize the parallel fetches, but separate states are clearer and more maintainable for v1
- No global state management needed — component-local state is sufficient for dashboard widgets

---

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Test backend endpoints
# Test largest-folders endpoint
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/largest-folders?limit=5"
# -> Expect: list of folders sorted by total_size desc

# Test cleanup-summary endpoint
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/cleanup-summary"
# -> Expect: { duplicate_groups, duplicate_files, large_files_10mb_plus, files_without_extension }

# Edge: nonexistent scan
curl.exe http://127.0.0.1:8000/api/v1/scans/9999/largest-folders
# -> 404

# Edge: nonexistent scan
curl.exe http://127.0.0.1:8000/api/v1/scans/9999/cleanup-summary
# -> 404

# Frontend (Tauri dev)
cd frontend
npm run tauri dev
```

**Dashboard verification:**
1. **Load Dashboard with existing scans** — stat cards, overview chart, recent scans, extensions, largest files, largest folders, cleanup goals all render
2. **No scans** — only stat cards at zero show; all data-dependent sections absent
3. **Run a scan on a diverse folder** — after completion, navigate to Dashboard; all sections populated
4. **Chart** — hover shows tooltip with scan details; bars have rounded green/blue tops
5. **Largest Files** — top 10 files listed by size; paths truncated cleanly
6. **Largest Folders** — top 10 folders; sizes sorted descending; paths relative to scan root
7. **Cleanup Goals** — cards show duplicates, large files, extensionless files counts with progress bars
8. **ScansList comparison** — checkboxes visible; select 2+ → Compare button appears → side-by-side table renders → Close hides it

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/schemas/scan.py` | Add — `LargestFolderItem`, `LargestFoldersResponse`, `CleanupSummaryResponse` |
| `backend/app/api/scans.py` | Add — `GET /scans/{id}/largest-folders`, `GET /scans/{id}/cleanup-summary` |
| `frontend/src/api/types.ts` | Add — `LargestFolderItem`, `LargestFoldersResponse`, `CleanupSummaryResponse` |
| `frontend/src/api/client.ts` | Add — `getScanLargestFolders`, `getScanCleanupSummary` |
| `frontend/src/components/dashboard/OverviewChart.tsx` | Create — Recharts bar chart component |
| `frontend/src/components/dashboard/CleanupGoalsCard.tsx` | Create — cleanup goals widget |
| `frontend/src/pages/Dashboard.tsx` | Edit — add OverviewChart, largest files, largest folders, cleanup goals sections |
| `frontend/src/pages/ScansList.tsx` | Edit — add comparison checkboxes + comparison table |
| `frontend/src/App.css` | Add — styles for chart card, largest files, largest folders, comparison, cleanup goals |
| `docs/features.md` | Mark F32–F37 as `[x]` |
| `docs/CurrentProgress.md` | Mark F32–F37 as `[x]` |
