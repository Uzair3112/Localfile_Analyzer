# Plan: D — Hashing & Duplicate Detection (F22–F25)

**Status:** Not started
**Pre-requisites:** F13–F21 complete (scanner engine walks folders, collects metadata, batch-inserts scanned_files rows)
**Target:** Compute SHA-256 hashes for duplicate candidate files, detect and persist duplicate groups, expose via API and a dedicated frontend view

---

## Current State Summary

- `backend/app/scanner/hasher.py` is an **empty stub** — no hashing logic exists
- `backend/app/scanner/runner.py` — `_scan_folder_sync` collects metadata, counts lines, but sets `sha256=None` on every row; hashing is never performed
- `backend/app/models/duplicate.py` — `Duplicate` model already exists with `scan_id`, `hash` (String(64)), `file1_id`, `file2_id` columns and FK relationships
- `backend/app/models/scanned_file.py` — `sha256` column (String(64), nullable, indexed) exists and is ready
- `backend/app/api/scans.py` — has `GET /scans/{id}/files` but **no `GET /scans/{id}/duplicates` endpoint**
- `frontend/src/api/client.ts` — **no `getScanDuplicates()` method**
- `frontend/src/api/types.ts` — `Duplicate` interface is already defined; needs a `DuplicateGroup` or `DuplicateListResponse` type
- `frontend/src/pages/Duplicates.tsx` — **placeholder** with just an `<h1>Duplicates</h1>`
- `frontend/src/App.tsx` — route `/duplicates` already wired to `Duplicates` page
- `frontend/src/components/layout/Sidebar.tsx` — "Duplicates" nav link already exists

---

## F22 — SHA-256 Hashing (Streamed)

### Objective
Compute file hashes using chunked/streamed reads so that files of any size are never fully loaded into memory. Store the hex digest in `scanned_files.sha256`.

### Implementation Steps

#### 22.1 Implement `backend/app/scanner/hasher.py`

Replace the empty stub with a single function:

```python
import hashlib

CHUNK_SIZE = 65536  # 64 KB

def compute_sha256(file_path: str) -> str:
    """
    Stream a file through SHA-256 in 64 KB chunks.
    Returns the hex digest string.
    """
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()
```

Design notes:
- 64 KB chunk size balances memory overhead vs. I/O call frequency on both HDD and SSD
- Uses `hashlib.sha256()` from the standard library — no extra dependencies
- No file-size guard: SHA-256 itself is cheap; the caller (F23) decides which files to hash
- Wrapped in `try/except OSError` by the caller so unreadable files are skipped with a log

#### 22.2 Acceptance Criteria for F22

- `compute_sha256` returns a 64-character hex string for any readable file
- Two identical files produce identical digests
- Two files differing by 1 byte produce different digests
- A 1 GB file does not cause memory to spike (streamed, not read into memory)
- Binary files (`.exe`, `.bin`, `.png`) hash correctly
- Unreadable/locked file raises `OSError` (handled by the caller)

---

## F23 — Size-Based Duplicate Candidate Grouping

### Objective
Avoid hashing every file in the scan. First pass: group files by exact byte size. Only files whose size appears at least twice become candidates for hashing. This is purely an optimisation — correctness is unchanged.

### Implementation Steps

#### 23.1 Modify `backend/app/scanner/runner.py`

The current `_scan_folder_sync` collects rows into a flat list. Change it to also track file paths grouped by size, then do a second pass over candidate files to compute hashes.

New flow inside `_scan_folder_sync`:

```
1. walk folder, collect rows + track size→[paths] mapping (in-memory dict)
2. identify candidate sizes (count > 1)
3. for each file that has a candidate size: compute sha256, set rows[i].sha256
4. return rows as before (now with sha256 populated for candidates)
```

Detailed code sketch:

