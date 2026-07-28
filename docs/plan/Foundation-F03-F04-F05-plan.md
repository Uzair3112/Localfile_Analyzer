# Foundation Plan: F03 + F04 + F05 — Tauri Shell, Process Wiring & Dev Docs

**Status:** Not started · **Target:** Fully wired Tauri desktop app with styled layout,
API client, and complete local development documentation
**Docker:** Excluded — PostgreSQL runs natively, all processes are local
**Pre-requisites:** F01 + F02 complete, Node.js 18+, Rust toolchain installed

---

## F03 — Tauri Shell Scaffold

### Objective
Transform the stock Tauri+React template into a proper application shell with a
sidebar navigation, top bar, theme system, and routing — no real data yet.

### Implementation Steps

#### 3.1 Install dependencies
```powershell
cd frontend
npm install react-router-dom recharts
```

`react-router-dom` for client-side routing between pages.
`recharts` for future chart components (install early since dashboard needs it).

#### 3.2 Set up theme tokens
Create `frontend/src/theme.css` with CSS custom properties matching the PDD spec:

```css
:root {
  --color-bg: #F5F6F8;
  --color-card: #FFFFFF;
  --color-primary: #1F8A5A;
  --color-primary-light: #E6F4EC;
  --color-danger: #E5484D;
  --color-danger-light: #FBEAEA;
  --color-text-primary: #1A1A1A;
  --color-text-muted: #6B7280;
  --radius-card: 16px;
  --sidebar-width: 230px;
  --topbar-height: 64px;
}
```

Import it in `main.tsx` so it's globally available.

#### 3.3 Create directory structure
```
frontend/src/
├── api/
│   └── client.ts              # fetch wrapper, typed API calls (stub for now)
├── pages/
│   ├── Dashboard.tsx           # placeholder
│   ├── ScanDetail.tsx          # placeholder
│   ├── Duplicates.tsx          # placeholder

│   └── Settings.tsx            # placeholder
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx         # nav links: Dashboard, Scans, Duplicates, Settings
│   │   └── TopBar.tsx          # welcome message + New Scan button (non-functional)
│   ├── shared/
│   │   ├── Badge.tsx           # reusable colored badge/pill
│   │   └── ProgressBar.tsx     # reusable progress bar
│   └── scan/
│       └── ScanStatusBadge.tsx # colored dot + label placeholder
├── hooks/
│   └── useScans.ts             # placeholder hook
├── App.tsx                     # sidebar + topbar + router outlet layout
├── App.css                     # (replaced/cleaned up)
├── main.tsx                    # imports theme.css, renders App
└── theme.css                   # CSS custom properties
```

#### 3.4 Create layout components

**`Sidebar.tsx`:**
- Fixed left sidebar, `var(--sidebar-width)` wide, full viewport height.
- App logo/name at top ("File Analyzer").
- Primary nav items (icons optional for v1, just text links):
  - Dashboard (`/`)
  - Scans (`/scans`)
  - Duplicates (`/duplicates`)

  - Settings (`/settings`)
- Active item highlighted with `--color-primary-light` background + green left border.
- Bottom section: "Pro Tips" card placeholder (light card with tip text).
- Use `react-router-dom`'s `NavLink` for navigation.

**`TopBar.tsx`:**
- Fixed top bar, height `var(--topbar-height)`, spans from sidebar edge to right.
- Left side: Page title (passed as prop).
- Right side: Primary "New Scan" button (non-functional, just the button).
- Separator line at bottom.

#### 3.5 Create page placeholders
Each page in `pages/` is a minimal component:
```tsx
function Dashboard() {
  return <div className="page"><h1>Dashboard</h1></div>;
}
```
Same pattern for ScanDetail, Duplicates, Settings.

#### 3.6 Set up routing in `App.tsx`
- Wrap everything in `BrowserRouter`.
- Layout: `<Sidebar />` + `<TopBar />` + `<main>` with `<Routes>`.
- Routes map paths to page components.
- The main content area uses `flex: 1` and `overflow-y: auto` so the sidebar stays fixed.

#### 3.7 Clean up stock files
- Remove the greet example from `App.tsx` and `App.css`.
- Remove `react.svg` and `vite.svg` from `assets/` (or keep only if used as logo).
- Replace `App.css` with minimal layout styles referencing the theme tokens.

