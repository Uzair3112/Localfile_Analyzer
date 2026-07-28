# Product Requirements Document (PRD)
## Local File Analyzer

**Version:** 1.0
**Status:** Draft
**Type:** Desktop Application
**Purpose:** Standalone tool 

---

## 1. Overview

Local File Analyzer is a desktop application that scans a user-selected
folder on their machine and generates statistics, reports, and visual
dashboards about the files inside it — file counts, line counts, duplicate
files, large files, and extension breakdowns.

The project exists for two reasons:

1. **Standalone value** — a genuinely useful local dev/ops utility for
   understanding what's inside a folder (codebase, downloads, project
   archive, etc.).
2. **Architectural rehearsal** — it uses the same stack and structural
   patterns (Tauri shell + FastAPI backend + PostgreSQL) planned for
   RAMPART, so building it first de-risks that larger project.

---

## 2. Goals

- Ship a working Tauri desktop app that talks to a local FastAPI backend.
- Prove out the Tauri ↔ FastAPI ↔ PostgreSQL communication pattern.
- Produce a genuinely useful scanning/reporting tool.
- Keep scope small enough to finish, since it's a preparation project.

### Non-Goals

- Cloud sync, multi-user accounts, or remote scanning.
- Editing or modifying scanned files.
- Real-time file-system watching (v1 is scan-on-demand only).

---

## 3. Technology Stack

| Layer      | Technology              |
|------------|--------------------------|
| Frontend   | Tauri + React             |
| Backend    | FastAPI (Python)          |
| Database   | PostgreSQL                |
| Scanner    | Python (standard lib + hashlib) |
| Charts     | Recharts or similar (React) |

### Why this stack

- **Tauri** gives a small, fast native shell with filesystem/folder-picker
  access without shipping a full Electron/Chromium runtime.
- **FastAPI** provides a clean, typed API layer between the UI and the
  scanning/DB logic — same shape RAMPART will need.
- **PostgreSQL** supports structured relational queries (duplicates,
  history, joins across files/duplicates) better than flat files or SQLite at
  RAMPART's eventual scale.

---

## 4. System Architecture

```
┌─────────────┐      folder path      ┌──────────────┐
│   Tauri UI   │ ─────────────────────▶ │   FastAPI     │
│  (React)     │                        │   Backend     │
│              │ ◀───────────────────── │               │
└─────────────┘   scan results / JSON   └──────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │  Python Scanner  │
                                        │  (recursive walk)│
                                        └────────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │   PostgreSQL     │
                                         │  (scans, files,  │
                                         │  duplicates)     │
                                        └──────────────────┘
```

### Main Workflow

1. User selects a folder via the native Tauri folder picker.
2. Tauri sends the folder path to FastAPI (`POST /scans`).
3. FastAPI creates a `scans` row and kicks off the scanner (async/background task).
4. The scanner walks the folder tree recursively, collecting metadata per file.
5. Metadata and duplicate hashes are written to PostgreSQL.
6. The frontend polls (or receives a completion event) and renders the
   dashboard, charts, and history view.

---

## 5. Features

### 5.1 Core Scanning
- Folder selection via native OS dialog.
- Recursive directory traversal.
- Configurable ignore rules (hidden files, `node_modules`, custom globs).
- Configurable max file size to skip huge binaries.

### 5.2 Analysis
- Total file and folder counts.
- Line counts for text/code files.
- Duplicate file detection via SHA-256 hashing.
- Large-file detection (configurable threshold).
- File extension breakdown (count, size, % of total).

### 5.3 Reporting & History
- Dashboard with summary stats and charts.
- Largest files / largest folders lists.
- Searchable file table (by name, extension, path).
- Scan history — compare past scans of the same or different folders.

### 5.4 Settings
- `ignore_hidden`
- `ignore_node_modules`
- `max_file_size`
- Additional custom ignore patterns (stretch goal)

---

## 6. Database Design

**Table: `scans`**
| Column | Type |
|---|---|
| id | PK |
| folder_path | text |
| started_at | timestamp |
| completed_at | timestamp |
| status | enum (pending / running / completed / failed) |
| total_files | int |
| total_size | bigint |
| total_lines | bigint |

**Table: `scanned_files`**
| Column | Type |
|---|---|
| id | PK |
| scan_id | FK → scans |
| filename | text |
| full_path | text |
| extension | text |
| size | bigint |
| line_count | int |
| sha256 | text |
| created_at | timestamp |
| modified_at | timestamp |