```python
def _scan_folder_sync(
    scan_id: int,
    folder_path: str,
    settings: dict,
) -> tuple[list[dict], int, int, int]:
    rows = []
    file_count = 0
    size_acc = 0
    lines_acc = 0
    size_map: dict[int, list[int]] = {}  # size -> list of row indices

    for file_path, stat in walk_folder(folder_path, settings):
        idx = len(rows)
        file_count += 1
        size_acc += stat.st_size

        metadata = extract_file_metadata(file_path, stat)
        lc = None
        if is_text_file(file_path):
            lc = count_lines(file_path)
            if lc:
                lines_acc += lc

        rows.append({
            "scan_id": scan_id,
            "filename": metadata["filename"],
            "full_path": metadata["full_path"],
            "extension": metadata["extension"],
            "size": metadata["size"],
            "line_count": lc,
            "sha256": None,  # populated below
            "created_at": metadata["created_at"],
            "modified_at": metadata["modified_at"],
        })

        # Track by size for duplicate candidate grouping
        size = metadata["size"]
        if size not in size_map:
            size_map[size] = []
        size_map[size].append(idx)

    # Pass 2: hash only files whose size appears >= 2 times
    from app.scanner.hasher import compute_sha256
    import logging
    logger = logging.getLogger(__name__)

    candidate_sizes = {s for s, indices in size_map.items() if len(indices) >= 2}
    total_candidates = sum(len(size_map[s]) for s in candidate_sizes)

    if candidate_sizes:
        logger.info(
            "Computing SHA-256 for %d duplicate candidates across %d size groups",
            total_candidates, len(candidate_sizes),
        )

    for size in candidate_sizes:
        for idx in size_map[size]:
            full_path = rows[idx]["full_path"]
            try:
                rows[idx]["sha256"] = compute_sha256(full_path)
            except OSError as exc:
                logger.warning("Could not hash %s: %s", full_path, exc)

    return rows, file_count, size_acc, lines_acc
```

Key design decisions:
- **Row indices** are stored in `size_map` to avoid duplicating file paths in memory
- **Two passes within the sync function** — the walk yields rows and builds the size map simultaneously; then candidate hashing runs in a tight loop
- **`sha256` remains `None`** for non-candidate files (single-instance sizes); the column is nullable by design
- A log line reports how many candidates were found vs. total files — useful for understanding real-world efficiency

#### 23.2 Acceptance Criteria for F23

- Folder with 100 unique-sized files: `sha256` is `None` for all rows (zero hashing)
- Folder with a duplicate pair (same size, same content): both files get identical `sha256` values
- Folder with 2 equal-sized files that differ in content: hashes differ
- Log output shows candidate count (e.g. "Computing SHA-256 for 6 duplicate candidates across 2 size groups")
- Empty folder: no hashing attempted, no crash

---

## F24 — Duplicate Group Persistence

### Objective
After the scan walk + hashing completes, query the `scanned_files` table for hash collisions and insert rows into the `duplicates` table. This runs as a final step in the scan pipeline, after all file rows are committed.

### Implementation Steps

#### 24.1 Add duplicate-detection query + insert in `backend/app/scanner/runner.py`

After the batch-insert of scanned_files succeeds and before the scan is marked `completed`, run a detection query:

```python
async def _detect_and_persist_duplicates(
    session: AsyncSession,
    scan_id: int,
) -> int:
    """
    Find all hash collisions among scanned_files for this scan.
    Insert duplicate pairs into the duplicates table.
    Returns the number of duplicate pairs inserted.
    """
    from sqlalchemy import select, func, text
    from app.models.scanned_file import ScannedFile
    from app.models.duplicate import Duplicate
    import logging
    logger = logging.getLogger(__name__)

    # Find hashes that appear more than once (and are not null)
    subq = (
        select(ScannedFile.sha256)
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.sha256.isnot(None),
        )
        .group_by(ScannedFile.sha256)
        .having(func.count(ScannedFile.id) > 1)
        .subquery()
    )

    # Fetch all file rows whose hash is in the collision list
    result = await session.execute(
        select(ScannedFile)
        .where(
            ScannedFile.scan_id == scan_id,
            ScannedFile.sha256.in_(select(subq.c.sha256)),
        )
        .order_by(ScannedFile.sha256, ScannedFile.id)
    )
    candidates = result.scalars().all()

    # Group by hash and create pairs
    from collections import defaultdict
    groups: dict[str, list[ScannedFile]] = defaultdict(list)
    for sf in candidates:
        groups[sf.sha256].append(sf)

    pair_count = 0
    for file_hash, files in groups.items():
        # Create one row per unique pair within the group
        for i in range(len(files)):
            for j in range(i + 1, len(files)):
                dup = Duplicate(
                    scan_id=scan_id,
                    hash=file_hash,
                    file1_id=files[i].id,
                    file2_id=files[j].id,
                )
                session.add(dup)
                pair_count += 1

    if pair_count:
        await session.flush()
        logger.info(
            "Found %d duplicate groups, %d pairs total for scan %s",
            len(groups), pair_count, scan_id,
        )

    return pair_count
```

#### 24.2 Wire into `run_scan` pipeline

In `run_scan`, after the batch-insert loop and before the final commit that sets `status=completed`:

```python
# After batch flush of scanned_files rows
# ... existing commit for scanned_files ...

# Detect and persist duplicates
dup_count = await _detect_and_persist_duplicates(session, scan_id)

# Then update scan totals and mark completed
scan.total_files = total_files
scan.total_size = total_size
scan.total_lines = total_lines
scan.status = ScanStatus.completed
scan.completed_at = datetime.now(timezone.utc)
await session.commit()
```

The `_detect_and_persist_duplicates` call runs **after** the `scanned_files` rows are committed, so the query sees all files. The pairs-insert happens within the same transaction as the final scan-update commit — atomic.

**Important:** The `_detect_and_persist_duplicates` function must be called with a separate `await session.commit()` for the file inserts first (or use the existing flush pattern). The current `runner.py` accumulates all rows in memory, flushes them in the batch loop, then commits once at the end with totals. The duplicate detection query needs the committed rows to exist — so either:
- Flush the batches, then run `_detect_and_persist_duplicates`, then commit everything together (works because flush makes rows visible within the same transaction)
- Or break into two commit points

**Recommendation:** Keep a single commit at the end. The flushes in the batch loop already send data to the server; `session.flush()` makes rows visible within the current transaction. So `_detect_and_persist_duplicates` will see them.

#### 24.3 Acceptance Criteria for F24

- Scan with 3 identical files (same content): 3 duplicate rows inserted (pairs: f1-f2, f1-f3, f2-f3)
- Scan with 0 duplicate files: `duplicates` table has 0 rows for that scan_id
- Scan with 2 identical pairs (A=A, B=B, 4 files total): 2 duplicate rows inserted (one per pair)
- Deleting a scan (F12 cascade) removes all its duplicate rows
- `duplicates.hash` is exactly 64 characters (SHA-256 hex)

---

## F25 — Duplicates API & View

### Objective
Expose duplicate groups via `GET /scans/{id}/duplicates` and build a frontend Duplicates page that lists grouped duplicate files with file names, paths, and sizes.

### Implementation Steps

#### 25.1 Add Pydantic response schemas — `backend/app/schemas/scan.py`

Append to the existing file:

```python
class DuplicateFileInfo(BaseModel):
    id: int
    filename: str
    full_path: str
    extension: Optional[str] = None
    size: int

    model_config = {"from_attributes": True}


class DuplicateGroup(BaseModel):
    hash: str
    files: list[DuplicateFileInfo]
    total_savings: int  # sum of (n-1) * size — bytes that could be freed


class DuplicateListResponse(BaseModel):
    groups: list[DuplicateGroup]
    total_groups: int
    total_duplicates: int  # count of individual duplicate files (not pairs)
    total_wasted_bytes: int
```

The `total_savings` / `total_wasted_bytes` field gives the frontend a quick "cleanup potential" number — how much disk space is consumed by redundant copies.

#### 25.2 Add endpoint — `backend/app/api/scans.py`

Add a new handler in the existing `scans.py` router:

```python
@router.get("/{scan_id}/duplicates")
async def get_scan_duplicates(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    # Verify scan exists
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    if scan.status != ScanStatus.completed:
        return _error_response("SCAN_NOT_COMPLETED", "Duplicates are available only after scan completes")

    # Get unique hashes with count > 1
    from sqlalchemy import func
    from app.models.duplicate import Duplicate
    from app.models.scanned_file import ScannedFile

    # Find all distinct hashes with duplicates for this scan
    hash_subq = (
        select(Duplicate.hash)
        .where(Duplicate.scan_id == scan_id)
        .distinct()
        .subquery()
    )

    # Get all scanned_files that are part of a duplicate group
    dup_file_ids_subq = (
        select(Duplicate.file1_id)
        .where(Duplicate.scan_id == scan_id)
        .union(
            select(Duplicate.file2_id).where(Duplicate.scan_id == scan_id)
        )
        .subquery()
    )

    result = await db.execute(
        select(ScannedFile)
        .where(ScannedFile.id.in_(select(dup_file_ids_subq.c)))
        .order_by(ScannedFile.sha256, ScannedFile.full_path)
    )
    dup_files = result.scalars().all()

    # Group by hash
    from collections import OrderedDict
    groups_map: dict[str, list[ScannedFile]] = OrderedDict()
    for sf in dup_files:
        if sf.sha256 not in groups_map:
            groups_map[sf.sha256] = []
        groups_map[sf.sha256].append(sf)

    groups_list = []
    total_wasted = 0
    for file_hash, files in groups_map.items():
        if len(files) < 2:
            continue
        file_infos = [
            DuplicateFileInfo(
                id=f.id,
                filename=f.filename,
                full_path=f.full_path,
                extension=f.extension,
                size=f.size,
            )
            for f in files
        ]
        # Wasted = (count - 1) * size for each group (all copies beyond the first)
        wasted = (len(files) - 1) * files[0].size
        total_wasted += wasted
        groups_list.append(DuplicateGroup(
            hash=file_hash,
            files=file_infos,
            total_savings=wasted,
        ))

    # Count individual duplicate-file rows (not pairs)
    total_dup_files = sum(len(g.files) for g in groups_list)

    return DuplicateListResponse(
        groups=groups_list,
        total_groups=len(groups_list),
        total_duplicates=total_dup_files,
        total_wasted_bytes=total_wasted,
    )
```

