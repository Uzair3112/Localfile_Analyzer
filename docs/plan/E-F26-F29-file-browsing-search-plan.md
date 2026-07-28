# Plan: E — File Browsing & Search (F26–F29)

**Status:** F26 + F27 already implemented · F28 + F29 not started
**Pre-requisites:** F13–F25 complete (scanner engine, hashing, duplicates)
**Target:** File table with filtering/sorting/pagination on Scan Detail page; extension breakdown API + dashboard card
**Design reference:** PDD §2.4 (file list endpoint), PDD §5 (FileTable component), PRD §7.3 (dashboard right-side widgets — "Top Extensions")

---

## Current State Summary

**F26 (File List API)** — Fully implemented in `backend/app/api/scans.py:151-195`:
- `GET /scans/{scan_id}/files` with query params: `page`, `page_size`, `extension` (exact match), `search` (ILIKE on filename + full_path), `sort` (dynamic column), `order` (asc/desc)
- Returns paginated `ScannedFileListResponse` with `total` count
- Props to `getattr` for safe sort-column resolution; defaults to `filename`
- Schemas `ScannedFileResponse` and `ScannedFileListResponse` defined in `backend/app/schemas/scan.py:33-52`
- Frontend `api.getScanFiles()` in `frontend/src/api/client.ts:54-74` with full parameter support
- Frontend types `ScannedFile` and `ScannedFileListResponse` in `frontend/src/api/types.ts:27-45`

**F27 (File Table UI)** — Fully implemented inline in `frontend/src/pages/ScanDetail.tsx:261-365`:
- No standalone `FileTable.tsx` component — the table is embedded directly in the Scan Detail page
- **Search input** (line 281-288): text field filtering by filename/path, resets pagination to page 1
- **Extension filter dropdown** (line 271-280): select from a hardcoded list of 11 extensions
- **Sortable column headers** (line 306-321): click to toggle asc/desc; columns: Filename, Type, Size, Lines, Modified
- **Pagination controls** (line 339-361): Previous/Next buttons, "Page X of Y" display, disabled at bounds
- **Loading/empty/error states** (lines 292-299): "Loading files...", "No files match..." / "No files found...", error banner
- **`EXTENSIONS` list is hardcoded** on line 19: `[".py", ".js", ".ts", ".md", ".json", ".html", ".css", ".txt", ".yml", ".yaml", ".sh"]`
  - Should ideally be dynamic (derived from actual scan data), but hardcoded is acceptable for v1
- CSS styles in `App.css` (lines 406-499): `.file-table-wrapper`, `.file-table`, `.file-table-sortable`, `.file-table-row`, `.file-table-filename`, `.file-ext-badge`, `.file-table-null`, `.file-table-date`, `.file-table-filter`

**What both still need:**
- `docs/features.md` and `docs/CurrentProgress.md` still show F26 and F27 as `[ ]` — must be updated to `[x]`
- The hardcoded `EXTENSIONS` list in ScanDetail.tsx should be made dynamic (populated from the API response or a separate endpoint), though this is a polish item not a correctness issue

**F28 (Extension Breakdown API)** — Not implemented:
- No `GET /scans/{id}/extensions` endpoint exists
- No extension-related schemas in `backend/app/schemas/scan.py`
- No `getScanExtensions` method in `frontend/src/api/client.ts`
- No `ExtensionBreakdownResponse` type in `frontend/src/api/types.ts`

**F29 (Extension Breakdown UI)** — Not implemented:
- Dashboard (`frontend/src/pages/Dashboard.tsx`) has stat cards + recent scans table only
- No "Top Extensions" card
- No reference to extensions data anywhere in Dashboard

---

## F26 — File List API *(already implemented — document only)*

### What exists

| Aspect | Implementation |
|---|---|
| Endpoint | `GET /api/v1/scans/{scan_id}/files` in `backend/app/api/scans.py:151-195` |
| Route prefix | `/api/v1/scans` (router prefix) + `/{scan_id}/files` |
| Filtering | `extension` query param (exact match on `ScannedFile.extension`), `search` (ILIKE on `filename` + `full_path`) |
| Sorting | Dynamic: `sort` param resolved via `getattr(ScannedFile, sort, ScannedFile.filename)`, default `filename`; `order` = `asc`/`desc` |
| Pagination | `page` (default 1), `page_size` (default 50); returns `total` count |
| Scan validation | Returns `SCAN_NOT_FOUND` (404) if `scan_id` doesn't exist; no status check (works for any scan, not just completed) |
| Schema | `ScannedFileResponse` (id, scan_id, filename, full_path, extension, size, line_count, sha256, created_at, modified_at) + `ScannedFileListResponse` (files, total, page, page_size) |
| Frontend API | `api.getScanFiles(scanId, params)` in `client.ts:54-74` |
| Frontend types | `ScannedFile`, `ScannedFileListResponse` in `types.ts:27-45` |

