# Plan: I — Scan Cancellation (F45)

**Status:** Not started
**Feature ID:** F45
**Pre-requisites:** F01–F44 complete (full scanner engine, hashing, duplicates, dashboard, settings)
**PDD Reference:** §6 Scanner Module Design — "scanner checks a cancellation flag between batches"
**Target:** User can cancel a running scan mid-way. The scanner checks a cancellation flag between batches, stops cleanly, and the scan is marked `cancelled` with partial data preserved.

---

## Current State Summary

The scanner pipeline in `backend/app/scanner/runner.py` has two phases:

1. **Walk phase** (`_scan_folder_sync`, lines 78–135): A synchronous function running in a thread executor. It iterates `walk_folder()`, collects metadata, computes SHA-256 for duplicate candidates, and accumulates all file rows in memory. **No cancellation checks exist** — once started, it runs to completion regardless of how long it takes.
2. **Post-walk phase** (`run_scan`, lines 138–195): The async orchestrator. It flushes accumulated rows in batches, runs duplicate detection, and updates totals. This phase is fast but also has no cancellation support.

The `ScanStatus` enum (`backend/app/models/scan.py`) has four values: `pending`, `running`, `completed`, `failed` — **no `cancelled` status exists**.

There is no cancellation endpoint. `DELETE /scans/{id}` exists but only works on completed scans (the frontend disables the delete button while `status=running`).

The frontend polling hook (`useScanPolling`) polls until `completed` or `failed` — it has no concept of a `cancelled` terminal state.

---

## Design Approach

### Cancellation mechanism

Use an in-memory **`CancellationToken`** registry — a module-level `dict[int, threading.Event]` keyed by `scan_id`. This avoids DB round-trips for cancellation checks (too slow for the hot loop) and works across the thread executor boundary.

```
backend/app/scanner/cancellation.py          ← new module
  _cancelled: dict[int, threading.Event]      ← module-level registry

  def request_cancellation(scan_id: int)      ← sets the event
  def is_cancellation_requested(scan_id: int)  ← checks the event (thread-safe)
  def clear_cancellation(scan_id: int)         ← removes the event (cleanup)
```

### Where to check the flag

The cancellation flag must be checked at natural breaking points in the walk phase, NOT for every single file (to avoid the overhead of a dict lookup per file). Appropriate checkpoints:

1. **Between files in the walk loop** — lightweight check every N files (e.g., every 100 files, configurable). This catches mid-walk cancellations promptly without adding per-file overhead.
2. **After the walk phase completes but before batch inserts begin** — if cancelled during the walk, skip the post-walk phase entirely.
3. **Between batch inserts** — if cancellation was requested during the (fast) hash computation phase, catch it before starting DB writes.
4. **Before duplicate detection** — skip this expensive step if cancelled.

### Handling partial data

When a scan is cancelled:
- All files already walked and batch-inserted remain in `scanned_files` (partial data is valuable — the user may want to see what was found so far).
- Duplicate detection is **skipped** (not meaningful with partial data).
- The scan's `total_files`, `total_size`, `total_lines` reflect only what was processed before cancellation.
- Status is set to `cancelled`.

**Important:** The `_scan_folder_sync` function accumulates ALL rows in memory before returning. For a cancelled scan, we must still return the partial `rows` list (plus partial totals) so the post-walk phase can flush what was gathered. This means `_scan_folder_sync` needs to catch the cancellation and still return the accumulated data rather than raising an exception.

### API contract

Two options for the cancellation endpoint:

**Option A — dedicated endpoint (recommanded):**
```
POST /api/v1/scans/{scan_id}/cancel  →  202 Accepted
```
- Only works if `status == "running"`
- Sets the cancellation token for that scan
- Returns immediately (the scan may take a moment to notice and stop)
- Does NOT delete the scan — just marks it for cancellation

