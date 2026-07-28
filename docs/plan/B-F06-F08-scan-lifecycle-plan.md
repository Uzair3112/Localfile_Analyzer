# Plan: B — Folder Selection & Scan Lifecycle (F06–F08)

**Status:** Not started
**Pre-requisites:** F01–F05 complete (backend scaffold, DB, Tauri shell, API client, dev docs)
**Docker:** Excluded — everything runs locally
**Target:** User can pick a folder via native OS dialog, start a scan, see it run and complete

---

## F06 — Native Folder Picker

### Objective
Wire the "New Scan" button in the TopBar to open the OS native folder-selection dialog (via Tauri's dialog plugin). The selected path is stored in frontend state and ready to send to the backend.

### Implementation Steps

#### 6.1 Install `@tauri-apps/plugin-dialog`

```powershell
cd frontend
npm install @tauri-apps/plugin-dialog
```

#### 6.2 Add the plugin to Tauri's cargo

Edit `frontend/src-tauri/Cargo.toml`: add `tauri-plugin-dialog = "2"` to `[dependencies]`.

#### 6.3 Register the plugin in `lib.rs`

Edit `frontend/src-tauri/src/lib.rs`: add `.plugin(tauri_plugin_dialog::init())` in the builder chain, alongside the existing `opener` and `shell` plugins.

#### 6.4 Create `useFolderPicker` hook

New file: `frontend/src/hooks/useFolderPicker.ts`

```typescript
// Uses @tauri-apps/plugin-dialog's open() with directory: true
// Returns { folderPath, pickFolder, loading, error }
// - pickFolder() calls the native dialog
// - If user selects a folder, sets folderPath to the selected path
// - If user cancels, does nothing (no error)
// - Handles Tauri API being unavailable (falls back gracefully in browser dev mode)
```

#### 6.5 Update `TopBar.tsx`

- Wire the "New Scan" button to call `pickFolder()` from the hook
- When a path is selected, open a confirmation dialog/modal (simple inline UI) showing the path and a "Start Scan" button
- Use a `NewScanDialog` component for this (inline state, not a new page):

**Create `frontend/src/components/scan/NewScanDialog.tsx`:**
- Props: `folderPath: string`, `onConfirm: () => void`, `onCancel: () => void`
- Displays the selected folder path
- "Start Scan" primary button (non-functional for now — F07 wires it)
- "Cancel" secondary button

#### 6.6 Acceptance Criteria for F06

- Clicking "New Scan" in the TopBar opens the native OS folder picker
- Selecting a folder shows a confirmation dialog with the path
- Cancelling the folder picker does nothing (no dialog)
- Cancelling the confirmation dialog returns to the previous state
- Works in `npm run tauri dev` (native window). In browser dev mode (`npm run dev`) gracefully logs a warning.

---

## F07 — Start Scan API

### Objective
Implement the backend `POST /scans` endpoint and the `GET /scans/{scan_id}` polling endpoint. The API creates a scan row and returns immediately; the actual scanning runs in a background task (F08).

### Implementation Steps

#### 7.1 Create Pydantic schemas

New directory: `backend/app/schemas/`

**`backend/app/schemas/__init__.py`** — exports all schemas.

**`backend/app/schemas/scan.py`:**

```python
# StartScanRequest
# - folder_path: str (required)
# - settings_override: dict | None (optional, overrides global defaults for this scan)

# ScanResponse — returned from POST /scans and GET /scans/{id}
# - scan_id: int
# - status: ScanStatus (pending/running/completed/failed)
# - folder_path: str
# - started_at: datetime | None
# - completed_at: datetime | None
# - total_files: int
# - total_size: int
# - total_lines: int
# - error_message: str | None

# ErrorResponse
# - error: { code: str, message: str }
```

Use `ScanStatus` enum from the ORM model (reuse it, don't redefine).

#### 7.2 Install `python-multipart` (if not in requirements)

Not needed since we use JSON body, not form data. Add `pathlib` if needed (stdlib).

Check `requirements.txt` — add `python-multipart` if missing (FastAPI needs it for form parsing; not strictly required here but good practice).

#### 7.3 Implement `POST /api/v1/scans`

Edit `backend/app/api/scans.py`:

```python
@router.post("", status_code=202)
async def create_scan(
    body: StartScanRequest,
    db: AsyncSession = Depends(get_db),
):
```

Logic:
1. Validate `folder_path`:
   - Must be an absolute path (reject relative)
   - Must exist on disk (`Path(folder_path).is_dir()`)
   - If invalid: return 422 with `INVALID_PATH` error
2. Load current global `scan_settings` (first row, or create defaults if none exist)
3. Merge with `settings_override` if provided
4. Create `Scan` row: `folder_path`, `status=pending`, `settings_snapshot=merged_settings`
5. Flush to get the `id`
6. Schedule background task: `BackgroundTask(run_scan, scan_id=scan.id, db_factory=async_session)`
   - Use FastAPI's `BackgroundTask` (import from `fastapi`)
   - Pass `async_session` (the sessionmaker, not a session) so the background task creates its own session
7. Return `ScanResponse` with `status=202`

#### 7.4 Implement `GET /api/v1/scans/{scan_id}`

Edit `backend/app/api/scans.py`:

```python
@router.get("/{scan_id}")
async def get_scan(scan_id: int, db: AsyncSession = Depends(get_db)):
```

Logic:
1. Query `Scan` by id
2. If not found: return 404 with `SCAN_NOT_FOUND` error
3. Return `ScanResponse`

#### 7.5 Implement `GET /api/v1/scans` (list, for future use but add now)

```python
@router.get("")
async def list_scans(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
```

Logic:
1. Query all scans ordered by `id` desc
2. Paginate with offset/limit
3. Return `{ scans: [...], total: int, page: int, page_size: int }`

#### 7.6 Acceptance Criteria for F07

```powershell
# Test with curl
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans ^
  -H "Content-Type: application/json" ^
  -d "{\"folder_path\": \"C:/Users\"}"

# Expected: 202, { scan_id: 1, status: "pending", folder_path: "C:/Users", ... }

# Test invalid path
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans ^
  -H "Content-Type: application/json" ^
  -d "{\"folder_path\": \"C:/nonexistent\"}"

# Expected: 422, { error: { code: "INVALID_PATH", message: "..." } }

# Poll scan status
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# Expected: 200, { scan_id: 1, status: "running" or "completed", ... }

# List scans
curl.exe http://127.0.0.1:8000/api/v1/scans
# Expected: 200, { scans: [...], total: 1, page: 1, page_size: 20 }
```

---

## F08 — Background Scan Execution

### Objective
Wire the `POST /scans` handler to schedule a background task that picks up the pending scan, sets it to `running`, performs a basic file walk to collect counts, and marks it `completed`/`failed`.

### Implementation Steps

#### 8.1 Implement `run_scan` in `backend/app/scanner/runner.py`

```python
import asyncio
from pathlib import Path
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from app.models.scan import Scan, ScanStatus

async def run_scan(scan_id: int, session_factory: async_sessionmaker[AsyncSession]):
    """
    Background task: walks the folder, counts files, updates scan status.
    F08 implements a basic walk with counts only.
    F13+ will replace this with the full scanner engine.
    """
```

Logic:
1. Open a new session from `session_factory`
2. Load the `Scan` row by id
3. Set `status = running`, `started_at = now`, flush
4. Walk the folder tree with `Path(folder_path).rglob("*")`:
   - Count files (filter out directories)
   - Sum total sizes
   - For text-like files: count lines (basic UTF-8 detection)
5. Update `Scan` row: `total_files`, `total_size`, `total_lines`, `status = completed`, `completed_at = now`
6. On any exception: set `status = failed`, `error_message = str(e)`
7. Commit and close session

**Important notes for F08 (simple walk, replaced later):**
- Do NOT try to hash files yet (F22)

- Do NOT batch-insert scanned_files rows yet (F21)
- Use a simple `for file in Path(folder).rglob("*")` loop
- Apply basic ignore rules inline:
  - Skip `.git` directory entirely
  - Skip hidden files/dirs (names starting with `.`) if `ignore_hidden` is set in settings_snapshot
  - Skip `node_modules` if `ignore_node_modules` is set
  - Skip files over `max_file_size`
- This is intentionally minimal — it proves the lifecycle works. The full scanner engine (Phase C) replaces this.

#### 8.2 Wire `run_scan` into `POST /scans`

Edit `backend/app/api/scans.py`:
- Import `BackgroundTasks` from `fastapi`
- Import `run_scan` from `app.scanner.runner`
- Add `background_tasks: BackgroundTasks` as a dependency
- After creating the scan, call `background_tasks.add_task(run_scan, scan_id=scan.id, session_factory=async_session)`

#### 8.3 Handle the `pick_dir` callable issue

`BackgroundTask` with `BackgroundTasks` from FastAPI has a limitation: it doesn't support `async def` tasks directly in all versions. Use `asyncio.create_task` or `BackgroundTask.add_task` properly.

Actually, FastAPI's `BackgroundTasks` does support async callables since Starlette 0.26+. We should verify and test. If there's an issue, we can use `asyncio.ensure_future` in the endpoint instead.

**Alternative (more reliable):** Use `asyncio.create_task` directly in the endpoint:

```python
@router.post("", status_code=202)
async def create_scan(body: ..., db: ...):
    # ... create scan row ...
    task = asyncio.create_task(run_scan(scan_id=scan.id, session_factory=async_session))
    # No await — fire and forget
    # Store task reference for possible cancellation (F48)
    return scan_response
```

This is more reliable for async background tasks. Document the trade-off.

#### 8.4 Acceptance Criteria for F08

```powershell
# Start a scan on a real folder
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" -d "{\"folder_path\": \"C:/Users/Public\"}"

# Poll until completed
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# -> Eventually status: "completed" with total_files > 0

# Verify DB has correct data
# scans table: status=completed, started_at/completed_at set, totals populated
```

---

## Frontend: Wiring F06 + F07 + F08 together

### Update `api/client.ts`

Add new API functions:

```typescript
export const api = {
  health: () => request<HealthResponse>("/health"),
  startScan: (folderPath: string, settingsOverride?: Partial<ScanSettings>) =>
    request<ScanResponse>("/scans", {
      method: "POST",
      body: JSON.stringify({ folder_path: folderPath, settings_override: settingsOverride }),
    }),
  getScan: (scanId: number) => request<ScanResponse>(`/scans/${scanId}`),
  listScans: (page?: number, pageSize?: number) =>
    request<ScansListResponse>(`/scans?page=${page || 1}&page_size=${pageSize || 20}`),
};
```

### Create `useScanPolling` hook

New file: `frontend/src/hooks/useScanPolling.ts` (as designed in PDD §5.1):

```typescript
// Polls GET /scans/{id} every 1.5s while status is "running"
// Stops on "completed" or "failed"
// Returns { scan, loading, error }
```

### Update `NewScanDialog.tsx`

- On "Start Scan" click: call `api.startScan(folderPath)`
- On success: navigate to `/scans` page showing the scan detail (or show confirmation + stay)
- On error: show error message

### Update `TopBar.tsx` (or `App.tsx`)

- Integrate `useFolderPicker` and `NewScanDialog` state
- When a folder is selected via the picker, show `NewScanDialog` as a modal/overlay

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F06 | `frontend/package.json` | Install `@tauri-apps/plugin-dialog` |
| 2 | F06 | `frontend/src-tauri/Cargo.toml` | Add `tauri-plugin-dialog = "2"` |
| 3 | F06 | `frontend/src-tauri/src/lib.rs` | Register dialog plugin |
| 4 | F06 | `frontend/src/hooks/useFolderPicker.ts` | Create — native folder picker hook |
| 5 | F06 | `frontend/src/components/scan/NewScanDialog.tsx` | Create — confirmation dialog |
| 6 | F06 | `frontend/src/components/layout/TopBar.tsx` | Edit — wire picker to "New Scan" button |
| 7 | F07 | `backend/app/schemas/__init__.py` | Create — schemas package |
| 8 | F07 | `backend/app/schemas/scan.py` | Create — Pydantic request/response models |
| 9 | F07 | `backend/app/api/scans.py` | Edit — implement POST /scans, GET /scans/{id}, GET /scans |
| 10 | F07 | `backend/app/api/router.py` | Edit — add scans prefix if needed (already included) |
| 11 | F08 | `backend/app/scanner/runner.py` | Edit — implement `run_scan` background task |
| 12 | F07+F08 | `frontend/src/api/client.ts` | Edit — add startScan, getScan, listScans |
| 13 | F07+F08 | `frontend/src/api/types.ts` | Edit — add ScanResponse, ScansListResponse types |
| 14 | F07+F08 | `frontend/src/hooks/useScanPolling.ts` | Create — polling hook |
| 15 | F07+F08 | `frontend/src/components/scan/NewScanDialog.tsx` | Edit — wire up Start Scan call |
| 16 | F07+F08 | `frontend/src/components/layout/TopBar.tsx` | Edit — integrate dialog + scan flow |

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Frontend (Tauri dev)
cd frontend
npm run tauri dev

# Or browser dev mode:
npm run dev
```

1. Click "New Scan" — native folder picker opens
2. Select a folder — confirmation dialog shows the path
3. Click "Start Scan" — POST /scans fires, backend returns 202
4. Frontend navigates to scan detail view or shows a progress state
5. Polling starts: GET /scans/{id} every 1.5s
6. Eventually status becomes "completed" with file counts
