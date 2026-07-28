# Product Design Document (PDD)
## Local File Analyzer

**Version:** 1.0
**Companion to:** PRD.md
**Scope:** Technical design — architecture, API contracts, data flow, component
breakdown, and implementation details. The PRD defines *what* and *why*;
this document defines *how*.

---

## 1. System Architecture

### 1.1 Process Model

Three logical processes run locally on the user's machine:

```
┌────────────────────────┐
│   Tauri Shell (Rust)    │  native window, OS folder picker,
│   + WebView (React)     │  spawns/manages FastAPI process
└───────────┬─────────────┘
            │ HTTP (localhost:8000)
┌───────────▼─────────────┐
│   FastAPI Backend        │  REST API, background tasks,
│   (Python, uvicorn)      │  orchestrates scanner
└───────────┬─────────────┘
            │ asyncpg / SQLAlchemy
┌───────────▼─────────────┐
│   PostgreSQL              │  persistent storage
└────────────────────────┘
```

- Tauri's Rust side launches the FastAPI process (via `Command` sidecar) on
  app start and terminates it on app close.
- The React frontend talks to FastAPI purely over `http://127.0.0.1:8000`
  — no Tauri IPC needed for data, only for OS-level things (folder picker,
  window controls).
- FastAPI owns all business logic and DB access; the scanner runs as a
  FastAPI `BackgroundTask` (v1) so scans don't block the request/response
  cycle.

### 1.2 Why this split

This mirrors RAMPART's intended shape: a native shell that's a thin
client, and a backend service that owns all logic/state. Keeping the
frontend "dumb" (fetch + render) now means the RAMPART frontend can follow
the same pattern without rework.

---

## 2. API Design

Base URL: `http://127.0.0.1:8000/api/v1`

### 2.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/scans` | Start a new scan for a folder path |
| `GET` | `/scans` | List scan history (paginated) |
| `GET` | `/scans/{scan_id}` | Get scan status + summary stats |
| `DELETE` | `/scans/{scan_id}` | Delete a scan and its data |
| `GET` | `/scans/{scan_id}/files` | List scanned files (filter/search/sort/paginate) |
| `GET` | `/scans/{scan_id}/duplicates` | List duplicate groups |
| `GET` | `/scans/{scan_id}/extensions` | Extension breakdown stats |
| `GET` | `/settings` | Get current global scan settings |
| `PUT` | `/settings` | Update global scan settings |

### 2.2 Example: Start Scan

**Request**
```http
POST /api/v1/scans
Content-Type: application/json

{
  "folder_path": "/Users/sajibur/projects/rampart",
  "settings_override": {
    "ignore_hidden": true,
    "ignore_node_modules": true,
    "max_file_size": 52428800
  }
}
```

**Response** `202 Accepted`
```json
{
  "scan_id": 42,
  "status": "pending",
  "folder_path": "/Users/sajibur/projects/rampart",
  "started_at": null
}
```

### 2.3 Example: Poll Scan Status

**Request**
```http
GET /api/v1/scans/42
```

**Response** `200 OK`
```json
{
  "scan_id": 42,
  "status": "running",
  "folder_path": "/Users/sajibur/projects/rampart",
  "started_at": "2026-07-26T09:12:03Z",
  "completed_at": null,
  "total_files": 8213,
  "total_size": 194823110,
  "total_lines": 512044,
  "progress": {
    "files_scanned": 5120,
    "estimated_total": 8213
  }
}
```

`status` values: `pending`, `running`, `completed`, `failed`.

### 2.4 Example: File List (filtered)

```http
GET /api/v1/scans/42/files?extension=.py&sort=size&order=desc&search=main&page=1&page_size=50
```

Returns paginated `scanned_files` rows matching the filters.

### 2.5 Error Contract

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "SCAN_NOT_FOUND",
    "message": "No scan exists with id 999"
  }
}
```

Standard HTTP status codes apply (`404`, `400`, `422`, `500`). FastAPI's
built-in validation (Pydantic) handles `422` for malformed requests
automatically.

---

## 3. Data Flow

### 3.1 Scan Lifecycle

```
User clicks "New Scan"
        │
        ▼
Tauri opens native folder picker → returns path
        │
        ▼
POST /scans { folder_path }
        │
        ▼
FastAPI: create `scans` row (status=pending) → returns scan_id immediately
        │
        ▼
FastAPI: schedule BackgroundTask(run_scan, scan_id)
        │
        ▼
Frontend: navigate to Scan Detail screen, begin polling GET /scans/{id} every 1.5s
        │
        ▼
Background task: status → running
        │
        ├─ os.walk() the folder recursively
        ├─ apply ignore rules (hidden, node_modules, max_size, custom globs)
        ├─ for each file:
        │     ├─ compute size, extension, mtime/ctime
        │     └─ compute SHA-256 hash
        ├─ batch-insert scanned_files rows (chunks of ~500)
        ├─ after all files inserted: run duplicate-detection query
        │     (GROUP BY hash HAVING COUNT(*) > 1) → insert `duplicates` rows
        └─ update scans row: status=completed, totals, completed_at
        │
        ▼
