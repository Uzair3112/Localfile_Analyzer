# Plan: D — Duplicate File Selection & Deletion (F26)

**Status:** Not started
**Feature ID:** F26
**Pre-requisites:** F22–F25 complete (hashing, duplicate detection, duplicates API & view)
**Target:** Allow users to select duplicate files via checkboxes on the Duplicates page and delete them from disk with a single click, removing their DB records and updating the duplicate groups accordingly.

---

## Current State Summary

- `frontend/src/pages/Duplicates.tsx` — Fully functional group listing: groups displayed with headers, file tables showing name/path/size per file. No checkboxes or delete functionality exist.
- `backend/app/api/scans.py` — Has `GET /scans/{id}/duplicates` returning grouped duplicate data. No delete endpoint for individual files.
- `backend/app/schemas/scan.py` — `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse` exist. No delete request/response schemas.
- `backend/app/models/scanned_file.py` — `ScannedFile` model with `id`, `full_path`, `scan_id` columns and FK to `scans`.
- `backend/app/models/duplicate.py` — `Duplicate` model with `file1_id`, `file2_id` referencing `scanned_files`.
- `frontend/src/api/client.ts` — Has `getScanDuplicates()`. No delete method.
- `frontend/src/api/types.ts` — Has `DuplicateFileInfo`, `DuplicateGroup`, `DuplicateListResponse`. No delete response types.

---

## F26 — Duplicate File Selection & Deletion

### Objective

Users can check individual files within duplicate groups on the Duplicates page, click a "Delete Selected" button, and the selected files are:
1. Deleted from the filesystem (moved to Recycle Bin or permanently deleted)
2. Removed from the `scanned_files` table (cascade deletes corresponding `duplicates` rows)
3. The Duplicates page refreshes to reflect the new state (groups may shrink or disappear)

### Implementation Steps

#### 26.1 Add delete schemas — `backend/app/schemas/scan.py`

Append to the existing file:

```python
class DuplicateFileDeleteRequest(BaseModel):
    file_ids: list[int]  # scanned_file IDs to delete


class DeletedFileInfo(BaseModel):
    id: int
    filename: str
    full_path: str
    success: bool
    error: Optional[str] = None


class DuplicateDeleteResponse(BaseModel):
    deleted: list[DeletedFileInfo]
    failed: list[DeletedFileInfo]
    total_deleted: int
    total_failed: int
```

Design notes:
- `file_ids` is a flat list of `scanned_files.id` values, not grouped — the frontend collects selected checkboxes into a single list and sends them all at once
- The response separates successful and failed deletions so the frontend can show per-file error messages (e.g., "permission denied", "file not found")

#### 26.2 Add delete endpoint — `backend/app/api/scans.py`

Add a new handler before the `GET /{scan_id}/duplicates` endpoint:

```python
@router.post("/{scan_id}/duplicates/delete")
async def delete_duplicate_files(
    scan_id: int,
    body: DuplicateFileDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    # Verify scan exists and is completed
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    if scan.status != ScanStatus.completed:
        return _error_response("SCAN_NOT_COMPLETED", "Can only delete files from completed scans")

    if not body.file_ids:
        return _error_response("EMPTY_REQUEST", "No file IDs provided")

    # Fetch the scanned_file rows
    result = await db.execute(
        select(ScannedFile).where(
            ScannedFile.id.in_(body.file_ids),
            ScannedFile.scan_id == scan_id,
        )
    )
    files_to_delete = result.scalars().all()

    if not files_to_delete:
        return _error_response("FILES_NOT_FOUND", "None of the provided file IDs were found in this scan")

    # Track results
    deleted_results: list[DeletedFileInfo] = []
    failed_results: list[DeletedFileInfo] = []
    successfully_deleted_ids: list[int] = []

    for sf in files_to_delete:
        try:
            os.remove(sf.full_path)
            deleted_results.append(DeletedFileInfo(
                id=sf.id,
                filename=sf.filename,
                full_path=sf.full_path,
                success=True,
            ))
            successfully_deleted_ids.append(sf.id)
        except FileNotFoundError:
            # File already gone from disk — still remove from DB
            deleted_results.append(DeletedFileInfo(
                id=sf.id,
                filename=sf.filename,
                full_path=sf.full_path,
                success=True,
                error="File was already deleted from disk",
            ))
            successfully_deleted_ids.append(sf.id)
        except OSError as exc:
            failed_results.append(DeletedFileInfo(
                id=sf.id,
                filename=sf.filename,
                full_path=sf.full_path,
                success=False,
                error=str(exc),
            ))

    # Remove DB records for successfully deleted files
    if successfully_deleted_ids:
        # Delete scanned_file rows (cascade will handle duplicate rows)
        await db.execute(
            delete(ScannedFile).where(ScannedFile.id.in_(successfully_deleted_ids))
        )

        # Also explicitly clean up any orphaned duplicate rows that reference
        # these files (in case cascade doesn't cover both file1_id and file2_id)
        await db.execute(
            delete(Duplicate).where(
                Duplicate.scan_id == scan_id,
                or_(
                    Duplicate.file1_id.in_(successfully_deleted_ids),
                    Duplicate.file2_id.in_(successfully_deleted_ids),
                ),
            )
        )

        # Update scan totals
        deleted_size = sum(sf.size for sf in files_to_delete if sf.id in successfully_deleted_ids)
        scan.total_files = (scan.total_files or 0) - len(successfully_deleted_ids)
        scan.total_size = (scan.total_size or 0) - deleted_size

        await db.commit()

    return DuplicateDeleteResponse(
        deleted=deleted_results,
        failed=failed_results,
        total_deleted=len(deleted_results),
        total_failed=len(failed_results),
    )
```

