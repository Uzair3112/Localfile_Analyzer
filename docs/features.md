# Features — Local File Analyzer

Each feature has a unique ID so it can be referenced from its own future
`plan.md` (e.g. `plan-F01.md`). Features are grouped by area and roughly
ordered by build sequence — earlier features unblock later ones.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## A. Foundation / Setup

- [x] **F01 — Backend project scaffold**
  FastAPI app skeleton, folder structure (`app/api`, `app/models`,
  `app/scanner`), venv + `requirements.txt`, `uvicorn` running locally.

- [x] **F02 — Database connection & migrations**
  PostgreSQL connection config, SQLAlchemy models (or raw SQL), migration
  tool setup (e.g. Alembic), initial schema creation for all 5 tables.

- [x] **F03 — Tauri shell scaffold**
  Sidebar + topbar layout, CSS theme tokens, react-router-dom, placeholder
  pages for all 5 screens.

- [x] **F04 — Tauri ↔ FastAPI process wiring**
  Typed API client with startup health check, `@tauri-apps/plugin-shell`
  installed and registered.

- [x] **F05 — Dev environment docs**
  Root README with local setup steps (no Docker), backend README, frontend
  README updated.

---

## B. Folder Selection & Scan Lifecycle

- [x] **F06 — Native folder picker**
  Tauri OS folder-selection dialog wired to a "New Scan" button; selected
  path passed to the frontend.

- [x] **F07 — Start scan API**
  `POST /scans` — validates folder path exists/is a directory, creates a
  `scans` row (`status=pending`), returns `scan_id` immediately.

- [x] **F08 — Background scan execution**
  FastAPI background task (via `asyncio.create_task`) picks up the pending
  scan, sets `status=running`, and runs the scanner in a thread executor.

- [x] **F09 — Scan status polling**
  `GET /scans/{id}` returns current status/progress; frontend polling
  hook (`useScanPolling`) updates the UI until `completed`/`failed`.

- [x] **F10 — Scan completion & totals**
  On finish, scanner writes `total_files`, `total_size`, `total_lines`,
  `completed_at` back to the `scans` row.

- [x] **F11 — Scan failure handling**
  Per-file error isolation (skip unreadable/locked files, log and
  continue); scan-level failure sets `status=failed` with
  `error_message`.

- [x] **F12 — Delete scan**
  `DELETE /scans/{id}` removes the scan and cascades to all related rows
  (files, duplicates).

---

## C. Recursive Scanner Engine

- [x] **F13 — Recursive directory walker**
  Traverses the selected folder tree, applying ignore rules at
  descend-time (not post-hoc filtering).

- [x] **F14 — Ignore rules: hidden files**
  `ignore_hidden` setting excludes dotfiles/dotfolders from the walk.

- [x] **F15 — Ignore rules: node_modules**
  `ignore_node_modules` setting excludes `node_modules` directories from
  the walk.

- [x] **F16 — Ignore rules: max file size**
  `max_file_size` setting skips files above the configured threshold.

- [x] **F17 — Ignore rules: custom globs** *(stretch)*
  User-defined glob patterns (e.g. `*.log`, `dist/`) excluded from scans.

- [x] **F18 — File metadata collection**
  For each included file: filename, full path, extension, size,
  created/modified timestamps.

- [x] **F19 — Text-file detection**
  Detect text vs. binary files (UTF-8 decode attempt on first N bytes) to
  decide whether line-counting applies.

- [x] **F20 — Line counting**
  Count lines for detected text/code files; store as `line_count`.

- [x] **F21 — Batch DB writes**
  Accumulate scanned-file rows in memory and flush in batches (~500) for
  performance on large folders.

---

## D. Hashing & Duplicate Detection

- [x] **F22 — SHA-256 hashing (streamed)**
  Compute file hashes via chunked/streamed reads (no full-file memory
  load).

- [x] **F23 — Size-based duplicate candidate grouping**
  Pre-filter: only hash files that share an exact size with at least one
  other file, to avoid hashing every file.