Design notes:
- Returns files grouped by hash (all copies of the same content together)
- `total_wasted_bytes` = `sum((n-1) * file_size)` — how much space could be reclaimed by keeping one copy and deleting the rest
- Ordering: groups sorted by hash (stable); files within groups sorted by path (deterministic)
- Uses `Union` of `file1_id` and `file2_id` from the `duplicates` table to find all involved files

#### 25.3 Update `backend/app/schemas/scan.py` imports

Ensure the new classes are importable. The existing file already has `from __future__ import annotations` style — just append at the bottom.

#### 25.4 Add frontend API method — `frontend/src/api/client.ts`

Add to the `api` object:

```typescript
import type { DuplicateListResponse } from "./types";

// ... inside the api object:
getScanDuplicates: (scanId: number) =>
  request<DuplicateListResponse>(`/scans/${scanId}/duplicates`),
```

#### 25.5 Add TypeScript response type — `frontend/src/api/types.ts`

Replace the existing minimal `Duplicate` interface with expanded types:

```typescript
export interface DuplicateFileInfo {
  id: number;
  filename: string;
  full_path: string;
  extension: string | null;
  size: number;
}

export interface DuplicateGroup {
  hash: string;
  files: DuplicateFileInfo[];
  total_savings: number;
}

export interface DuplicateListResponse {
  groups: DuplicateGroup[];
  total_groups: number;
  total_duplicates: number;
  total_wasted_bytes: number;
}
```

Keep the old `Duplicate` interface as-is for backward compatibility (the model layer still uses it internally), or replace it if nothing else references it.

#### 25.6 Build Duplicates page — `frontend/src/pages/Duplicates.tsx`

Replace the placeholder with a full-page view:

```tsx
import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { DuplicateGroup, DuplicateListResponse } from "../api/types";

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

  // On mount, find the most recent completed scan
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
          {/* Summary bar */}
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

          {/* Duplicate groups */}
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
                        <td style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
```

Behavior:
- On mount, fetches the most recent completed scan (page=1, page_size=1, find first with status=completed)
- Loads duplicates for that scan
- Shows summary stat cards: groups, files, wasted space
- For each group: truncated hash header, file table with name/path/size
- Empty state messaging for no scans / no duplicates

#### 25.7 Update `frontend/src/api/client.ts` imports

Add `DuplicateListResponse` to the import line:

```typescript
import type {
  HealthResponse,
  ScanResponse,
  ScanListResponse,
  ScannedFileListResponse,
  DuplicateListResponse,
  SettingsResponse,
} from "./types";
```

#### 25.8 (Optional) Add scan selector to Duplicates page

For a better UX, add a dropdown to the Duplicates page that lets the user pick which completed scan to view duplicates for, rather than always showing the latest. This can be added as a stretch enhancement.

#### 25.9 Acceptance Criteria for F25

- `GET /scans/{id}/duplicates` returns groups grouped by hash with file details
- Response includes `total_groups`, `total_duplicates`, `total_wasted_bytes`
- For a scan with no duplicates: `{"groups": [], "total_groups": 0, "total_duplicates": 0, "total_wasted_bytes": 0}`
- For a running/pending scan: returns error `SCAN_NOT_COMPLETED`
- For a nonexistent scan: returns error `SCAN_NOT_FOUND`
- Frontend Duplicates page renders stat cards + group tables
- Frontend shows "No duplicates" message when none found
- Frontend handles loading and error states

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F22 | `backend/app/scanner/hasher.py` | Rewrite — `compute_sha256` with chunked streaming |
| 2 | F23 | `backend/app/scanner/runner.py` | Edit — `_scan_folder_sync`: add `size_map`, pass 2 hashing for candidates only |
| 3 | F24 | `backend/app/scanner/runner.py` | Add — `_detect_and_persist_duplicates` function |
| 4 | F24 | `backend/app/scanner/runner.py` | Edit — wire `_detect_and_persist_duplicates` call into `run_scan` after file insert |
| 5 | F25 | `backend/app/schemas/scan.py` | Add — `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse` schemas |
| 6 | F25 | `backend/app/api/scans.py` | Add — `GET /scans/{id}/duplicates` endpoint |
| 7 | F25 | `frontend/src/api/types.ts` | Add — `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse` interfaces |
| 8 | F25 | `frontend/src/api/client.ts` | Add — `getScanDuplicates` method, update imports |
| 9 | F25 | `frontend/src/pages/Duplicates.tsx` | Rewrite — full duplicate groups view with stats + tables |
| 10 | — | `docs/features.md` | Mark F22–F25 as `[x]` |
| 11 | — | `docs/CurrentProgress.md` | Mark F22–F25 as `[x]` |