Design notes:
- **Two-step deletion**: First deletes from disk, then removes DB records. If the disk deletion fails (permissions, locked file), the DB record is kept and an error is returned.
- **FileNotFoundError handling**: If a file was already manually deleted from disk, the DB record is still cleaned up — this is helpful for tidying up stale records.
- **Duplicate cleanup**: After removing `scanned_files` rows, the endpoint explicitly deletes any `duplicates` rows referencing those files. This is needed because the cascade is defined on `scan_id` (scan-level delete), not on individual file IDs. Without this, orphaned duplicate rows would cause foreign key errors.
- **Totals update**: `scan.total_files` and `scan.total_size` are decremented to reflect the removed data.
- **Transaction safety**: The entire DB operation is wrapped in a single transaction. If the commit fails, no changes are persisted. Disk deletions, however, are not transactional — a failed commit after some files were deleted from disk is an edge case handled by the frontend (it should refetch and retry).

#### 26.3 Add required imports — `backend/app/api/scans.py`

Add to the existing imports at the top:

```python
import os
from sqlalchemy import delete, or_
from app.schemas.scan import (
    # ... existing imports ...
    DuplicateFileDeleteRequest,
    DuplicateDeleteResponse,
    DeletedFileInfo,
)
```

#### 26.4 Add frontend API method — `frontend/src/api/client.ts`

Add inside the `api` object:

```typescript
deleteDuplicateFiles: (scanId: number, fileIds: number[]) =>
  request<DuplicateDeleteResponse>(`/scans/${scanId}/duplicates/delete`, {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  }),
```

#### 26.5 Add frontend types — `frontend/src/api/types.ts`

Append after `CleanupSummaryResponse`:

```typescript
export interface DeletedFileInfo {
  id: number;
  filename: string;
  full_path: string;
  success: boolean;
  error: string | null;
}

export interface DuplicateDeleteResponse {
  deleted: DeletedFileInfo[];
  failed: DeletedFileInfo[];
  total_deleted: number;
  total_failed: number;
}
```

#### 26.6 Update import in `frontend/src/api/client.ts`

Add `DuplicateDeleteResponse` to the import block:

```typescript
import type {
  // ... existing ...
  DuplicateDeleteResponse,
} from "./types";
```

#### 26.7 Rebuild Duplicates page with checkboxes & delete — `frontend/src/pages/Duplicates.tsx`

**State additions** (near the top of the component):

```typescript
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [deleting, setDeleting] = useState(false);
const [deleteResult, setDeleteResult] = useState<DuplicateDeleteResponse | null>(null);
const [showConfirm, setShowConfirm] = useState(false);
```

**Derived state:**

```typescript
const allFiles = useMemo(() => {
  if (!data) return [];
  return data.groups.flatMap((g) => g.files);
}, [data]);

const selectedCount = selectedIds.size;
```

**Handlers:**

```typescript
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
      // All succeeded — refetch to refresh the list
      setSelectedIds(new Set());
      fetchDuplicates(scanId);
    }
    // If some failed, keep selections so user can retry
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
```

