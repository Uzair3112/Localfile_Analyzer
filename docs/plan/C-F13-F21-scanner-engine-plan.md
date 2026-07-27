# Plan: C — Recursive Scanner Engine (F13–F21)

**Status:** Not started
**Pre-requisites:** F01–F12 complete (backend scaffold, DB, Tauri shell, API client, scan lifecycle)
**Docker:** Excluded — everything runs locally
**Target:** Full scanner engine that walks folders, applies all ignore rules, collects metadata, detects text files, counts lines, and batch-writes scanned file rows to the database

---

## Current State Summary

The existing `runner.py` has a monolithic `_walk_folder()` function that:
- Walks the directory tree with `Path.rglob("*")`
- Applies basic ignore rules (hidden, node_modules, max_file_size) inline
- Counts total files, total size, total lines
- Calls `_is_text_file()` and `_count_lines()` inline (helper functions in the same file)
- Updates `scans` table totals only — **never inserts `scanned_files` rows**

The dedicated modules (`walker.py`, `line_counter.py`, `hasher.py`, `todo_finder.py`) are all empty stubs.

**What needs to change:** Refactor the monolithic walk into the modular architecture described in PDD §6, with each module doing one job. The central change is that the walker must now produce `ScannedFile` records (not just counts), and those records must be batch-inserted into PostgreSQL.

---

## F13 — Recursive Directory Walker

### Objective
Extract the directory-traversal logic from `runner.py` into a dedicated `walker.py` module. The walker yields file entries one at a time, applying ignore rules at descend-time (not post-hoc). The caller is responsible for consuming the yielded entries.

### Implementation Steps

#### 13.1 Rewrite `backend/app/scanner/walker.py`

Replace the empty stub with a `walk_folder` generator function:

```python
import os
from pathlib import Path
from typing import Generator

from app.scanner.ignore_rules import should_ignore_path, load_ignore_patterns

WalkResult = tuple[Path, os.stat_result]  # (full_path, stat)

def walk_folder(folder_path: str, settings: dict) -> Generator[WalkResult, None, None]:
    """
    Recursively walk folder_path, yielding (path, stat) for each file that
    passes all ignore rules. Rules are applied at directory-descent time so
    excluded trees are never walked into.
    """
```

Logic:
1. Resolve `folder_path` to absolute `Path`
2. Normalise `max_file_size` from settings (default 50 MB)
3. Use `os.scandir()` / manual recursion (not `rglob`) to support descend-time filtering:
   - For each entry: if it's a directory, check ignore rules *before recursing*
   - If the directory matches an ignore rule (e.g. `.git`, `node_modules`), skip the entire subtree
   - If it's a file, check ignore rules on the path; if it passes, yield `(entry.path, entry.stat())`
4. Yield only regular files (`entry.is_file()` or `stat.st_mode` check)
5. Wrap individual entry access in `try/except OSError` so unreadable entries are skipped

**Why not `rglob`:**
`rglob` does not allow descend-time filtering — it traverses everything and filters after. For large `node_modules` trees, this is wasteful. Using `os.scandir` + manual recursion lets us skip whole subtrees.

**Sketch of the recursive walk:**

```python
def _walk_recursive(dir_path: Path, root: Path, settings: dict) -> Generator[WalkResult, None, None]:
    max_size = settings.get("max_file_size", 52428800)
    try:
        with os.scandir(dir_path) as it:
            for entry in it:
                try:
                    rel_path = Path(entry.path).relative_to(root)
                except ValueError:
                    continue

                if entry.is_dir(follow_symlinks=False):
                    if should_ignore_path(rel_path, settings, is_dir=True):
                        continue
                    yield from _walk_recursive(Path(entry.path), root, settings)

                elif entry.is_file(follow_symlinks=False):
                    if should_ignore_path(rel_path, settings, is_dir=False):
                        continue
                    stat = entry.stat()
                    if max_size > 0 and stat.st_size > max_size:
                        continue
                    yield (Path(entry.path), stat)
    except (PermissionError, OSError):
        pass  # skip unreadable directories
```

#### 13.2 Update `runner.py` to use the new walker

Replace the monolithic `_walk_folder()` with a new `run_scan` that uses `walk_folder` from `walker.py`:

```python
from app.scanner.walker import walk_folder

async def run_scan(scan_id: int, session_factory):
    ...
    settings = scan.settings_snapshot or {}
    files_batch = []

    for file_path, stat in walk_folder(scan.folder_path, settings):
        # F13: collect file metadata (detailed in F18)
        # F21: accumulate and batch-insert
        ...
```

For F13 alone, keep it simple: iterate the walker, count files and accumulate size (same as the current `_walk_folder`). The full metadata collection (F18), line counting (F20), and batch writes (F21) come in later steps.

#### 13.3 Create `backend/app/scanner/ignore_rules.py`

Extract ignore-rule logic into its own module (shared by walker and other scanner modules):

```python
import fnmatch
from pathlib import Path

def should_ignore_path(
    rel_path: Path,
    settings: dict,
    is_dir: bool = False,
) -> bool:
    """
    Check whether a relative path should be ignored.
    rel_path is relative to the scan root.
    """
    parts = rel_path.parts
    ignore_hidden = settings.get("ignore_hidden", True)
    ignore_node_modules = settings.get("ignore_node_modules", True)
    custom_globs = settings.get("custom_ignore_globs", [])

    # Check each path component for hidden / node_modules
    for part in parts:
        if ignore_hidden and part.startswith("."):
            return True
        if ignore_node_modules and part == "node_modules":
            return True

    # Custom glob patterns (F17)
    if custom_globs:
        str_path = str(rel_path).replace("\\", "/")
        for pattern in custom_globs:
            if fnmatch.fnmatch(str_path, pattern):
                return True
            # Also match the basename
            if fnmatch.fnmatch(rel_path.name, pattern):
                return True

    return False
```

#### 13.4 Remove the old `_should_ignore`, `_walk_folder` from `runner.py`

After the refactor, `runner.py` should no longer define `_should_ignore`, `_walk_folder`, `_count_lines`, or `_is_text_file`. It becomes a pure orchestrator.

#### 13.5 Acceptance Criteria for F13

- Walk into a folder with `.git` subdirectory: `.git` contents are not iterated (not even counted)
- Walk into a folder with `node_modules`: entire subtree is skipped
- Walk into a folder with a permission-denied subdirectory: walk continues, error logged
- Walker yields correct count of files matching a manual `dir /s` / `ls -R` count
- Existing backend tests pass (if any) or manual curl walk produces same file counts as before

---

## F14 — Ignore Rules: Hidden Files

### Objective
Ensure files and directories whose name starts with `.` (dotfiles) are excluded from the walk when `ignore_hidden` is `true`.

### Implementation Steps

#### 14.1 Already partially done

The `should_ignore_path` function in `ignore_rules.py` (created in F13) already handles hidden files. This feature ensures it's:
- Applied at directory-descent time (so `.git/objects` is never entered)
- Controlled by the `ignore_hidden` setting (default `true`)
- Tested with both `true` and `false` values

#### 14.2 Verify setting propagation

The `settings_snapshot` on each `Scan` row already stores `ignore_hidden` (set up in F07). Confirm that:
- `POST /scans` with `settings_override: { "ignore_hidden": false }` is merged correctly
- `POST /scans` with no override uses the global default (`true`)
- The walker reads the value from `settings["ignore_hidden"]`

#### 14.3 Acceptance Criteria for F14

- Folder with `.env`, `.gitignore`, `.vscode/`: all hidden files/dirs excluded when `ignore_hidden=true`
- When `ignore_hidden=false`, `.env` is included in the scan
- Descend-time filtering: `.git/objects/ab/abcdef...` is never even visited (not just excluded from results)

---

## F15 — Ignore Rules: node_modules

### Objective
Skip all `node_modules` directories entirely when `ignore_node_modules` is `true`.

### Implementation Steps

#### 15.1 Already partially done

The `should_ignore_path` function checks for `node_modules` path components. The key behaviour is at the walker level: when a directory named `node_modules` is encountered, the walker must *not recurse into it*.

**Critical check in the walker (`_walk_recursive`):**
```python
if entry.is_dir(follow_symlinks=False):
    if should_ignore_path(rel_path, settings, is_dir=True):
        continue  # skip entire subtree — don't recurse
```