**Option B — repurpose DELETE:**
```
DELETE /api/v1/scans/{scan_id}
```
- If `status == "running"`, cancel instead of delete
- After cancellation, a second DELETE call removes the scan entirely

Option A is cleaner and follows REST semantics (separate action). Use Option A.

### Status enum addition

Add `cancelled` to `ScanStatus`:

```python
class ScanStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"    # ← new
```

The frontend should treat `cancelled` as a terminal state (stop polling), displayed as a distinct status pill (e.g., orange/grey).

---

## Implementation Steps

### Step 1 — Add `cancelled` to `ScanStatus` enum

**File:** `backend/app/models/scan.py`

- Add `cancelled = "cancelled"` to the `ScanStatus` enum (line 12, after `failed`)
- ⚠️ **Database migration required:** Since `ScanStatus` is a PostgreSQL ENUM, you must add the new value:
  1. Create a new Alembic migration: `cd backend && alembic revision --autogenerate -m "add cancelled scan status"`
  2. Review and edit the generated migration to use `ALTER TYPE scan_status ADD VALUE 'cancelled'`
  3. Apply: `alembic upgrade head`

```sql
-- Manual migration step (if autogenerate doesn't handle enum alteration):
ALTER TYPE scan_status ADD VALUE 'cancelled';
```

**Acceptance:**
- `ScanStatus.cancelled` exists and is importable
- Alembic migration applies cleanly
- Old scans with status `completed`/`failed` remain unchanged

---

### Step 2 — Create `cancellation.py` module

**File:** `backend/app/scanner/cancellation.py` (new)

```python
import threading

_cancelled: dict[int, threading.Event] = {}

def request_cancellation(scan_id: int) -> None:
    """Set the cancellation flag for a scan."""
    if scan_id not in _cancelled:
        _cancelled[scan_id] = threading.Event()
    _cancelled[scan_id].set()

def is_cancellation_requested(scan_id: int) -> bool:
    """Check whether cancellation has been requested (thread-safe)."""
    event = _cancelled.get(scan_id)
    return event is not None and event.is_set()

def clear_cancellation(scan_id: int) -> None:
    """Remove the cancellation flag (cleanup after scan terminates)."""
    _cancelled.pop(scan_id, None)
```

Design notes:
- `threading.Event` is thread-safe, so the synchronous walker (running in a thread pool) can safely check the flag set by the async API handler.
- Cleanup (`clear_cancellation`) is called in the `finally` block of `run_scan` to avoid memory leaks.
- No external dependencies.

**Acceptance:**
- `request_cancellation(1)` sets the flag
- `is_cancellation_requested(1)` returns `True` after request, `False` before
- `clear_cancellation(1)` removes the flag
- Thread safety verified (multiple threads can read/write without corruption)

---

### Step 3 — Inject cancellation checks into `_scan_folder_sync`

**File:** `backend/app/scanner/runner.py`

**3a.** Add import:
```python
from app.scanner.cancellation import is_cancellation_requested
```

**3b.** Add `_CANCEL_CHECK_INTERVAL = 100` constant (check every 100 files).

**3c.** Modify `_scan_folder_sync` to:
- Accept `cancelled_early` sentinel (or use a closure/parameter to return cancellation status). Simplest: use a `return` sentinel. Approach: return a tuple `(rows, file_count, size_acc, lines_acc, cancelled)` where `cancelled` is `bool`.
- After processing each file, increment a counter. Every `_CANCEL_CHECK_INTERVAL` files, check `is_cancellation_requested(scan_id)`.
- If cancelled: stop the walk loop, do NOT proceed to hash computation (candidate hashing is expensive and pointless for a cancelled scan), and return partial `rows`, `file_count`, `size_acc`, `lines_acc` with `cancelled=True`.

**Current signature:**
```python
def _scan_folder_sync(
    scan_id: int,
    folder_path: str,
    settings: dict,
) -> tuple[list[dict], int, int, int]:
```