**Confirmation dialog:**

Add a modal/overlay component (can be a simple conditional render):

```tsx
{showConfirm && (
  <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Delete {selectedCount} file{selectedCount !== 1 ? "s" : ""}?</h3>
      <p style={{ color: "var(--color-text-muted)", marginTop: 8, fontSize: 14 }}>
        This will permanently delete the selected files from your disk.
        This action cannot be undone.
      </p>
      <div className="modal-actions" style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
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
```

**Delete result banner:**

```tsx
{deleteResult && (
  <div className={`delete-result-banner ${deleteResult.total_failed === 0 ? "success" : "partial"}`} style={{ marginTop: 16, padding: "12px 16px", borderRadius: 8 }}>
    <strong>
      {deleteResult.total_deleted} file{deleteResult.total_deleted !== 1 ? "s" : ""} deleted
      {deleteResult.total_failed > 0 ? `, ${deleteResult.total_failed} failed` : ""}
    </strong>
    {deleteResult.failed.length > 0 && (
      <ul style={{ marginTop: 8, fontSize: 13 }}>
        {deleteResult.failed.map((f, i) => (
          <li key={i}>{f.filename}: {f.error}</li>
        ))}
      </ul>
    )}
  </div>
)}
```

**"Delete Selected" button** (above the stats or between stats and groups):

```tsx
{selectedCount > 0 && (
  <div className="delete-bar" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, padding: "12px 16px", background: "var(--color-danger-light)", borderRadius: 8 }}>
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
```

**"Select All" checkbox** (above the groups list, inside the header area):

```tsx
<label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", marginTop: 16 }}>
  <input
    type="checkbox"
    checked={allFiles.length > 0 && selectedIds.size === allFiles.length}
    indeterminate={selectedIds.size > 0 && selectedIds.size < allFiles.length}
    onChange={(e) => selectAll(e.target.checked)}
  />
  Select all ({allFiles.length} files)
</label>
```

**Checkbox column in file table** (add `<th>` and `<td>` for checkboxes):

Add a new `<th>` for the checkbox column before "Filename":

```tsx
<thead>
  <tr>
    <th style={{ width: 40 }}></th>
    <th>Filename</th>
    <th>Path</th>
    <th>Size</th>
  </tr>
</thead>
```

And add a checkbox `<td>` to each file row:

```tsx
{group.files.map((f) => (
  <tr key={f.id} className={`file-table-row ${selectedIds.has(f.id) ? "selected" : ""}`}>
    <td style={{ textAlign: "center" }}>
      <input
        type="checkbox"
        checked={selectedIds.has(f.id)}
        onChange={() => toggleFile(f.id)}
      />
    </td>
    <td className="file-table-filename">{f.filename}</td>
    <td style={{/* existing path styles */}}>
      {f.full_path}
    </td>
    <td>{formatBytes(f.size)}</td>
  </tr>
))}
```

**Group-level "select all in group" checkbox** (inside the group header):

Replace the `<h3>` with:

```tsx
<label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
  <input
    type="checkbox"
    checked={group.files.every((f) => selectedIds.has(f.id))}
    indeterminate={group.files.some((f) => selectedIds.has(f.id)) && !group.files.every((f) => selectedIds.has(f.id))}
    onChange={(e) => toggleGroup(group, e.target.checked)}
  />
  <h3 style={{ fontSize: 16, fontWeight: 600 }}>Group {idx + 1}</h3>
</label>
```

**Disable delete button for single-file groups after file deletion** (edge case): If a group only has 2 files and 1 is deleted, the remaining file is no longer a duplicate. The refetch will naturally handle this — the group will disappear from the response.

#### 26.8 Add CSS styles — `frontend/src/App.css`

Append:

```css
/* Delete bar */
.delete-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--color-danger-light, #FBEAEA);
  border-radius: 8px;
}

.btn-danger {
  background: var(--color-danger, #E5484D);
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.btn-danger:hover { background: #C93A3E; }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-cancel {
  background: transparent;
  color: var(--color-text-primary, #1A1A1A);
  border: 1px solid #D1D5DB;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.btn-cancel:hover { background: #F3F4F6; }

/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

/* Delete result banner */
.delete-result-banner.success {
  background: var(--color-primary-light, #E6F4EC);
  color: var(--color-primary, #1F8A5A);
}
.delete-result-banner.partial {
  background: #FEF3C7;
  color: #92400E;
}

/* Selected row highlight */
.file-table-row.selected {
  background: #F0FDF4;
}

/* Indeterminate checkbox state — plain CSS fallback */
/* Browsers support :indeterminate on checkboxes via JS property */
```