---

## Key Design Decisions

1. **Streamed hashing (F22):** Uses 64 KB fixed chunks via `hashlib.sha256().update()` — no memory spike for large files. No external dependencies.

2. **Size pre-filter (F23):** Only files whose exact byte size appears at least twice get hashed. For a typical source-code folder, this means <5% of files are hashed. The in-memory `size_map` uses row indices (integers) rather than duplicating paths, keeping memory overhead negligible.

3. **Post-insert detection (F24):** Duplicate detection runs *after* all `scanned_files` rows are flushed to the DB. This lets us use SQL `GROUP BY` / `HAVING COUNT(*) > 1` to find colliding hashes, which is cleaner and more reliable than trying to detect groups in-process during the walk.

4. **Pairs-based storage:** The `duplicates` table stores one row per file pair (per PDD §4.2). For n copies of the same file, `n choose 2` rows are created. For n=3, that's 3 rows. This is acceptable for v1; a normalized `duplicate_groups` table is a future optimisation.

5. **Grouped API response:** The endpoint returns files grouped by hash, not raw pair rows. The frontend never sees the pair structure — it gets `{ hash, files: [...] }` which is directly renderable.

6. **Frontend auto-selects latest scan:** The Duplicates page finds the most recent completed scan on mount. This keeps the page functional without requiring the user to navigate from a specific scan. A scan selector dropdown can be added later if multiple-scan comparison is needed.

---

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Create test files
mkdir -p C:\Temp\scan-test
echo "hello world" > C:\Temp\scan-test\file1.txt
echo "hello world" > C:\Temp\scan-test\file2.txt   # duplicate of file1
echo "different content" > C:\Temp\scan-test\file3.txt
echo "hello world" > C:\Temp\scan-test\sub\file4.txt  # duplicate in subfolder

# Start scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans `
  -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Temp/scan-test"}'

# Poll until completed
curl.exe http://127.0.0.1:8000/api/v1/scans/1

# Check duplicates endpoint
curl.exe http://127.0.0.1:8000/api/v1/scans/1/duplicates
# -> Should return 1 group with 3 files (file1, file2, sub/file4), wasted = 2 * file_size

# Verify DB
# SELECT * FROM duplicates WHERE scan_id = 1;
# SELECT sf.filename, sf.sha256 FROM scanned_files sf WHERE sf.scan_id = 1;
```

**Browser test (Tauri dev):**
```powershell
cd frontend
npm run tauri dev
```

1. Run a scan via "New Scan" on a folder containing duplicate files
2. Wait for scan to complete
3. Click "Duplicates" in the sidebar
4. Verify: stat cards show group/file/waste counts
5. Verify: each group shows the hash, file list, and per-file paths
6. Verify: deleting the scan and revisiting Duplicates shows "No completed scans"
7. Run a scan with *no* duplicates — verify "No duplicate files found" message

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/scanner/hasher.py` | Rewrite (was empty stub) — `compute_sha256` streaming function |
| `backend/app/scanner/runner.py` | Edit — add size_map + candidate hashing in `_scan_folder_sync`; add `_detect_and_persist_duplicates`; wire into `run_scan` |
| `backend/app/schemas/scan.py` | Add — `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse` |
| `backend/app/api/scans.py` | Add — `GET /scans/{id}/duplicates` endpoint |
| `frontend/src/api/types.ts` | Add — `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse` interfaces |
| `frontend/src/api/client.ts` | Add — `getScanDuplicates` method + import |
| `frontend/src/pages/Duplicates.tsx` | Rewrite — from placeholder to full groups view |
| `docs/features.md` | Mark F22–F25 as `[x]` |
| `docs/CurrentProgress.md` | Mark F22–F25 as `[x]` |