**New signature:**
```python
def _scan_folder_sync(
    scan_id: int,
    folder_path: str,
    settings: dict,
) -> tuple[list[dict], int, int, int, bool]:
    # bool = was_cancelled
```

Changes inside the function:
1. After line 91 (`file_count += 1`), add:
   ```python
   if file_count % _CANCEL_CHECK_INTERVAL == 0:
       if is_cancellation_requested(scan_id):
           logger.info("Scan %s cancelled mid-walk after %d files", scan_id, file_count)
           # Skip hash computation, return partial data
           return rows, file_count, size_acc, lines_acc, True
   ```
2. Before line 121 (hash computation block), add an early check:
   ```python
   if is_cancellation_requested(scan_id):
       logger.info("Cancellation requested before hash pass for scan %s", scan_id)
       return rows, file_count, size_acc, lines_acc, True
   ```
3. At the bottom (after line 133), change the normal return:
   ```python
   return rows, file_count, size_acc, lines_acc, False
   ```

**Acceptance:**
- Walking a small folder without cancellation: returns `cancelled=False`, all files collected
- Walking a folder while cancellation is requested: walk stops within `_CANCEL_CHECK_INTERVAL` files, returns partial rows
- Partial rows contain valid metadata for files processed before cancellation
- Cancellation during hash computation (between walk and hash pass): caught by the pre-hash check

---

### Step 4 — Handle cancellation in `run_scan` orchestrator

**File:** `backend/app/scanner/runner.py`

**4a.** Add import:
```python
from app.scanner.cancellation import is_cancellation_requested, clear_cancellation
```

**4b.** Modify the call to `_scan_folder_sync` (line 157–159):

**Before:**
```python
rows, total_files, total_size, total_lines = await loop.run_in_executor(
    None, _scan_folder_sync, scan_id, scan.folder_path, settings,
)
```

**After:**
```python
rows, total_files, total_size, total_lines, was_cancelled = await loop.run_in_executor(
    None, _scan_folder_sync, scan_id, scan.folder_path, settings,
)
```

**4c.** After the sync phase (between line 159 and the batch-insert loop at line 161), add logic:

```python
if was_cancelled or is_cancellation_requested(scan_id):
    # Flush whatever partial data we have
    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i : i + BATCH_SIZE]
        await _flush_batch(session, chunk)

    scan.total_files = total_files
    scan.total_size = total_size
    scan.total_lines = total_lines
    scan.status = ScanStatus.cancelled
    scan.completed_at = datetime.now(timezone.utc)
    await session.commit()

    logger.info(
        "Scan %s cancelled: %d files processed, %d bytes, %d lines",
        scan_id, total_files, total_size, total_lines,
    )
    return
```

**4d.** Add `clear_cancellation(scan_id)` in the `finally` block (after line 195, before `await session.close()`):

```python
finally:
    clear_cancellation(scan_id)
    await session.close()
```

**Full new `run_scan` flow:**
1. Load scan, set status=running
2. Run `_scan_folder_sync` in executor → get partial data + cancelled flag
3. If cancelled: flush partial batches, mark cancelled, return
4. If not cancelled: flush all batches (existing logic)
5. Run duplicate detection (existing logic)
6. Mark completed (existing logic)
7. `finally`: clear cancellation token, close session

**Acceptance:**
- Normal scan (no cancellation): completes as before, no behavioural change
- Cancelled scan: partial rows are committed, status=cancelled
- Scans cancelled before any files are processed: status=cancelled, total_files=0
- Cancellation token is cleaned up in `finally`
- Duplicate detection is skipped for cancelled scans

---

### Step 5 — Add `POST /scans/{scan_id}/cancel` endpoint

**File:** `backend/app/api/scans.py`

**5a.** Add import:
```python
from app.scanner.cancellation import request_cancellation
```

**5b.** Add the endpoint (after `DELETE /scans/{scan_id}`, before file list endpoints):