#### 26.9 After-deletion UX flow

When the delete succeeds for all selected files:
1. The delete bar + success banner appear briefly
2. The page automatically refetches duplicates (`fetchDuplicates(scanId)`)
3. Groups that had all their files deleted disappear
4. Groups that had some files deleted shrink (fewer rows)
5. The "Select all" and delete bar reset

If some files fail to delete:
1. The partial-failure banner shows which files failed and why
2. Successful files are removed from the list
3. Failed files remain checked so the user can retry after fixing the issue (e.g., closing the file in another program)

#### 26.10 Acceptance Criteria for F26

- Each file row in every duplicate group shows a checkbox
- Checking a file checkbox visually highlights the row
- Group-level checkbox selects/deselects all files in that group
- "Select all" checkbox at the top selects/deselects all files across all groups
- With files checked, a "Delete Selected" bar appears showing the count
- Clicking "Delete Selected" opens a confirmation dialog describing the action
- Confirming deletes selected files from disk and removes their DB records
- After successful deletion, the groups list refreshes (some groups may shrink or disappear)
- If some files fail (permissions, locked), those remain checked with error messages displayed
- Deleting the last remaining copy of a duplicate group causes that group to disappear
- Cancelling the confirmation dialog does nothing
- Selecting 0 files hides the delete bar
- Works for a single file selected across multiple groups
- Works for all files selected

---

## Edge Cases & Design Decisions

### 1. Deleting files from different groups

The endpoint accepts a flat list of `file_ids` spanning multiple groups. This is handled naturally — each file is processed independently.

### 2. Race condition: file deleted externally between load and delete