This is already handled by the F13 walker sketch. Verify it works.

#### 15.2 Acceptance Criteria for F15

- Folder with `node_modules` containing 10,000+ files: all skipped, scan completes quickly
- When `ignore_node_modules=false`, files inside `node_modules` are counted
- Setting is read from `settings_snapshot`

---

## F16 — Ignore Rules: Max File Size

### Objective
Skip individual files whose size exceeds the configured `max_file_size` threshold.

### Implementation Steps

#### 16.1 Already partially done

The current `_walk_folder` in runner.py already checks `max_file_size`. In the new walker (F13), the check is inside the file branch:

```python
if max_size > 0 and stat.st_size > max_size:
    continue  # skip this file
```

#### 16.2 Verify behaviour

- `max_file_size=0` or `max_file_size=-1` should mean "no limit" (check for `> 0` before comparing)
- Default from `scan_settings` is `52428800` (50 MB)

#### 16.3 Acceptance Criteria for F16

- Folder with a 100 MB file and `max_file_size=52428800`: the large file is skipped
- Folder with the same file and `max_file_size=0`: the file is included (no limit)
- Per-scan override via `settings_override.max_file_size` works

---

## F17 — Ignore Rules: Custom Globs *(stretch)*

### Objective
Allow users to define custom glob patterns (e.g. `*.log`, `dist/*`, `build/**`) that are excluded from scans.

### Implementation Steps

#### 17.1 Implement in `should_ignore_path` (already sketched in F13)

The `custom_ignore_globs` list from settings is checked using `fnmatch.fnmatch`:

```python
custom_globs = settings.get("custom_ignore_globs", [])
if custom_globs:
    str_path = str(rel_path).replace("\\", "/")
    for pattern in custom_globs:
        if fnmatch.fnmatch(str_path, pattern):
            return True
        if fnmatch.fnmatch(rel_path.name, pattern):
            return True
```

#### 17.2 Apply at directory-descent time

For custom globs that match directories (e.g. `dist/`, `build/`), the walker must skip recursion. The `should_ignore_path` already handles this via the `is_dir` flag — but the current check doesn't differentiate. For directory-level skip, we may need a separate check:

```python
# In walker, before recursing into a directory:
if _matches_custom_glob_directory(rel_path, custom_globs):
    continue
```

This is an optimisation: if a custom glob matches a directory name, we can avoid walking into it entirely. For file-level globs (`*.log`), we just skip the file.

#### 17.3 Acceptance Criteria for F17

- Setting `custom_ignore_globs: ["*.log", "dist/*"]` excludes all `.log` files and the entire `dist/` directory
- Patterns use standard glob syntax (`*`, `?`, `**`)
- The `ScanSettings` API (`PUT /settings`) supports saving custom globs
- Custom globs are snapshotted in `settings_snapshot` on each scan (already handled by JSONB)

---

## F18 — File Metadata Collection

### Objective
For each file the walker yields, collect: filename, full path, extension, size, created_at, modified_at. These become columns in the `scanned_files` row.

### Implementation Steps

#### 18.1 Create a metadata extraction helper

New function in `walker.py` or a new `metadata.py`:

```python
from datetime import datetime
from pathlib import Path
import os
import time

def extract_file_metadata(file_path: Path, stat: os.stat_result) -> dict:
    """
    Extract metadata from a file path and its os.stat result.
    Returns a dict matching the ScannedFile columns.
    """
    return {
        "filename": file_path.name,
        "full_path": str(file_path),
        "extension": file_path.suffix.lower() or None,
        "size": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_ctime),
        "modified_at": datetime.fromtimestamp(stat.st_mtime),
    }
```

#### 18.2 Integrate into the scan pipeline

In `runner.py`, when iterating the walker:

```python
for file_path, stat in walk_folder(folder_path, settings):
    metadata = extract_file_metadata(file_path, stat)
    # Create ScannedFile ORM object (not yet inserted — batched in F21)
    scanned_file = ScannedFile(
        scan_id=scan_id,
        **metadata,
    )
    files_batch.append(scanned_file)
```

#### 18.3 Acceptance Criteria for F18