```python
@router.post("/{scan_id}/cancel", status_code=202)
async def cancel_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    if scan.status != ScanStatus.running:
        return _error_response(
            "SCAN_NOT_RUNNING",
            f"Scan {scan_id} is {scan.status.value}, not running",
            status=409,
        )

    request_cancellation(scan_id)
    logger.info("Cancellation requested for scan %s", scan_id)
    return {"status": "cancellation_requested", "scan_id": scan_id}
```

**Acceptance:**
```powershell
# Start a scan on a large folder
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" -d '{"folder_path": "C:/Some/Large/Folder"}'

# Cancel it immediately
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/cancel
# -> 202, {"status": "cancellation_requested", "scan_id": 1}

# Poll until cancelled
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# -> Eventually status: "cancelled" with partial totals

# Try cancelling a completed scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/cancel
# -> 409, SCAN_NOT_RUNNING

# Try cancelling a non-existent scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/999/cancel
# -> 404, SCAN_NOT_FOUND
```

---

### Step 6 — Update frontend `api/client.ts`

**File:** `frontend/src/api/client.ts`

Add `cancelScan` method after `deleteScan` (around line 55):

```typescript
cancelScan: (scanId: number) =>
  request<{ status: string; scan_id: number }>(`/scans/${scanId}/cancel`, {
    method: "POST",
  }),
```

---

### Step 7 — Update frontend `types.ts`

**File:** `frontend/src/api/types.ts`

Add `"cancelled"` to the `ScanStatus` union type (line 6):

```typescript
export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
```

---

### Step 8 — Update frontend `useScanPolling.ts`

**File:** `frontend/src/hooks/useScanPolling.ts`

Add `"cancelled"` to the terminal status check (line 25):

**Before:**
```typescript
if (data.status === "completed" || data.status === "failed") {
```

**After:**
```typescript
if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
```

---

### Step 9 — Add Cancel button to `ScanDetail.tsx`

**File:** `frontend/src/pages/ScanDetail.tsx`

Add a "Cancel Scan" button visible only when `scan.status === "running"`. Place it next to the "Delete Scan" button.

**9a.** Add imports:
```typescript
import { api } from "../api/client";
```

**9b.** Add state variables near the existing delete/cancel states (around line 27):
```typescript
const [cancelling, setCancelling] = useState(false);
const [cancelError, setCancelError] = useState<string | null>(null);
```

**9c.** Add a `handleCancel` function:
```typescript
const handleCancel = async () => {
  if (!id) return;
  setCancelling(true);
  setCancelError(null);
  try {
    await api.cancelScan(id);
    // Polling hook will pick up the "cancelled" status
  } catch (err) {
    setCancelError(err instanceof Error ? err.message : "Failed to cancel scan");
  } finally {
    setCancelling(false);
  }
};
```

**9d.** Add the Cancel button in the action bar (around line 246, before the Delete button):

```tsx
{scan.status === "running" && (
  <button
    className="btn-warning"
    onClick={handleCancel}
    disabled={cancelling}
  >
    {cancelling ? "Cancelling..." : "Cancel Scan"}
  </button>
)}
```

Style: `btn-warning` should use an amber/orange color (e.g., `#E68A2E`) — distinct from the green primary and red danger buttons.

**9e.** Show `cancelError` if present (next to `deleteError`, around line 235):
```tsx
{cancelError && (
  <div className="scan-error-message" style={{ marginTop: 12 }}>{cancelError}</div>
)}
```

**9f.** Update status pill rendering (around line 168–173) to show `cancelled`:
```tsx
{scan.status === "cancelled" && "● Cancelled"}
```

Status badge CSS class: `cancelled` → use a neutral/grey color (e.g., `#6B7280`).

**9g.** Optionally adjust the delete button's `disabled` condition — it should be **enabled** for cancelled scans (user may want to delete a cancelled scan):
```tsx
disabled={deleting || scan.status === "running"}
```
(This is already correct — delete is disabled only while running.)