Frontend: next poll sees status=completed → stop polling, render full dashboard
```

### 3.2 Duplicate Detection Strategy

Two-pass approach to avoid hashing every file unnecessarily:

1. **Pass 1 (cheap):** group files by exact `size` while walking. Only
   files sharing a size with at least one other file are candidates.
2. **Pass 2 (expensive):** SHA-256 only the candidate files, in
   chunked/streamed reads (not loading whole file into memory).
3. Insert `duplicates` rows for confirmed hash matches.

This avoids hashing, say, 8,000 uniquely-sized files when only 40 of them
could possibly be duplicates.

### 3.3 Ignore Rules (applied during walk, not after)

Rules are applied at directory-descent time so excluded trees (e.g.
`node_modules`, `.git`) are never even walked into — not just filtered
out post-hoc. This matters a lot for performance on JS projects.

---

## 4. Database Design (Implementation Detail)

### 4.1 Schema (DDL sketch)

```sql
CREATE TYPE scan_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE scans (
    id              SERIAL PRIMARY KEY,
    folder_path     TEXT NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    status          scan_status NOT NULL DEFAULT 'pending',
    total_files     INTEGER DEFAULT 0,
    total_size      BIGINT DEFAULT 0,
    total_lines     BIGINT DEFAULT 0,
    settings_snapshot JSONB,
    error_message   TEXT
);

CREATE TABLE scanned_files (
    id              SERIAL PRIMARY KEY,
    scan_id         INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    full_path       TEXT NOT NULL,
    extension       TEXT,
    size            BIGINT NOT NULL,
    line_count      INTEGER,
    sha256          CHAR(64),
    created_at      TIMESTAMPTZ,
    modified_at     TIMESTAMPTZ
);
CREATE INDEX idx_scanned_files_scan_id ON scanned_files(scan_id);
CREATE INDEX idx_scanned_files_hash ON scanned_files(sha256);
CREATE INDEX idx_scanned_files_extension ON scanned_files(extension);

CREATE TABLE duplicates (
    id              SERIAL PRIMARY KEY,
    scan_id         INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    hash            CHAR(64) NOT NULL,
    file1_id        INTEGER NOT NULL REFERENCES scanned_files(id),
    file2_id        INTEGER NOT NULL REFERENCES scanned_files(id)
);
CREATE INDEX idx_duplicates_scan_id ON duplicates(scan_id);

CREATE TABLE scan_settings (
    id                    SERIAL PRIMARY KEY,
    ignore_hidden         BOOLEAN NOT NULL DEFAULT true,
    ignore_node_modules   BOOLEAN NOT NULL DEFAULT true,
    max_file_size         BIGINT NOT NULL DEFAULT 52428800, -- 50MB
    custom_ignore_globs   TEXT[] DEFAULT '{}'
);
```

### 4.2 Design Notes

- `settings_snapshot` (JSONB) on `scans` preserves exactly what rules were
  active for that run, per the earlier decision to keep global defaults
  with per-scan override snapshots.
- `duplicates` stores file *pairs* rather than full groups — for groups of
  3+ identical files, this creates one row per pair. Acceptable for v1;
  a normalized `duplicate_groups` table is a future optimization if group
  sizes get large.
- Cascading deletes on `scan_id` mean deleting a scan cleans up everything
  under it automatically.

---

## 5. Frontend Component Architecture

```
src/
├── App.tsx
├── api/
│   └── client.ts          # fetch wrapper, typed API calls
├── pages/
│   ├── Dashboard.tsx
│   ├── ScanDetail.tsx
│   ├── Duplicates.tsx
│   └── Settings.tsx
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── TopBar.tsx
│   ├── dashboard/
│   │   ├── StatCard.tsx        # reusable: icon, value, delta %
│   │   ├── OverviewChart.tsx   # bar chart, recharts
│   │   ├── RecentScansTable.tsx
│   │   ├── TopExtensionsCard.tsx
│   │   └── CleanupGoalsCard.tsx
│   ├── scan/
│   │   ├── FileTable.tsx       # sortable/searchable/paginated
│   │   ├── ScanStatusBadge.tsx
│   │   └── NewScanDialog.tsx
│   └── shared/
│       ├── Badge.tsx
│       └── ProgressBar.tsx
└── hooks/
    ├── useScanPolling.ts      # polls GET /scans/{id} while status=running
    └── useScans.ts