- For a `.py` file: `filename` is correct, `extension` is `.py`, `size` matches disk, `created_at`/`modified_at` are valid timestamps
- For a file with no extension (e.g. `Makefile`): `extension` is `None`
- For a file in a subdirectory: `full_path` is absolute, `filename` is just the basename

---

## F19 — Text-File Detection

### Objective
Determine whether a file is text or binary by attempting UTF-8 decoding on the first N bytes (8 KB). Binary files are skipped for line counting and TODO scanning but are still counted for size/duplicate stats.

### Implementation Steps

#### 19.1 Extract `is_text_file` from `runner.py` into `line_counter.py`

The existing `_is_text_file` function in runner.py already does this correctly. Move it to `line_counter.py`:

```python
# backend/app/scanner/line_counter.py

_TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss", ".less",
    ".md", ".txt", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bat", ".ps1", ".sql", ".rb", ".java", ".cpp", ".c", ".h", ".hpp",
    ".rs", ".go", ".swift", ".kt", ".scala", ".php", ".pl", ".lua", ".r",
    ".vue", ".svelte", ".astro", ".env", ".gitignore", ".dockerfile",
    ".gradle", ".properties", ".lock",
}

def is_text_file(filepath: Path) -> bool:
    """Detect whether a file is text by extension hint + UTF-8 probe."""
    if filepath.suffix.lower() in _TEXT_EXTENSIONS:
        return True
    try:
        with open(filepath, "rb") as f:
            chunk = f.read(8192)
        chunk.decode("utf-8")
        return True
    except (UnicodeDecodeError, OSError):
        return False
```

#### 19.2 Remove the old `_is_text_file` from `runner.py`

Replace the inline call with `from app.scanner.line_counter import is_text_file`.

#### 19.3 Acceptance Criteria for F19