**9h.** Add CSS for the cancel button and cancelled status in `frontend/src/App.css`:
```css
.btn-warning {
  background: #F59E0B;
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.btn-warning:hover { background: #D97706; }
.btn-warning:disabled { opacity: 0.5; cursor: not-allowed; }

.scan-status-badge.cancelled {
  color: #6B7280;
}
```

---

### Step 10 — Update `GET /scans/{scan_id}` to include partial data for cancelled scans

**File:** `backend/app/api/scans.py`

No changes needed. The existing `_scan_to_response` already returns `total_files`, `total_size`, `total_lines`, `status`, `error_message` — all of which are correctly set for cancelled scans by the updated `run_scan`.

The frontend will see `status: "cancelled"` with partial totals.

---

### Step 11 — Update `features.md` and `CurrentProgress.md`

**File:** `docs/features.md`

Mark F45 as `[x]`:
```markdown
- [x] **F45 — Scan cancellation**
```

**File:** `docs/CurrentProgress.md`

Update the "I. Stretch / Deferred" section:
```markdown
- `[x]` **F45** — Scan cancellation
```

---

## Edge Cases & Design Decisions

### 1. Cancellation during duplicate detection

The duplicate detection step (`_detect_and_persist_duplicates`) can be expensive for large scans (GROUP BY + ORDER BY on potentially hundreds of thousands of rows). However, it is already skipped for cancelled scans (Step 4), so this is not an issue.

If in the future we want to support cancellation during duplicate detection itself, we could add periodic `is_cancellation_requested` checks inside the duplicate detection loop (between group processing). This is a future optimisation.

### 2. Race condition: cancellation arrives before scan starts

A cancellation request may arrive between `POST /scans` (status=pending) and the background task picking it up. The cancel endpoint returns 409 (not running). Mitigation:
- The `run_scan` function should check for cancellation immediately after setting status=running, before entering the walk.
- This handles the common case where the user hits Cancel within 1–2 seconds of starting.

Add to `run_scan` (just after `scan.started_at` is set, around line 152):
```python
if is_cancellation_requested(scan_id):
    scan.status = ScanStatus.cancelled
    scan.completed_at = datetime.now(timezone.utc)
    await session.commit()
    logger.info("Scan %s cancelled before any files were processed", scan_id)
    return
```

### 3. Cancellation token memory leak

The `_cancelled` dict grows unbounded if scans are cancelled but `clear_cancellation` is never called. This is handled by the `finally` block in `run_scan`, which always runs. However, if the backend process crashes/restarts, the in-memory dict is lost anyway (which is fine — on restart, there are no running scans to cancel).

### 4. What if `_scan_folder_sync` never reaches a checkpoint?

For very small folders (< 100 files), the walk completes in a single batch — the checkpoint at file 100 is never reached. This is acceptable because:
- Small scans complete in milliseconds; cancellation is not a UX concern.
- If cancelled early, the pre-hash check after the walk loop catches it.
- The check at the start of `run_scan` also catches cancellations before the walk starts.

### 5. Idempotency

Calling `POST /scans/{id}/cancel` multiple times is safe — `threading.Event.set()` is idempotent. The second call returns 202 just like the first (or 409 if the scan already completed/cancelled). No harm done.

### 6. Cancel + Delete interaction

- While a scan is running and cancellation is requested: the cancel button sets the flag. The delete button is disabled (status=running).
- After cancellation takes effect (status=cancelled): the delete button becomes enabled, allowing the user to delete the cancelled scan and its partial data.