```

### 5.1 Polling Hook (design sketch)

```ts
function useScanPolling(scanId: number) {
  const [scan, setScan] = useState<Scan | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const poll = async () => {
      const data = await getScan(scanId);
      setScan(data);
      if (data.status === "completed" || data.status === "failed") {
        clearInterval(interval);
      }
    };
    poll();
    interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [scanId]);

  return scan;
}
```

---

## 6. Scanner Module Design (Python)

```
scanner/
├── walker.py       # recursive traversal + ignore-rule application
├── hasher.py        # streamed SHA-256 computation
├── line_counter.py  # text-file detection + line counting
└── runner.py        # orchestrates the above, writes to DB in batches
```

- **Text-file detection:** attempt UTF-8 decode on first 8KB; binary files
  are skipped for line-counting but still counted for
  size/duplicate stats.
- **Batch inserts:** accumulate rows in memory (chunks of ~500) and flush
  with `executemany`/`COPY` rather than one INSERT per file — critical for
  100k+ file folders.
- **Cancellation:** scanner checks a cancellation flag (set via a future
  `DELETE /scans/{id}/cancel` endpoint) between batches so long scans can
  be stopped cleanly (stretch goal, not v1).

---

## 7. UI Component Design Reference

Mirrors the Oripio-style layout from the PRD. Key reusable pieces:

- **`StatCard`** — icon badge (tinted background), large bold number,
  label, small colored delta pill (`+3.2%` green / `-2.1%` red).
- **`ScanStatusBadge`** — colored dot + label (`● Running` yellow,
  `● Completed` green, `● Failed` red).
- **`OverviewChart`** — Recharts `BarChart`, green bars, tooltip on hover
  showing exact count, matches reference image's "Earnings" chart shape.
- **Sidebar** — fixed width, active-item highlighted with light green
  background + green left border accent, bottom promo card slot reused
  for a "Tips" card.

Color tokens (to centralize in a theme file):

```css
--color-bg: #F5F6F8;
--color-card: #FFFFFF;
--color-primary: #1F8A5A;
--color-primary-light: #E6F4EC;
--color-danger: #E5484D;
--color-danger-light: #FBEAEA;
--color-text-primary: #1A1A1A;
--color-text-muted: #6B7280;
--radius-card: 16px;
```

---

## 8. Deployment & Packaging

### 8.1 Backend Environment Isolation

All Python dependencies (FastAPI, uvicorn, asyncpg/SQLAlchemy, hashlib
helpers, etc.) are installed into a dedicated virtual environment for the
backend — never into the system/global Python. This keeps the project
reproducible, avoids clashing with other Python projects on the dev
machine, and matches how RAMPART's backend should be set up too.

```
backend/
├── venv/                  # local virtual environment (gitignored)
├── requirements.txt       # pinned dependencies
├── pyproject.toml         # optional, if using Poetry/uv instead
├── app/
│   ├── main.py
│   ├── api/
│   ├── models/
│   └── scanner/
```

**Setup (dev):**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- `venv/` is added to `.gitignore`; only `requirements.txt` (or a lockfile
  if using Poetry/uv/pip-tools) is committed, so the environment is
  rebuildable from a clean checkout.
- Any setup script or `Makefile`/`justfile` target for "run backend"
  should activate the venv first, or invoke the venv's interpreter
  directly (`./venv/bin/python`, `./venv/bin/uvicorn`) rather than relying
  on an activated shell — this matters once Tauri needs to spawn the
  process programmatically.
- Tool choice is flexible: plain `venv` + `pip` is the simplest default;
  `uv` (fast, single binary, lockfile support) or `Poetry` are reasonable
  upgrades if dependency management gets more complex. Pick one and note
  it in the repo README.

### 8.2 Packaging for Production

- **Dev mode:** `docker-compose up` for Postgres, backend `venv` activated
  + `uvicorn` (reload on), `tauri dev` for the shell.
- **Production build:** Tauri bundles the React build + spawns the
  FastAPI backend as a sidecar binary. This binary is built *from* the
  venv (e.g. PyInstaller run inside the activated venv so it packages
  exactly the pinned dependencies, nothing global) so the end user never
  needs Python or the venv installed separately — the venv is purely a
  build-time isolation tool, not something shipped to end users.
- **Postgres in production:** per the earlier decision, require a local
  install/Docker container rather than bundling — app checks connectivity
  on launch and shows a setup screen with instructions if unreachable.

---

## 9. Security & Reliability Notes

- Backend binds to `127.0.0.1` only — never exposed on the network.
- Folder paths are validated server-side (must exist, must be a directory,
  no traversal outside what the OS picker returned).
- All file reads are read-only; the app never writes into scanned folders.
- Scanner runs with a per-file try/except so a single unreadable/locked
  file doesn't abort the whole scan — it's logged and skipped.

---

## 10. Open Implementation Details (to resolve during build)

- Exact batching size for DB inserts (start at 500, tune based on testing).
- Whether `progress` in the scan-status response is computed via a live
  file count or a pre-walk estimate pass.
- PyInstaller vs. Nuitka vs. other options for packaging the FastAPI sidecar.