### Files

| File | What it does |
|---|---|
| `backend/app/api/scans.py:151-195` | `GET /{scan_id}/files` handler |
| `backend/app/schemas/scan.py:33-52` | `ScannedFileResponse`, `ScannedFileListResponse` |
| `frontend/src/api/client.ts:54-74` | `getScanFiles()` method |
| `frontend/src/api/types.ts:27-45` | `ScannedFile`, `ScannedFileListResponse` interfaces |

---

## F27 — File Table UI *(already implemented — document only)*

### What exists

The file table is implemented inline in `frontend/src/pages/ScanDetail.tsx` (lines 261-365). It is **not extracted** as a reusable `FileTable.tsx` component, which is acceptable for v1 scope.

| Aspect | Implementation |
|---|---|
| Location | `ScanDetail.tsx:261-365` (conditional on `scan.status === "completed"`) |
| Search | `<input>` with placeholder "Search files...", controlled by `fileSearch` state, resets page to 1 on change |
| Extension filter | `<select>` with hardcoded `EXTENSIONS` list, controlled by `fileExt` state, resets page to 1 on change |
| Sort | Click column header → `handleSort(col)` → toggles asc/desc on same column, resets to asc on new column; visual indicator ` ▲` / ` ▼` |
| Pagination | Previous/Next buttons + "Page X of Y"; disabled at bounds; `PAGE_SIZE = 50` |
| Empty states | "No files match the current filters." (when filters active), "No files found in this scan." (when no filters) |
| Loading state | "Loading files..." placeholder |
| Error state | Red error banner from `scan-error-message` class |
| Data fetch | `fetchFiles` in `useCallback` triggered on `useEffect` when `[id, scan.status, filesPage, fileExt, fileSearch, fileSort, fileOrder]` change |

### Files

| File | What it does |
|---|---|
| `frontend/src/pages/ScanDetail.tsx` | File table + search/filter/sort/pagination inline |
| `frontend/src/App.css:406-499` | File table CSS styles |

---

## F28 — Extension Breakdown API

### Objective
Implement `GET /scans/{id}/extensions` that returns a breakdown of file counts, total size, and percentage of total for each file extension in the scan. This powers the "Top Extensions" card on the dashboard and can also be used in Scan Detail.

### Implementation Steps

#### 28.1 Add Pydantic response schemas — `backend/app/schemas/scan.py`

Append to the existing file:

```python
class ExtensionBreakdownItem(BaseModel):
    extension: str
    count: int
    total_size: int
    percentage: float  # 0.0–100.0, rounded to 2 decimal places

    model_config = {"from_attributes": True}


class ExtensionBreakdownResponse(BaseModel):
    extensions: list[ExtensionBreakdownItem]
    total_extensions: int
    total_files: int  # files with non-null extension
    files_without_extension: int  # files where extension is NULL
```

`percentage` is computed as `(count / total_files_with_extension) * 100`, rounded to 2 decimal places.

#### 28.2 Add endpoint — `backend/app/api/scans.py`

Add a new handler:

```python
@router.get("/{scan_id}/extensions")
async def get_scan_extensions(
    scan_id: int,
    limit: int = 15,
    db: AsyncSession = Depends(get_db),
):
```

Logic:
1. Verify scan exists → if not, `SCAN_NOT_FOUND` (404)
2. Query `scanned_files` for `scan_id`, grouped by `extension`:
   - `extension` (coalesce NULL to a sentinel like `"(none)"` for grouping, but report as null)
   - `COUNT(*)` as count
   - `SUM(size)` as total_size
   - Order by count DESC, then total_size DESC
3. Get total file count for the scan to compute percentages
4. Get count of files where `extension IS NULL`
5. Build `ExtensionBreakdownItem` list with computed percentages
6. Apply `limit` param (default 15) — return top N extensions; the rest are not included in the response but `total_extensions` reflects the full count

**SQLAlchemy query sketch:**