**Table: `duplicates`**
| Column | Type |
|---|---|
| id | PK |
| scan_id | FK → scans |
| hash | text |
| file1_id | FK → scanned_files |
| file2_id | FK → scanned_files |

**Table: `scan_settings`** *(optional, per-scan or global)*
| Column | Type |
|---|---|
| ignore_hidden | boolean |
| ignore_node_modules | boolean |
| max_file_size | bigint |

---

## 7. UI/UX Design

Design direction is based on the referenced dashboard (Oripio-style
fintech UI), adapted from "money" concepts to "file/folder" concepts.
The layout, spacing, and visual language carry over directly; only the
data changes.

### 7.1 Layout

- **Left sidebar** (fixed, ~230px): app logo/name, primary nav
  (Dashboard, Scans, File Explorer, Duplicates, Settings), a secondary
  "General" nav group (Settings, Help, Log out), and a promo/upgrade-style
  card at the bottom (repurposed as a "Pro tips" or "What's new" card).
- **Top bar**: global search ("Search files, scans..."), icon buttons
  (help, notifications), and a welcome header ("Welcome back — last scan:
  Wed, 12 June 2026") with a primary **"New Scan"** button in place of
  "Export."
- **Stat card row** (3 cards): mirrors Account Balance / Expenses / Savings —
  becomes **Total Files**, **Total Size**, **Duplicate Files**, each with
  an icon badge, a large number, and a small % delta vs. the previous scan.
- **Overview chart card**: bar chart of files scanned per month (or per
  scan run), replacing the "Earnings" chart — hover tooltip shows count.
- **Recent activity table**: replaces "Recent Transactions" with **Recent
  Scans** — folder path, date, file count, status (colored pill: Success /
  Running / Failed).
- **Right-side widgets**: "My Wallet"-style cards become **Top Extensions**
  (e.g. `.py`, `.js`, `.md` with file counts, like currency balances);
  "Savings Plan" becomes **Cleanup Goals** (e.g. "Remove Duplicates
  12/40 resolved," "Shrink Large Files 3/10").

### 7.2 Visual Style

- Clean, light background (`#F5F6F8` page, white cards).
- Primary accent: green (`#1F8A5A`-ish), used for primary buttons, active
  nav item, positive deltas, and success status pills.
- Secondary accent colors for status/extension badges (red for
  errors/large files, blue/yellow/purple for extension tags), consistent
  with the multi-currency flag/icon pattern in the reference image.
- Rounded cards (`~16px` radius), soft drop shadows, generous padding.
- Icon badges: small rounded-square icon containers with tinted
  backgrounds (light green, light red, light blue) next to each stat.
- Typography: modern sans-serif (e.g. Inter), bold large numbers for
  stats, muted gray for secondary labels/timestamps.
- Status pills: small rounded badges with a colored dot (green =
  Success/Completed, yellow = Running, red = Failed).

### 7.3 Key Screens

1. **Dashboard** — as described above; the default landing screen.
2. **Scan Detail** — file table for one scan, filterable/searchable,
   sortable by size/lines/extension.
3. **Duplicates View** — grouped by hash, with file pairs and "reveal in
   folder" action.
4. **Settings** — ignore rules, max file size, theme.

---

## 8. Non-Functional Requirements

- Scans should run as background tasks so the UI stays responsive.
- Large folders (100k+ files) should not block or crash the app —
  batch DB inserts.
- Local-only: no data leaves the user's machine.
- PostgreSQL connection managed locally (bundled or user-configured).

---

## 9. Milestones

| Phase | Deliverable |
|---|---|
| 1 | Tauri shell + folder picker + FastAPI hello-world round trip |
| 2 | Recursive scanner + DB schema + basic scan-to-DB pipeline |
| 3 | Dashboard UI with real stats (files, size, lines) |
| 4 | Duplicate detection |
| 5 | Scan history, search, charts polish |
| 6 | Settings panel + ignore rules |
| 7 | Polish pass matching reference UI style, packaging/build |

---

## 10. Success Criteria

- Can scan a real-world project folder (10k+ files) without crashing.
- Dashboard accurately reflects file counts, sizes, line counts.
- Duplicate detection correctly identifies identical files by hash.
- Scan history persists across app restarts.
- Architecture patterns proven here (Tauri↔FastAPI↔Postgres) are directly
  reusable for RAMPART.

---