This is already handled by the existing `disabled={deleting || scan.status === "running"}` logic.

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F45 | `backend/app/models/scan.py` | Edit — add `cancelled` to `ScanStatus` enum |
| 2 | F45 | `backend/alembic/versions/` | Create — new migration to `ALTER TYPE scan_status ADD VALUE 'cancelled'` |
| 3 | F45 | `backend/app/scanner/cancellation.py` | Create — `CancellationToken` with `request`, `check`, `clear` |
| 4 | F45 | `backend/app/scanner/runner.py` | Edit — inject cancellation checks into `_scan_folder_sync` |
| 5 | F45 | `backend/app/scanner/runner.py` | Edit — handle cancellation in `run_scan` orchestrator; clear token in `finally` |
| 6 | F45 | `backend/app/api/scans.py` | Edit — add `POST /scans/{scan_id}/cancel` endpoint |
| 7 | F45 | `frontend/src/api/client.ts` | Edit — add `cancelScan()` method |
| 8 | F45 | `frontend/src/api/types.ts` | Edit — add `"cancelled"` to `ScanStatus` type |
| 9 | F45 | `frontend/src/hooks/useScanPolling.ts` | Edit — stop polling on `cancelled` status |
| 10 | F45 | `frontend/src/pages/ScanDetail.tsx` | Edit — add Cancel button, cancelled status pill, error state |
| 11 | F45 | `frontend/src/App.css` | Edit — add `.btn-warning` and `.scan-status-badge.cancelled` styles |
| 12 | F45 | `docs/features.md` | Edit — mark F45 `[x]` |
| 13 | F45 | `docs/CurrentProgress.md` | Edit — mark F45 `[x]` |

---

## Verification End-to-End

### Backend (curl)

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Test cancellation on a large folder
# Start a scan on a folder with 10k+ files (e.g. node_modules or a real project)
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans `
  -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Users/Some/Large/Folder"}'

# -> 202, scan_id=1, status=pending

# Wait 2 seconds, then cancel
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/cancel
# -> 202, {"status": "cancellation_requested", "scan_id": 1}

# Poll until terminal
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# -> status: "cancelled", partial total_files > 0

# Verify partial data in the DB
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/files?page=1&page_size=5"
# -> Returns some files (the ones processed before cancellation)

# Edge case: cancel a completed scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/cancel
# -> 409, SCAN_NOT_RUNNING

# Edge case: cancel non-existent scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/999/cancel
# -> 404, SCAN_NOT_FOUND
```

### Frontend (Tauri dev)

```powershell
cd frontend
npm run tauri dev
```

1. Click "New Scan" → pick a large folder → "Start Scan"
2. Scan detail page opens, polling starts, status shows "● Running"
3. **New:** "Cancel Scan" button appears (amber/orange, next to the (disabled) Delete button)
4. Click "Cancel Scan" → button shows "Cancelling..."
5. Within a few seconds, status changes to "● Cancelled" (grey pill)
6. Partial stats are visible (e.g., "1,234 files found before cancellation")
7. "Cancel Scan" button disappears (no longer running)
8. "Delete Scan" button becomes enabled → can delete the cancelled scan
9. **Edge case:** Start a scan, cancel it within 1 second → status goes directly to "cancelled" with 0 files (if cancellation beat the walker to its first checkpoint)

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/models/scan.py` | Edit — add `cancelled` enum value |
| `backend/alembic/versions/` | Create — migration for ENUM alteration |
| `backend/app/scanner/cancellation.py` | Create — cancellation token registry |
| `backend/app/scanner/runner.py` | Edit — inject cancellation checks + handling |
| `backend/app/api/scans.py` | Edit — add `POST /scans/{id}/cancel` |
| `frontend/src/api/client.ts` | Edit — add `cancelScan()` |
| `frontend/src/api/types.ts` | Edit — add `"cancelled"` to `ScanStatus` |
| `frontend/src/hooks/useScanPolling.ts` | Edit — treat `cancelled` as terminal |
| `frontend/src/pages/ScanDetail.tsx` | Edit — add Cancel button + status |
| `frontend/src/App.css` | Edit — add warning button + cancelled badge styles |
| `docs/features.md` | Edit — mark F45 `[x]` |
| `docs/CurrentProgress.md` | Edit — mark F45 `[x]` |