```python
from sqlalchemy import func, case, literal_column

# Total files in scan
total_result = await db.execute(
    select(func.count(ScannedFile.id))
    .where(ScannedFile.scan_id == scan_id)
)
total_files = total_result.scalar() or 0

# Files WITHOUT extension
null_ext_result = await db.execute(
    select(func.count(ScannedFile.id))
    .where(
        ScannedFile.scan_id == scan_id,
        ScannedFile.extension.is_(None),
    )
)
files_without_ext = null_ext_result.scalar() or 0

# Files WITH extension
files_with_ext = total_files - files_without_ext

# Grouped breakdown
grouped_query = (
    select(
        ScannedFile.extension,
        func.count(ScannedFile.id).label("count"),
        func.sum(ScannedFile.size).label("total_size"),
    )
    .where(
        ScannedFile.scan_id == scan_id,
        ScannedFile.extension.isnot(None),
    )
    .group_by(ScannedFile.extension)
    .order_by(func.count(ScannedFile.id).desc(), func.sum(ScannedFile.size).desc())
    .limit(limit)
)
```

Edge case handling:
- If `total_files == 0`: return empty extensions list, `total_extensions=0`, `total_files=0`, `files_without_extension=0`
- If `files_with_ext == 0`: return empty extensions list, `total_extensions=0`, `total_files=total_files`, `files_without_extension=total_files`
- Percentage = 0 when files_with_ext == 0 (avoid division by zero)
- `limit` cap at a maximum (e.g. 100) to prevent abuse

#### 28.3 Add frontend API method — `frontend/src/api/client.ts`

```typescript
getScanExtensions: (scanId: number, limit?: number) =>
  request<ExtensionBreakdownResponse>(
    `/scans/${scanId}/extensions${limit ? `?limit=${limit}` : ""}`,
  ),
```

#### 28.4 Add TypeScript response type — `frontend/src/api/types.ts`

```typescript
export interface ExtensionBreakdownItem {
  extension: string;
  count: number;
  total_size: number;
  percentage: number;
}

export interface ExtensionBreakdownResponse {
  extensions: ExtensionBreakdownItem[];
  total_extensions: number;
  total_files: number;
  files_without_extension: number;
}
```

#### 28.5 Acceptance Criteria for F28

```powershell
# Create test folder with known extensions
mkdir -p C:\Temp\ext-test
"print(1)" > C:\Temp\ext-test\a.py
"print(2)" > C:\Temp\ext-test\b.py
"const x = 1" > C:\Temp\ext-test\c.js
"# readme" > C:\Temp\ext-test\README  # no extension
"hello" > C:\Temp\ext-test\d.py

# Start scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Temp/ext-test"}'

# Poll until completed, then:
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/extensions?limit=10"
# Expected: 2 extensions: `.py` (count=3, size=~9), `.js` (count=1, size=~11)
# total_extensions: 2, total_files: 4, files_without_extension: 1
# percentages: .py ≈ 75.0%, .js ≈ 25.0%

# Edge: nonexistent scan → 404
curl.exe http://127.0.0.1:8000/api/v1/scans/9999/extensions
# Expected: 404 SCAN_NOT_FOUND

# Edge: empty folder scan → empty extensions, total_files=0
```

**Additional edge case tests:**
- Scan with 100% null extensions (e.g. all files named `Makefile`, `README`, `.env` without dot-suffix): `extensions=[]`, `total_extensions=0`, `files_without_extension=N`
- Scan with a single extension type: one entry with `percentage=100.0`
- Scan with many extension types: only top `limit` are returned; `total_extensions` reflects total distinct extensions regardless of limit
- Percentage rounding: e.g. 2 out of 3 files → `66.67%`, 1 out of 3 → `33.33%`, sum should equal 100.0 (may be 99.99 or 100.01 due to rounding — acceptable)

---

## F29 — Extension Breakdown UI

### Objective
Add a "Top Extensions" card to the Dashboard, styled per the wallet-card reference pattern from the PRD (PRD §7.1: "Right-side widgets: 'My Wallet'-style cards become Top Extensions"). The card shows the most common file extensions from the most recent completed scan, with file counts, sizes, and visual progress bars.

### Implementation Steps

#### 29.1 Fetch extensions data on Dashboard mount

Edit `frontend/src/pages/Dashboard.tsx`:

1. Add state for extensions: `const [extensions, setExtensions] = useState<ExtensionBreakdownItem[] | null>(null);`
2. Add loading/error states for extensions data
3. After loading the scans list (existing `useEffect`), find the most recent completed scan
4. If a completed scan exists, call `api.getScanExtensions(latestCompletedScanId, 8)` to get the top 8 extensions
5. Store the result in state