#### 3.8 Verify the shell
```powershell
cd frontend
npm run dev
```
Open `http://localhost:1420` — sidebar, topbar, and page routing all render.
Click each nav link — the corresponding placeholder page shows.
The active nav item highlights correctly.

#### 3.9 Acceptance Criteria for F03
- Sidebar renders with all 4 nav links (Dashboard, Scans, Duplicates, Settings).
- Clicking a nav link updates the route and highlights the active item.
- TopBar shows "New Scan" button (non-functional).
- Theme tokens are globally available via CSS variables.
- No stock Tauri greet template remains.
- `npm run dev` starts without errors.

---

## F04 — Tauri ↔ FastAPI Process Wiring

### Objective
Wire the frontend to the backend so the app can communicate over HTTP, and
set up the Tauri Rust side to manage the FastAPI process lifecycle.

### Design Decision (Dev vs Production)

| Mode | Backend started by | Frontend connects via |
|---|---|---|
| **Dev** | User manually runs `uvicorn` in terminal | `http://127.0.0.1:8000` (Vite dev proxy or direct) |
| **Production** | Tauri spawns as sidecar binary | `http://127.0.0.1:8000` (same) |

For F04 we focus on **dev mode wiring** — the API client and a health-check
on app startup. Production sidecar packaging comes in F44.

### Implementation Steps

#### 4.1 Create API client (`frontend/src/api/client.ts`)
```typescript
const API_BASE = "http://127.0.0.1:8000/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Typed API functions
export const api = {
  health: () => request<{ status: string; db: string }>("/health"),
  // Future endpoints will be added here
};
```

Types can be defined inline or in a separate `types.ts`:
```typescript
export interface Scan {
  scan_id: number;
  status: "pending" | "running" | "completed" | "failed";
  folder_path: string;
  started_at: string | null;
  completed_at: string | null;
  total_files: number;
  total_size: number;
  total_lines: number;
}
```

#### 4.2 Install `@tauri-apps/plugin-shell`
This plugin gives Rust/Tauri the ability to spawn child processes.

```powershell
cd frontend
npm install @tauri-apps/plugin-shell
```

Add the plugin to `src-tauri/Cargo.toml`:
```toml
tauri-plugin-shell = "2"
```

Register in `src-tauri/src/lib.rs`:
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])  // greet will be removed later
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 4.3 Backend health check on app startup
In `App.tsx` (or a dedicated startup hook), call `api.health()` on mount:

```typescript
useEffect(() => {
  api.health()
    .then(data => console.log("Backend connected:", data))
    .catch(err => console.warn("Backend unreachable:", err.message));
}, []);
```

This confirms the frontend can reach the backend. In a future feature (F45),
this will become a proper connectivity screen.

#### 4.4 [Rust side] FastAPI process management stub
For **dev mode**, this is informational only — the user runs both processes
separately. Add a constant in Rust that points to the backend path for future
sidecar use:

No active spawning in dev mode. The Rust side is prepared by having the shell
plugin available, and the frontend knows the backend URL.

#### 4.5 Verify end-to-end connectivity
```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```
1. Open `http://localhost:1420`.
2. Open browser DevTools → Console.
3. Confirm log: `"Backend connected: {status: 'ok', db: 'connected'}"`.
4. If backend is stopped, confirm log: `"Backend unreachable: ..."`.

#### 4.6 Acceptance Criteria for F04
- `api.client.ts` provides typed functions for all planned endpoints (stubs).
- Frontend calls `api.health()` on startup and logs the result.
- `@tauri-apps/plugin-shell` is installed and registered.
- Backend URL is centralized in a single constant (`API_BASE`).
- Changing the backend URL requires changing exactly one file.

---

## F05 — Dev Environment Documentation

### Objective
Create a root `README.md` and supporting docs so a new developer can go from
git clone to running the full app in under 5 minutes — without Docker.

### Design Decision
The original F05 mentions `docker-compose.yml` for PostgreSQL. Since Docker is
excluded, we document **native PostgreSQL setup** instead, which is already
what the project uses (PostgreSQL installed as a Windows service).

### Implementation Steps

#### 5.1 Create root `README.md`
Replace the stock Tauri `frontend/README.md` with a project-level `README.md`
at the repo root covering:

```markdown
# Local File Analyzer

A desktop app that scans folders and generates file statistics, reports,
and visual dashboards — all running locally on your machine.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Tauri (Rust) |
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI (Python) |
| Database | PostgreSQL |
| Charts | Recharts |

## Prerequisites

- **Python** 3.10+
- **Node.js** 18+
- **Rust** toolchain (rustup)
- **PostgreSQL** 16+ installed and running as a native service

## Quick Start

### 1. Database Setup

PostgreSQL must be installed and running on `localhost:5432`.
Create the database user and database:

```powershell
# Connect to PostgreSQL as superuser
psql -U postgres
CREATE USER fileanalyzer WITH PASSWORD 'fileanalyzer';
CREATE DATABASE fileanalyzer OWNER fileanalyzer;
\q
```

### 2. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify: http://127.0.0.1:8000/api/v1/health

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:1420

### 4. (Optional) Tauri Desktop App

```powershell
cd frontend
npm run tauri dev
```

This opens a native window that loads the React app.

## Project Structure

```
Localfile_Analyzer/
├── backend/           # FastAPI + SQLAlchemy + Alembic
│   ├── app/           # application code
│   │   ├── api/       # REST endpoints
│   │   ├── models/    # SQLAlchemy ORM models
│   │   └── scanner/   # file scanning engine
│   ├── alembic/       # database migrations
│   └── requirements.txt
├── frontend/          # Tauri + React + Vite
│   ├── src/           # React components, pages, hooks
│   └── src-tauri/     # Tauri Rust shell
└── docs/
    ├── PRD.md         # Product Requirements
    ├── PDD.md         # Product Design
    ├── features.md    # Feature tracker
    └── plan/          # Implementation plans
```

## Available Scripts

See `docs/features.md` for the full feature list and `docs/plan/` for
implementation plans.
```

#### 5.2 Add `backend/README.md` (optional but helpful)
Short note about backend-specific setup, if someone wants to work only on the
backend without the frontend:
```markdown
# Backend — FastAPI + PostgreSQL

## Setup
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

## Database
alembic upgrade head

## Run
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

## Verify
curl.exe http://127.0.0.1:8000/api/v1/health
```

#### 5.3 Remove or replace the stock `frontend/README.md`
Delete the auto-generated Tauri template README at `frontend/README.md`
(since the root README covers everything). Or leave it and point to root.

#### 5.4 Acceptance Criteria for F05
- Root `README.md` exists with complete setup instructions.
- A new developer can follow the README from scratch and get the app running.
- No Docker mentioned anywhere in the setup instructions.
- Database setup is documented with explicit `psql` commands.
- Both backend and frontend start commands are documented.
- `docs/features.md` references are included for next steps.

---

## Combined Order of Implementation

| Step | Feature | File(s) | Action |
|---|---|---|---|
| 1 | F03 | `frontend/src/theme.css` | Create — CSS custom properties per PDD |
| 2 | F03 | `frontend/src/main.tsx` | Edit — import theme.css |
| 3 | F03 | `frontend/src/components/layout/Sidebar.tsx` | Create — nav links, active highlighting |
| 4 | F03 | `frontend/src/components/layout/TopBar.tsx` | Create — title + New Scan button |
| 5 | F03 | `frontend/src/pages/*.tsx` (5 files) | Create — placeholder pages |
| 6 | F03 | `frontend/src/App.tsx` | Rewrite — layout + BrowserRouter + Routes |
| 7 | F03 | `frontend/src/App.css` | Replace — layout styles using theme tokens |
| 8 | F03 | Various stock files | Clean up — remove greet example |
| 9 | F04 | `frontend/src/api/client.ts` | Create — typed fetch wrapper, health check |
| 10 | F04 | `frontend/src/api/types.ts` | Create — shared TypeScript interfaces |
| 11 | F04 | Frontend dependencies | Install react-router-dom, recharts, @tauri-apps/plugin-shell |
| 12 | F04 | `frontend/src-tauri/Cargo.toml` | Edit — add tauri-plugin-shell |
| 13 | F04 | `frontend/src-tauri/src/lib.rs` | Edit — register shell plugin |
| 14 | F04 | `frontend/src/App.tsx` | Edit — add startup health check |
| 15 | F05 | `README.md` (root) | Create — full setup docs |
| 16 | F05 | `backend/README.md` | Create — backend-specific quickstart |
| 17 | F05 | `frontend/README.md` | Remove or replace (no longer needed) |
