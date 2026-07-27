# Plan: B — Scan Lifecycle (F09–F12)

**Status:** F09–F11 implemented in prior work · F12 not started
**Pre-requisites:** F06–F08 complete (folder picker, POST /scans, background runner)
**Docker:** Excluded — everything runs locally

---

## F09 — Scan Status Polling *(already implemented)*

### What was done

**Backend:**
- `GET /api/v1/scans/{scan_id}` in `backend/app/api/scans.py` — returns current scan status, progress, and totals

**Frontend:**
- `frontend/src/hooks/useScanPolling.ts` — polls `GET /scans/{id}` every 1.5s; stops on `completed`/`failed`
- Integrated in `ScanDetail.tsx` — shows live status badge and stats while polling

### Files

| File | What it does |
|---|---|
| `backend/app/api/scans.py` | `GET /scans/{scan_id}` returns full scan state |
| `frontend/src/hooks/useScanPolling.ts` | Polling hook, clears interval on terminal states |
| `frontend/src/pages/ScanDetail.tsx` | Uses hook, displays status badge + stats |

---

## F10 — Scan Completion & Totals *(already implemented)*

### What was done

**Backend:**
- `backend/app/scanner/runner.py` — `run_scan()` writes `total_files`, `total_size`, `total_lines`, `completed_at` to the `scans` row after the walk completes

**Frontend:**
- `ScanDetail.tsx` reads `scan.total_files`, `scan.total_size`, `scan.total_lines` and renders them with formatting

### Files

| File | What it does |
|---|---|
| `backend/app/scanner/runner.py` | Sets totals on the Scan ORM object, commits |
| `frontend/src/pages/ScanDetail.tsx` | Displays formatted totals in stat cards |

---

## F11 — Scan Failure Handling *(already implemented)*

### What was done

**Backend:**
- Per-file `try/except OSError` in `_walk_folder()` — unreadable/locked files are skipped, scan continues
- Global `try/except` in `run_scan()` — on any exception, sets `status=failed` with `error_message` on the Scan row

### Files

| File | What it does |
|---|---|
| `backend/app/scanner/runner.py` | Per-file error isolation + scan-level failure catch |
| `frontend/src/pages/ScanDetail.tsx` | Shows `error_message` in a red banner |

---

## F12 — Delete Scan *(not started)*

### Objective
Implement `DELETE /scans/{id}` on the backend and wire a delete button on the frontend so users can remove scans and all associated data.

### Implementation Steps

#### 12.1 Backend: `DELETE /api/v1/scans/{scan_id}`

Edit `backend/app/api/scans.py`:

```python
@router.delete("/{scan_id}")
async def delete_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
```

Logic:
1. Query `Scan` by id
2. If not found: return `_error_response("SCAN_NOT_FOUND", ..., 404)`
3. Delete the scan row — cascade deletes handle `scanned_files`, `todos`, `duplicates` automatically (FKs defined with `ON DELETE CASCADE` in the migration)
4. Commit
5. Return `{"status": "deleted", "scan_id": scan_id}`

#### 12.2 Frontend: Add delete button to `ScanDetail.tsx`

- Add a "Delete Scan" button (red/danger style) in the scan detail header
- Show a confirmation dialog before deleting (`window.confirm()` or a small inline confirmation)
- On confirm: call `api.deleteScan(scanId)`
- On success: navigate to `"/"` (Dashboard)
- On error: show error message

#### 12.3 Frontend: Add `deleteScan` to `api/client.ts`

```typescript
deleteScan: (scanId: number) =>
  request<{ status: string; scan_id: number }>(`/scans/${scanId}`, {
    method: "DELETE",
  }),
```

#### 12.4 Acceptance Criteria for F12

```powershell
# Create a scan first
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans -H "Content-Type: application/json" -d '{"folder_path": "C:/Users/Public"}'

# Delete it
curl.exe -X DELETE http://127.0.0.1:8000/api/v1/scans/1
# Expected: {"status": "deleted", "scan_id": 1}

# Verify it's gone
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# Expected: 404 {"error": {"code": "SCAN_NOT_FOUND", "message": "..."}}

# Verify cascading delete — no orphan rows in scanned_files, todos, duplicates
```

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F12 | `backend/app/api/scans.py` | Edit — add `DELETE /scans/{scan_id}` |
| 2 | F12 | `frontend/src/api/client.ts` | Edit — add `deleteScan()` |
| 3 | F12 | `frontend/src/pages/ScanDetail.tsx` | Edit — add delete button + confirmation + navigation |
| 4 | — | `docs/features.md` | After implementation, mark F12 `[x]` |
| 5 | — | `docs/CurrentProgress.md` | After implementation, mark F12 `[x]` |

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Frontend (Tauri dev)
cd frontend
npm run tauri dev
```

1. Run a scan (New Scan → pick folder → Start Scan)
2. Navigate to the scan detail page
3. Click "Delete Scan" — confirm dialog appears
4. Confirm — navigates back to Dashboard
5. Verify via curl that scan returns 404