**Data flow logic:**
```
On Dashboard mount:
  ├── Fetch scans list (existing)
  ├── Pick most recent `status=completed` scan
  │     ├── If found → fetch GET /scans/{id}/extensions?limit=8
  │     └── If not found → setExtensions(null) (no data to show)
  └── Render extensions card (or empty state)
```

**Key considerations:**
- If the scans list is still loading, extensions should also show loading
- If the scans list loads but no completed scan exists, extensions section shows "Run a scan first"
- If extensions API call fails, extensions section shows an error state (but shouldn't crash the whole dashboard)
- When a new scan completes while on the dashboard, extensions should refresh (could re-fetch on a timer or when `allScans` changes and contains a new completed scan)
- Stale data: if the user runs a scan and returns to dashboard, the data should reflect the latest scan

#### 29.2 Build the "Top Extensions" card UI

Add a new card section in the Dashboard rendering (after the Recent Scans table or as a right-side widget):

**Layout sketch:**

```tsx
{/* Top Extensions Card */}
{extensionsData && (
  <div style={{ marginTop: 32 }}>
    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Top Extensions</h2>
    <div className="extensions-card">
      {extensionsData.extensions.slice(0, 8).map((ext) => (
        <div key={ext.extension} className="extension-row">
          <div className="extension-header">
            <span className="extension-name">.{ext.extension}</span>
            <span className="extension-count">{formatNumber(ext.count)} files</span>
            <span className="extension-size">{formatBytes(ext.total_size)}</span>
          </div>
          <div className="extension-bar-track">
            <div
              className="extension-bar-fill"
              style={{ width: `${ext.percentage}%` }}
            />
          </div>
          <span className="extension-pct">{ext.percentage.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  </div>
)}
```

**CSS classes to add in `App.css`:**

```css
.extensions-card {
  background: var(--color-card);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.extension-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}
.extension-row:last-child {
  border-bottom: none;
}

.extension-name {
  font-weight: 600;
  font-family: monospace;
  font-size: 14px;
  min-width: 60px;
  color: var(--color-text-primary);
}

.extension-count {
  font-size: 13px;
  color: var(--color-text-muted);
  min-width: 80px;
}

.extension-size {
  font-size: 13px;
  color: var(--color-text-muted);
  min-width: 80px;
  text-align: right;
}

.extension-bar-track {
  flex: 1;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
  min-width: 80px;
}

.extension-bar-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.extension-pct {
  font-size: 12px;
  color: var(--color-text-muted);
  min-width: 45px;
  text-align: right;
}
```

The design mirrors the wallet-card pattern from the PRD reference:
- Each extension is a horizontal row like a "currency balance"
- A progress bar (like a balance meter) shows relative proportion
- Count and size are displayed like balance amounts
- Monospace font for extension names for visual clarity

#### 29.3 Handle all states

| State | Behaviour |
|---|---|
| **Loading** | Show a skeleton/shimmer or "Loading extensions..." text — should NOT block the rest of the dashboard from rendering |
| **No completed scans** | Show nothing (extensions section is absent) or a subtle "Run a scan to see extension breakdown" message |
| **No extensions data** (scan empty) | Show "No files found" inside the card |
| **All files have no extension** | Show "No extensions detected" in the card |
| **API error** | Show a small error text inside the card area, don't crash the page |
| **Single extension** | One row at 100% — bar fills fully |
| **Many extensions** | Limited to `limit=8` (top 8) — the API already handles this |

#### 29.4 Update imports in `Dashboard.tsx`

Add to the top:
```typescript
import type { ExtensionBreakdownResponse, ExtensionBreakdownItem } from "../api/types";
```

Add `ExtensionBreakdownResponse` to the API client import type list.

#### 29.5 Wire extensions data refresh

Since the Dashboard fetches scans on mount, and extensions depend on the latest completed scan, the extensions fetch should be in the same `useEffect` or a separate one triggered when `allScans` changes:

```typescript
// After the existing allScans effect
const latestCompleted = useMemo(() => {
  return allScans
    .filter(s => s.status === "completed")
    .sort((a, b) => b.scan_id - a.scan_id)[0] ?? null;
}, [allScans]);

useEffect(() => {
  if (!latestCompleted) {
    setExtensions(null);
    return;
  }
  api.getScanExtensions(latestCompleted.scan_id, 8)
    .then(setExtensions)
    .catch(() => setExtensions(null));  // silently fail for extensions
}, [latestCompleted?.scan_id]);
```

Silent failure is acceptable because the extensions card is supplementary content — the dashboard should still render without it.

#### 29.6 Acceptance Criteria for F29

```powershell
# In Tauri dev / browser dev mode
cd frontend
npm run dev
```

1. **Dashboard loads** — stat cards + recent scans table render (existing)
2. **If no completed scan exists** — extensions card is absent or shows "Run a scan first"
3. **Run a scan** on a folder with mixed file types (`.py`, `.js`, `.md`, `.txt`, etc.)
4. **Navigate to Dashboard** — extensions card appears at the bottom or right section
5. **Verify card content:**
   - Shows extension names (e.g. `.py`, `.js`, `.md`)
   - Shows file counts per extension
   - Shows total size per extension
   - Shows percentage progress bars proportional to counts
   - Most common extension is first, with the widest bar
6. **Empty folder scan** — card shows "No files found" or equivalent empty state
7. **Single extension scan** — one row at 100%, bar is full width
8. **API failure** — card silently disappears or shows error (dashboard remains functional)
9. **Responsive** — card doesn't overflow; bars scale appropriately

---

## Key Design Decisions

1. **F26/F27 already done:** No modifications needed. Only mark as complete in tracking documents.

2. **Dynamic vs static EXTENSIONS list (F27):** The current `EXTENSIONS` list in `ScanDetail.tsx:19` is hardcoded. Improving it to be dynamic (e.g. fetched from the extensions endpoint or derived from the file list response) is a polish item tracked as a follow-up, not a blocker for F27 sign-off.

3. **Percentage calculation (F28):** Percentage is computed relative to files that HAVE an extension, not total files. This means `files_without_extension` are excluded from the denominator. Rationale: a folder with 90 extensionless files + 10 `.py` files should show `.py` at 100%, not 10%. The `files_without_extension` field lets the UI show "N files without extension" as a separate note.

4. **Limit on extensions endpoint (F28):** Default `limit=15` prevents massive responses for folders with dozens of unique extensions (e.g. a polyglot project with 40+ file types). The `total_extensions` field still reports the true count.

5. **Extensions card on Dashboard (F29):** Uses the most recent completed scan. This avoids the complexity of picking which scan to show. If the user wants per-scan extension data, they can visit Scan Detail (a future enhancement could add an extensions breakdown there too). For v1, the dashboard shows a snapshot.

6. **One-way dependency only:** The dashboard does not block rendering on extensions data. If the extensions fetch fails or is slow, the rest of the dashboard (stats, recent scans) renders immediately. The extensions card appears when data is ready or shows nothing on failure.

7. **No refactor of FileTable into a component:** The inline file table in ScanDetail.tsx works correctly. Extracting it would be a pure refactor with no functional change. Deferred unless there's a demonstrated need (e.g. file table needed on another page).

---

## Edge Cases Summary

| Edge Case | Where | Handling |
|---|---|---|
| Scan ID doesn't exist | F28 endpoint | 404 `SCAN_NOT_FOUND` |
| Empty scan (0 files) | F28 endpoint | `extensions=[]`, `total_files=0`, `files_without_extension=0` |
| All files are extensionless | F28 endpoint | `extensions=[]`, `total_files=N`, `files_without_extension=N` |
| Division by zero (0 files with ext) | F28 percentage calc | Check `files_with_ext > 0` before computing percentage |
| Very large `limit` param | F28 endpoint | Cap at 100 to prevent abuse; let the validator handle it or apply min/max |
| Rounding errors in percentages | F28 response | Round to 2 decimal places; sum may be 99.99-100.01 — acceptable |
| No completed scan exists | F29 Dashboard | Extensions card absent or shows guidance message |
| Extensions API fails | F29 Dashboard | Silently hide extensions area; dashboard still works |
| Scan completes while on Dashboard | F29 refresh | Extensions re-fetch when `allScans` state updates via existing polling or manual refresh |
| Very long extension names | F29 UI | CSS `overflow: hidden` + `text-overflow: ellipsis` on extension name |
| Multiple scans, which one to show | F29 data source | Latest completed by `scan_id` descending; stable and deterministic |

---

## Production Readiness Notes

- **Database query performance:** The `GROUP BY extension` query on `scanned_files` is covered by the existing index `idx_scanned_files_extension` on the `extension` column (PDD §4.1). For scans with 100k+ files, this query will be fast (index-only scan).
- **No N+1 queries:** The extensions endpoint makes exactly 3 queries (total count, null-ext count, grouped breakdown) regardless of the number of extensions.
- **Frontend rendering:** 8-15 extension rows is trivial for React to render. No virtualization needed.
- **Memory:** The response payload is small (max ~15 items, each with 4 fields). No streaming or pagination needed for extensions.

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F28 | `backend/app/schemas/scan.py` | Add — `ExtensionBreakdownItem`, `ExtensionBreakdownResponse` schemas |
| 2 | F28 | `backend/app/api/scans.py` | Add — `GET /scans/{id}/extensions` endpoint with group-by query |
| 3 | F28 | `frontend/src/api/types.ts` | Add — `ExtensionBreakdownItem`, `ExtensionBreakdownResponse` interfaces |
| 4 | F28 | `frontend/src/api/client.ts` | Add — `getScanExtensions` method, update imports |
| 5 | F29 | `frontend/src/pages/Dashboard.tsx` | Edit — add extensions fetch + "Top Extensions" card UI |
| 6 | F29 | `frontend/src/App.css` | Add — CSS classes for extensions card, rows, bars |
| 7 | F29 | `frontend/src/api/types.ts` | Edit — import `ExtensionBreakdownResponse` in Dashboard (already added in step 3) |
| 8 | — | `docs/features.md` | Mark F26–F29 as `[x]` |
| 9 | — | `docs/CurrentProgress.md` | Mark F26–F29 as `[x]` |

---

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Test extensions API
# Create a test folder with mixed extensions
mkdir -p C:\Temp\ext-e2e
"print(1)" > C:\Temp\ext-e2e\a.py
"print(2)" > C:\Temp\ext-e2e\b.py
"const x = 1" > C:\Temp\ext-e2e\c.js
"# hello" > C:\Temp\ext-e2e\d.md
"<h1>Hi</h1>" > C:\Temp\ext-e2e\e.html
"body { }" > C:\Temp\ext-e2e\f.css
".env key=val" > C:\Temp\ext-e2e\.env       # hidden file, may be ignored
"#!/bin/bash" > C:\Temp\ext-e2e\g.sh
"NMakefile" > C:\Temp\ext-e2e\Makefile      # no extension

# Start scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Temp/ext-e2e", "settings_override": {"ignore_hidden": false}}'

# Poll until completed
curl.exe http://127.0.0.1:8000/api/v1/scans/1

# Test extensions endpoint
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/extensions"
# -> Expect: 6 extensions (if .env is included), or 5 (if .env is hidden)
# -> Each has: extension, count, total_size, percentage
# -> total_extensions matches count, total_files includes Makefile
# -> files_without_extension = 1 (Makefile)

# Test edge: nonexistent scan
curl.exe http://127.0.0.1:8000/api/v1/scans/9999/extensions
# -> 404: {"error": {"code": "SCAN_NOT_FOUND", ...}}

# Test edge: empty folder
mkdir -p C:\Temp\empty-folder
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Temp/empty-folder"}'
# Poll, then check extensions
curl.exe http://127.0.0.1:8000/api/v1/scans/2/extensions
# -> {"extensions": [], "total_extensions": 0, "total_files": 0, "files_without_extension": 0}

# Browser test (Tauri dev)
cd frontend
npm run tauri dev
```

1. **Dashboard loads** — verify existing stat cards + recent scans table render
2. **If no completed scan** — no extensions card visible (or guidance text)
3. **Run a scan** via "New Scan" on a folder with mixed file types
4. **Navigate to Dashboard** (or it auto-refreshes):
   - Extensions card renders with progress bars, counts, sizes
   - Most common extension is first
   - Click scan ID → Scan Detail page shows file table with search/filter/sort/pagination
5. **Run a scan on an empty folder** — extensions card shows empty state
6. **Delete the scan** — extensions card disappears on Dashboard refresh

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/schemas/scan.py` | Add — `ExtensionBreakdownItem`, `ExtensionBreakdownResponse` |
| `backend/app/api/scans.py` | Add — `GET /scans/{id}/extensions` endpoint |
| `frontend/src/api/types.ts` | Add — `ExtensionBreakdownItem`, `ExtensionBreakdownResponse` |
| `frontend/src/api/client.ts` | Add — `getScanExtensions` method + import |
| `frontend/src/pages/Dashboard.tsx` | Edit — add extensions fetch + "Top Extensions" card |
| `frontend/src/App.css` | Add — extensions card/row/bar CSS classes |
| `docs/features.md` | Mark F26–F29 `[x]` |
| `docs/CurrentProgress.md` | Mark F26–F29 `[x]` |