`FileNotFoundError` is caught gracefully. The file is treated as "successfully deleted" (it's already gone) and its DB record is cleaned up.

### 3. What if every file in a group is deleted?

The group disappears from the next API response because the `duplicates` rows referencing those files are also deleted. The frontend refetch naturally handles this.

### 4. Disabled delete while scan is running

The endpoint checks `scan.status != ScanStatus.completed` and returns an error if the scan isn't finished. The frontend should not reach this state under normal conditions (the Duplicates page only shows data for completed scans).

### 5. Partial success / retry

Some files may fail to delete due to permissions or being open in another program. The frontend keeps those file IDs selected and shows error messages. The user can retry after addressing the issue.

### 6. Filesystem permissions

The backend runs under the system user's permissions. If it cannot delete a file (e.g., read-only, owned by another user, system file), the `OSError` is caught and reported per-file without aborting the entire batch.

### 7. No undo

File deletion is permanent. The confirmation dialog warns the user. No Recycle Bin integration in v1 (stretch goal).

---

## Combined Order of Implementation

| Step | File | Action |
|---|---|---|
| 1 | `backend/app/schemas/scan.py` | Add — `DuplicateFileDeleteRequest`, `DeletedFileInfo`, `DuplicateDeleteResponse` |
| 2 | `backend/app/api/scans.py` | Edit — add `import os`, `from sqlalchemy import delete, or_`, add new import for new schemas |
| 3 | `backend/app/api/scans.py` | Add — `POST /scans/{scan_id}/duplicates/delete` endpoint |
| 4 | `frontend/src/api/types.ts` | Add — `DeletedFileInfo`, `DuplicateDeleteResponse` interfaces |
| 5 | `frontend/src/api/client.ts` | Edit — update import, add `deleteDuplicateFiles()` method |
| 6 | `frontend/src/pages/Duplicates.tsx` | Edit — add checkboxes, selection state, delete bar, confirmation dialog, result banner, refetch logic |
| 7 | `frontend/src/App.css` | Edit — add modal, delete bar, danger button, selected row styles |
| 8 | `docs/features.md` | Mark F26 as `[x]` |
| 9 | `docs/CurrentProgress.md` | Mark F26 as `[x]` |

---

## Key Design Decisions

1. **Separate endpoint for file deletion** (`POST /scans/{id}/duplicates/delete`): Keeps the delete concern distinct from the `GET /scans/{id}/duplicates` read endpoint. Follows REST conventions.

2. **Per-file error isolation**: Each file deletion is wrapped in its own try/except. A single locked file does not prevent other selected files from being deleted. Errors are reported per-file in the response.

3. **Disk-first, then DB**: Files are deleted from disk before DB records are removed. If disk deletion fails, the DB record is preserved so the user can retry. This means disk I/O is not transactional with DB writes — a crash after disk delete but before DB commit would leave stale records. The frontend mitigates this by refetching after delete (orphaned records would still appear; the user could re-select and delete them, triggering another `FileNotFoundError` which is handled as a success).

4. **Confirmation dialog**: Prevents accidental mass deletion. The dialog shows the count of files to be deleted and warns that the action is permanent.

5. **Group-level select-all**: Provides a convenient way to select all copies of a duplicate group. Users typically want to keep one copy and delete the rest.

6. **Auto-refetch on full success**: After all selected files are deleted, the page automatically refetches to show the updated state (shrunken or removed groups).

---

## Verification End-to-End

### Backend (curl)

```powershell
# Start a scan on a test folder with duplicate files
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans `
  -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Temp/scan-test"}'

# Poll until completed, get scan_id (e.g., 1)
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# -> status: "completed"

# Check duplicates — note the file IDs
curl.exe http://127.0.0.1:8000/api/v1/scans/1/duplicates
# -> groups[].files[].id (e.g., file IDs 3, 4, 5)

# Delete a single file from a duplicate group
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/duplicates/delete `
  -H "Content-Type: application/json" `
  -d '{"file_ids": [3]}'
# -> {"deleted": [{"id": 3, "success": true}], "failed": [], "total_deleted": 1, "total_failed": 0}

# Verify the group shrank
curl.exe http://127.0.0.1:8000/api/v1/scans/1/duplicates
# -> The group should now have one fewer file

# Edge case: delete a file that doesn't exist on disk
# Manually delete a file, then try
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/duplicates/delete `
  -H "Content-Type: application/json" `
  -d '{"file_ids": [4]}'
# -> {"deleted": [{"id": 4, "success": true, "error": "File was already deleted from disk"}], ...}

# Edge case: empty file_ids list
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/1/duplicates/delete `
  -H "Content-Type: application/json" `
  -d '{"file_ids": []}'
# -> 422 with error code "EMPTY_REQUEST"

# Edge case: nonexistent scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans/999/duplicates/delete `
  -H "Content-Type: application/json" `
  -d '{"file_ids": [1]}'
# -> 404 SCAN_NOT_FOUND
```

### Frontend (Tauri dev)

```powershell
cd frontend
npm run tauri dev
```

1. Navigate to the Duplicates page (sidebar)
2. Verify each file row now has a checkbox in the first column
3. Check a single file — verify the row highlights and a "Delete Selected" bar appears with count "1 file selected"
4. Check additional files — verify count updates
5. Click the group-level checkbox — verify all files in that group are selected
6. Click "Select all" — verify all files across all groups are selected
7. Click "Delete Selected" — verify confirmation dialog appears with correct file count
8. Click "Keep Files" — verify dialog closes, nothing happens
9. Click "Delete Selected" → confirm — verify deletion proceeds
10. Verify success banner appears with "N files deleted"
11. Verify the page refreshes and groups are updated (files removed, groups may disappear)
12. **Edge case:** Open one of the duplicate files in a text editor to lock it, then try to delete it via the UI — verify error message shows for that file, other files still delete
13. **Edge case:** Delete all files from a group — verify the group disappears after refresh
14. **Edge case:** Delete all files across all groups — verify "No duplicate files" empty state appears

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/schemas/scan.py` | Add — `DuplicateFileDeleteRequest`, `DeletedFileInfo`, `DuplicateDeleteResponse` |
| `backend/app/api/scans.py` | Edit — add endpoint + imports |
| `frontend/src/api/types.ts` | Add — `DeletedFileInfo`, `DuplicateDeleteResponse` |
| `frontend/src/api/client.ts` | Edit — add `deleteDuplicateFiles()` + import |
| `frontend/src/pages/Duplicates.tsx` | Edit — add checkboxes, selection state, delete bar, confirmation, result banner, refetch |
| `frontend/src/App.css` | Edit — add modal, danger button, selected row, result banner styles |
| `docs/features.md` | Edit — mark F26 as `[x]` |
| `docs/CurrentProgress.md` | Edit — mark F26 as `[x]` |