- `.py` file with UTF-8 content: detected as text
- `.py` file with UTF-8 content but unknown extension (e.g. `.custom`): detected as text via probe
- `.bin` file with random bytes: detected as binary
- Empty file: detected as text (empty string is valid UTF-8)
- Binary file with a text extension (e.g. `.py` that's actually compiled): detected as text (false positive — acceptable for v1; the line count will just be 0 or garbled)

---

## F20 — Line Counting

### Objective
Count the number of lines in text/code files. Store as `line_count` on the `ScannedFile` row.

### Implementation Steps

#### 20.1 Extract `count_lines` into `line_counter.py`

The existing `_count_lines` function in runner.py already does this. Move it:

```python
# backend/app/scanner/line_counter.py

def count_lines(filepath: Path) -> int:
    """Count lines in a text file. Returns 0 on error."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0
```

#### 20.2 Integrate into the scan pipeline

In `runner.py`, after metadata extraction:

```python
if is_text_file(file_path):
    line_count = count_lines(file_path)
else:
    line_count = None

scanned_file = ScannedFile(
    scan_id=scan_id,
    **metadata,
    line_count=line_count,
)
```

#### 20.3 Remove the old `_count_lines` from `runner.py`

#### 20.4 Acceptance Criteria for F20

- Text file with 10 lines: `line_count=10`
- Empty text file: `line_count=0`
- Binary file: `line_count=None`
- File with mixed line endings (CRLF, LF): counted correctly

---

## F21 — Batch DB Writes

### Objective
Accumulate `ScannedFile` rows in memory during the walk and flush them to PostgreSQL in batches (~500 rows per batch) using `INSERT` with `executemany` or equivalent. This is critical for performance on folders with 100k+ files.

### Implementation Steps

#### 21.1 Replace the monolithic `_walk_folder` return with batched insert logic

Rewrite `run_scan` in `runner.py` to:

```python
BATCH_SIZE = 500

async def run_scan(scan_id: int, session_factory):
    session = session_factory()
    try:
        scan = await session.get(Scan, scan_id)
        ...
        scan.status = ScanStatus.running
        scan.started_at = datetime.now(timezone.utc)
        await session.commit()

        settings = scan.settings_snapshot or {}
        batch = []
        total_files = 0
        total_size = 0
        total_lines = 0

        loop = asyncio.get_running_loop()

        for file_path, stat in walk_folder(scan.folder_path, settings):
            total_files += 1
            total_size += stat.st_size

            metadata = extract_file_metadata(file_path, stat)
            is_text = is_text_file(file_path)
            line_count = count_lines(file_path) if is_text else None
            if line_count:
                total_lines += line_count

            scanned_file = ScannedFile(
                scan_id=scan_id,
                filename=metadata["filename"],
                full_path=metadata["full_path"],
                extension=metadata["extension"],
                size=metadata["size"],
                line_count=line_count,
                created_at=metadata["created_at"],
                modified_at=metadata["modified_at"],
            )
            batch.append(scanned_file)

            if len(batch) >= BATCH_SIZE:
                await _flush_batch(session, batch)
                batch.clear()

        # Flush remaining
        if batch:
            await _flush_batch(session, batch)

        # Update scan totals
        scan.total_files = total_files
        scan.total_size = total_size
        scan.total_lines = total_lines
        scan.status = ScanStatus.completed
        scan.completed_at = datetime.now(timezone.utc)
        await session.commit()
    except Exception as exc:
        ...
```

#### 21.2 Implement `_flush_batch`

```python
async def _flush_batch(session: AsyncSession, batch: list[ScannedFile]):
    """Bulk-insert a batch of ScannedFile rows."""
    session.add_all(batch)
    await session.flush()
    # Clear each object from the session to avoid memory build-up
    for sf in batch:
        await session.expire(sf)
```

**Alternative (higher performance):** Use SQLAlchemy Core `insert()` with `executemany`:

```python
from sqlalchemy import insert
from app.models.scanned_file import ScannedFile

async def _flush_batch(session: AsyncSession, batch: list[ScannedFile]):
    values = [
        {
            "scan_id": sf.scan_id,
            "filename": sf.filename,
            "full_path": sf.full_path,
            "extension": sf.extension,
            "size": sf.size,
            "line_count": sf.line_count,
            "created_at": sf.created_at,
            "modified_at": sf.modified_at,
        }
        for sf in batch
    ]
    await session.execute(insert(ScannedFile.__table__), values)
    await session.flush()
```

The Core `insert()` approach avoids ORM overhead for bulk operations and is significantly faster. Use ORM `add_all` for simplicity in v1; benchmark and switch to Core if needed.

#### 21.3 Update `Scan` totals calculation

Previously `total_lines` came from summing lines during the walk and returning. Now we also have it. Keep the in-memory accumulator for the scan-level totals; the `scanned_files` rows store per-file `line_count`.

#### 21.4 Acceptance Criteria for F21

- Scan a folder with 1000 files: all 1000 rows are inserted into `scanned_files`
- Rows are inserted in batches (verify via logs or by checking the DB during the scan)
- `scan.total_files` matches `SELECT COUNT(*) FROM scanned_files WHERE scan_id = ?`
- `scan.total_size` matches `SELECT SUM(size) FROM scanned_files WHERE scan_id = ?`
- Memory usage does not grow linearly with file count (verified by scanning a 10k-file folder)

---

## Combined Order of Implementation

The features are **strongly interdependent** — F13 is the foundation, F14–F17 build ignore rules into it, F18 adds metadata, F19–F20 add text detection and line counting, and F21 adds DB persistence. They must be implemented in order.

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F13 | `backend/app/scanner/ignore_rules.py` | Create — `should_ignore_path` helper |
| 2 | F13 | `backend/app/scanner/walker.py` | Rewrite — `walk_folder` with `os.scandir` + manual recursion + descend-time filtering |
| 3 | F13 | `backend/app/scanner/runner.py` | Edit — replace `_walk_folder`/`_should_ignore` with calls to `walker.walk_folder` and `ignore_rules.should_ignore_path` |
| 4 | F14 | `backend/app/scanner/ignore_rules.py` | Verify — hidden-file check is correct and applied at descend-time |
| 5 | F15 | `backend/app/scanner/ignore_rules.py` | Verify — node_modules check is correct and applied at descend-time |
| 6 | F16 | `backend/app/scanner/walker.py` | Verify — max_file_size check in the walker's file branch |
| 7 | F17 | `backend/app/scanner/ignore_rules.py` | Verify — custom glob matching via fnmatch (stretch — skip if not needed) |
| 8 | F17 | `backend/app/api/settings.py` | If not already done — wire `custom_ignore_globs` in settings API |
| 9 | F18 | `backend/app/scanner/walker.py` | Add — `extract_file_metadata` function |
| 10 | F19 | `backend/app/scanner/line_counter.py` | Rewrite — `is_text_file` (moved from runner.py) |
| 11 | F20 | `backend/app/scanner/line_counter.py` | Add — `count_lines` (moved from runner.py) |
| 12 | F19–F20 | `backend/app/scanner/runner.py` | Edit — remove old `_is_text_file` and `_count_lines`; import from `line_counter` |
| 13 | F21 | `backend/app/scanner/runner.py` | Edit — implement batch accumulation + `_flush_batch`; replace count-only walk with full file-row creation |
| 14 | F21 | `backend/app/api/scans.py` | Edit — ensure `GET /scans/{id}/files` endpoint exists (or add stub for F29) |
| 15 | — | `docs/features.md` | After implementation, mark F13–F21 `[x]` |
| 16 | — | `docs/CurrentProgress.md` | After implementation, mark F13–F21 `[x]` |

---

## Key Design Decisions

1. **Descend-time filtering:** The walker uses `os.scandir` + manual recursion instead of `Path.rglob`. This lets us skip entire subtrees (`.git`, `node_modules`) at the directory level, which is a significant performance win for JS/Python projects with large dependency trees.

2. **Sync walker in thread executor:** The walker runs synchronously (for simplicity and to use `os.scandir` efficiently) via `loop.run_in_executor()`. This is the existing pattern from the current `runner.py`. The async wrapper handles DB operations.

3. **Batch size:** Start with `BATCH_SIZE = 500`. This is a reasonable default that balances memory usage vs. DB round-trips. Tune based on benchmarking with 100k+ file folders.

4. **Core vs ORM inserts:** Use SQLAlchemy ORM's `session.add_all` + `session.flush` for v1 simplicity. If profiling shows this is a bottleneck, switch to Core `insert().executemany()` for ~3-5x faster bulk inserts.

5. **No hash computation yet:** SHA-256 hashing (F22) happens in a separate pass or as an optional step within the walk. For F13–F21, `sha256` on `ScannedFile` remains `NULL`.

6. **`runner.py` becomes orchestrator:** After the refactor, `runner.py` no longer contains walk logic, text detection, or line counting — it only orchestrates the pipeline: iterate walker → collect metadata → batch-insert → update totals.

---

## Verification End-to-End

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Test a scan
curl.exe -X POST http://127.0.0.1:8000/api/v1/scans `
  -H "Content-Type: application/json" `
  -d '{"folder_path": "C:/Users/Public"}'

# Poll until completed
curl.exe http://127.0.0.1:8000/api/v1/scans/1
# -> status: "completed", totals populated

# Verify scanned_files rows exist
curl.exe "http://127.0.0.1:8000/api/v1/scans/1/files?page=1&page_size=5"
# -> returns paginated file list with metadata

# Verify DB directly (psql or similar)
# SELECT COUNT(*) FROM scanned_files WHERE scan_id = 1;
# -> Should match scan.total_files
```

**Browser test (Tauri dev):**
```powershell
cd frontend
npm run tauri dev
```

1. Click "New Scan" — native folder picker opens
2. Select a folder — confirmation dialog shows the path
3. Click "Start Scan" — scan runs, polling starts
4. On completion: scan detail page shows file count, size, lines
5. Scan detail page should eventually show a file table (once F30 is built)

---

## Files Changed Summary

| File | Action |
|---|---|
| `backend/app/scanner/walker.py` | Rewrite (was empty stub) — recursive walker with `os.scandir` |
| `backend/app/scanner/ignore_rules.py` | Create — `should_ignore_path`, `load_ignore_patterns` |
| `backend/app/scanner/line_counter.py` | Rewrite (was empty stub) — `is_text_file`, `count_lines` |
| `backend/app/scanner/runner.py` | Major refactor — remove inline helpers, add batch insert pipeline, remove `_walk_folder` |
| `backend/app/scanner/__init__.py` | No change needed (already exists) |
| `backend/app/api/settings.py` | Minor — ensure `custom_ignore_globs` field is wired |
| `docs/features.md` | Mark F13–F21 as `[x]` |
| `docs/CurrentProgress.md` | Mark F13–F21 as `[x]` |