- [x] **F24 — Duplicate group persistence**
  Insert `duplicates` rows for confirmed hash matches after full scan.

- [x] **F25 — Duplicates API & view**
  `GET /scans/{id}/duplicates` + frontend Duplicates page listing grouped
  duplicate files with paths and sizes.

---

## E. File Browsing & Search

- [x] **F26 — File list API**
  `GET /scans/{id}/files` with filtering (extension, search term),
  sorting (size, lines, name), and pagination.

- [x] **F27 — File table UI**
  Sortable/searchable/paginated table component (`FileTable`) on the Scan
  Detail page.

- [x] **F28 — Extension breakdown API**
  `GET /scans/{id}/extensions` — count, total size, % of total per
  extension.

- [x] **F29 — Extension breakdown UI**
  "Top Extensions" card on the dashboard (styled per the wallet-card
  reference pattern).

---

## F. Dashboard & Reporting

- [x] **F30 — Dashboard layout**
  Sidebar + topbar + welcome header + "New Scan" primary action, per the
  reference UI style.

- [x] **F31 — Stat cards**
  Reusable `StatCard` component: Total Files, Total Size, Duplicate
  Files, with icon badges and delta-vs-previous-scan indicators.

- [x] **F32 — Overview chart**
  Bar chart (Recharts) of files/lines scanned over time or per scan run,
  with hover tooltips.

- [x] **F33 — Largest files list**
  Query + UI card showing the top N largest files in a scan.

- [x] **F34 — Largest folders list**
  Aggregate file sizes by parent directory; show top N largest folders.

- [x] **F35 — Recent scans table**
  Dashboard table listing recent scans with folder path, date, file
  count, and status pill (Success/Running/Failed).

- [ ] **F36 — Scan history / comparison view**
  Dedicated view listing all past scans, allowing browsing/comparison
  across runs (including for the same folder over time).

- [ ] **F37 — Cleanup goals widget** *(stretch)*
  UI card summarizing actionable cleanup items (e.g. "12/40 duplicates
  resolved") — presentation only in v1, no auto-resolution.

---

## G. Settings

- [x] **F38 — Settings API**
  `GET /settings` and `PUT /settings` for global scan settings
  (`ignore_hidden`, `ignore_node_modules`, `max_file_size`,
  `custom_ignore_globs`).

- [x] **F39 — Settings UI page**
  Form for editing global defaults.

- [x] **F40 — Per-scan settings override**
  "New Scan" dialog allows overriding global defaults for a single scan;
  override is snapshotted into `scans.settings_snapshot` (JSONB).

---

## H. Packaging & Polish

- [ ] **F41 — Backend sidecar packaging**
  Build the FastAPI backend into a standalone binary (PyInstaller or
  similar) from the venv, for bundling with the Tauri app.

- [ ] **F42 — Postgres connectivity check & setup screen**
  On launch, verify DB connectivity; show a guided setup screen with
  instructions if unreachable.

- [ ] **F43 — Cross-platform build**
  Tauri production build/signing for target OS(es).

- [ ] **F44 — Visual polish pass**
  Final pass matching the reference UI's spacing, color tokens, and
  card/badge styling across all screens.

---

## I. Deferred / Stretch (post-v1)

- [ ] **F45 — Scan cancellation**
  Ability to cancel a running scan mid-way via a cancellation flag
  checked between batches.

- [ ] **F46 — Real-time file-system watching**
  Auto-rescan or live-update on file changes (explicitly out of scope
  for v1 per the PRD).

- [ ] **F47 — SSE/WebSocket-based scan updates**
  Replace polling with push-based updates — relevant rehearsal for
  RAMPART if pursued.

---

## How to use this file

1. Pick a feature ID (e.g. `F13`).
2. Create `plan-F13.md` describing implementation steps, file changes,
   and acceptance criteria for that feature only.
3. Reference the PRD.md and PDD.md for context (requirements + technical
   design) so the plan stays grounded in what's already been decided,
   rather than re-deriving architecture from scratch.
4. Mark the checkbox here `[x]` once the feature is implemented and
   verified.
