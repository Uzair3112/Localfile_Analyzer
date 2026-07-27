# Foundation Plan: F01 + F02 — Backend Scaffold & Database Setup

**Status:** Not started · **Target:** Working FastAPI server with DB-backed health check
**Docker:** Excluded — everything runs natively on the host machine
**Pre-requisites:** Python 3.10+, PostgreSQL installed and running on `localhost:5432`

---

## Project Progress Summary

| Layer | Status | Notes |
|---|---|---|
| **Docs** | Complete | PRD, PDD, features all written |
| **Backend scaffold** | Bare minimum | `app/main.py` has a single `/health` endpoint. `app/api/`, `app/models/`, `app/scanner/` are empty dirs. `venv/` exists with all deps installed. |
| **Frontend scaffold** | Tauri + React out-of-box | Stock template code (greet example). No layout, no API calls. |
| **Database** | Not started | No models, no migrations, no schema. `.env` has the connection string. |

---

## F01 — Backend Project Scaffold

### Objective
Turn the bare-minimum FastAPI skeleton into a well-structured, runnable backend with a proper package layout, configuration management, and a working dev server.

### Implementation Steps

#### 1.1 Backend package restructure
Ensure the following layout is fully populated:

```
backend/
├── app/
│   ├── __init__.py          # (exists, empty)
│   ├── main.py              # FastAPI app factory, lifespan, CORS, router includes
│   ├── config.py            # Settings class (pydantic-settings) reading from .env
│   ├── database.py          # async engine + session factory
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py        # top-level APIRouter, includes sub-routers
│   │   ├── scans.py         # /scans endpoints
│   │   ├── settings.py      # /settings endpoints
│   │   └── health.py        # /health endpoint
│   ├── models/
│   │   ├── __init__.py
│   │   ├── scan.py          # Scan ORM model
│   │   ├── scanned_file.py  # ScannedFile ORM model
│   │   ├── todo.py          # Todo ORM model
│   │   ├── duplicate.py     # Duplicate ORM model
│   │   └── scan_settings.py # ScanSettings ORM model
│   └── scanner/
│       ├── __init__.py
│       ├── runner.py        # orchestrator stub
│       ├── walker.py        # stub
│       ├── hasher.py        # stub
│       ├── line_counter.py  # stub
│       └── todo_finder.py   # stub
├── alembic/                 # (created by alembic init)
├── alembic.ini
├── requirements.txt         # (already exists — frozen)
├── .env                     # (already exists)
└── .gitignore               # (already exists)
```

Key points:
- `app/config.py` uses `pydantic-settings` to load `DATABASE_URL`, `HOST`, `PORT` from `.env` with sensible defaults.
- `app/main.py` uses a `lifespan` async context manager for engine startup/shutdown.
- `app/main.py` mounts `app.api.router` under `/api/v1`.
- CORS middleware allows `http://localhost:1420` (Vite dev server) and `tauri://localhost`.

#### 1.2 Configuration module (`app/config.py`)
- Create a `Settings` class with:
  - `DATABASE_URL: str` (default from `.env`)
  - `HOST: str = "127.0.0.1"`
  - `PORT: int = 8000`
  - `CORS_ORIGINS: list[str] = ["http://localhost:1420", "tauri://localhost"]`
- Instantiate once as `settings = Settings()` for import.

#### 1.3 Database module (`app/database.py`)
- Create async SQLAlchemy engine using `create_async_engine(settings.DATABASE_URL)`.
- Create `async_sessionmaker` bound to the engine.
- Provide `get_db` async generator for FastAPI dependency injection that yields sessions and closes them on exit.

#### 1.4 Main app factory (`app/main.py`)
- Rewrite to use `@asynccontextmanager` lifespan that calls `engine.dispose()` on shutdown.
- Include CORS middleware.
- Include the top-level API router.
- Keep the file clean — no business logic here.

#### 1.5 API health endpoint (`app/api/health.py`)
- `GET /api/v1/health` — returns `{"status": "ok", "db": "connected"}` on success, `{"status": "ok", "db": "disconnected"}` if DB ping fails.
- This proves the DB wiring works end-to-end.

#### 1.6 Verify dev server
```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- Visit `http://127.0.0.1:8000/docs` — FastAPI Swagger UI loads.
- Visit `http://127.0.0.1:8000/api/v1/health` — returns JSON.

#### 1.7 Acceptance Criteria for F01
- `uvicorn app.main:app --reload` starts without import errors.
- `GET /api/v1/health` returns 200 JSON.
- Swagger docs render at `/docs`.
- Project tree matches the planned layout above.
- No Docker used — everything runs via native `venv` + `uvicorn`.

---

## F02 — Database Connection & Migrations

### Objective
Define all 5 SQLAlchemy ORM models, configure Alembic for migrations, and create the initial schema in a local PostgreSQL database.

### Pre-requisite
PostgreSQL must be installed and running on the host. The user creates the database and role manually (one-time setup):

```powershell
psql -U postgres
CREATE USER fileanalyzer WITH PASSWORD 'fileanalyzer';
CREATE DATABASE fileanalyzer OWNER fileanalyzer;
```

### Implementation Steps

#### 2.1 Define all 5 ORM models (`app/models/`)

All models inherit from a shared `Base = declarative_base()` defined in `app/models/__init__.py`.

**`app/models/__init__.py`** — exports `Base` and all model classes.

**`app/models/scan.py`** — `Scan` table:
| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | `Integer, primary_key` | |
| `folder_path` | `Text, not null` | |
| `started_at` | `DateTime(timezone=True), nullable` | |
| `completed_at` | `DateTime(timezone=True), nullable` | |
| `status` | `Enum('pending','running','completed','failed')` | Use `sqlalchemy.Enum` with `create_constraint=True` |
| `total_files` | `Integer, default=0` | |
| `total_size` | `BigInteger, default=0` | |
| `total_lines` | `BigInteger, default=0` | |
| `settings_snapshot` | `JSONB, nullable` | Stores per-scan override snapshot |
| `error_message` | `Text, nullable` | |

Relationships: `files = relationship("ScannedFile", back_populates="scan", cascade="all, delete-orphan")` (same for duplicates).

**`app/models/scanned_file.py`** — `ScannedFile` table:
| Column | Type | Notes |
|---|---|---|
| `id` | `Integer, PK` | |
| `scan_id` | `Integer, FK -> scans.id` | `nullable=False`, indexed |
| `filename` | `Text, not null` | |
| `full_path` | `Text, not null` | |
| `extension` | `Text, nullable` | indexed |
| `size` | `BigInteger, not null` | |
| `line_count` | `Integer, nullable` | |
| `sha256` | `String(64), nullable` | indexed |
| `created_at` | `DateTime(timezone=True), nullable` | |
| `modified_at` | `DateTime(timezone=True), nullable` | |

Relationships: `scan = relationship("Scan", back_populates="files")`, `todos = relationship("Todo", back_populates="file", cascade="all, delete-orphan")`.

**`app/models/todo.py`** — `Todo` table:
| Column | Type | Notes |
|---|---|---|
| `id` | `Integer, PK` | |
| `file_id` | `Integer, FK -> scanned_files.id` | indexed |
| `line_number` | `Integer, not null` | |
| `type` | `Enum('TODO','FIXME')` | |
| `message` | `Text, nullable` | |

Relationships: `file = relationship("ScannedFile", back_populates="todos")`.

**`app/models/duplicate.py`** — `Duplicate` table:
| Column | Type | Notes |
|---|---|---|
| `id` | `Integer, PK` | |
| `scan_id` | `Integer, FK -> scans.id` | indexed |
| `hash` | `String(64), not null` | |
| `file1_id` | `Integer, FK -> scanned_files.id` | |
| `file2_id` | `Integer, FK -> scanned_files.id` | |

Relationships: `scan = relationship("Scan", back_populates="duplicates")`.

**`app/models/scan_settings.py`** — `ScanSettings` table:
| Column | Type | Notes |
|---|---|---|
| `id` | `Integer, PK` | |
| `ignore_hidden` | `Boolean, default=True` | |
| `ignore_node_modules` | `Boolean, default=True` | |
| `max_file_size` | `BigInteger, default=52428800` | 50 MB |
| `custom_ignore_globs` | `ARRAY(Text), default=[]` | |

#### 2.2 Alembic setup

```powershell
cd backend
.\venv\Scripts\Activate.ps1
alembic init alembic
```

Then configure `alembic.ini`:
- Set `sqlalchemy.url = %DATABASE_URL%` — but better to override in `alembic/env.py` to read from `app.config.settings.DATABASE_URL`.

Edit `alembic/env.py`:
- Add project root to `sys.path` so `from app.models import Base` works.
- Set `target_metadata = Base.metadata`.
- Read DB URL from `app.config.settings` and pass to `engine_from_config`.

Add `.env` loading in `alembic/env.py` so the migration script can read `DATABASE_URL` without needing the app running.

#### 2.3 Generate initial migration

```powershell
alembic revision --autogenerate -m "create_all_tables"
```

This produces a migration file in `alembic/versions/`. Verify the generated migration:
- Ensure all 5 CREATE TABLE statements are present.
- Ensure all FKs, indexes, and enum types are correct.
- Remove any unwanted auto-detected changes (e.g. temp tables, etc.).

#### 2.4 Apply migration

```powershell
alembic upgrade head
```

Verify with `psql` or any SQL client that all 5 tables + enum types exist.

#### 2.5 Verify DB integration via health endpoint

With migrations applied and PostgreSQL running:
```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- `GET /api/v1/health` returns `{"status": "ok", "db": "connected"}`.

#### 2.6 Handle DB-disconnected state gracefully
- `app/database.py` should expose a `check_db_connection()` function that tries `session.execute(text("SELECT 1"))` and returns `True`/`False`.
- The health endpoint uses this.
- If the DB is unreachable on app start, the app still boots (health shows `db: "disconnected"`), but any endpoint that needs the DB will fail with a clear 503 or 500. This keeps the app functional for non-DB operations.

#### 2.7 Acceptance Criteria for F02
- `alembic upgrade head` creates all 5 tables + enum types without errors.
- All tables are visible in `psql` with correct columns, types, FKs, and indexes.
- `GET /api/v1/health` returns `db: "connected"` when PostgreSQL is running.
- `GET /api/v1/health` returns `db: "disconnected"` when PostgreSQL is stopped.
- No Docker used — PostgreSQL runs as a native OS service.

---

## Combined Verification

After completing both F01 and F02, run this end-to-end check:

```powershell
# Terminal 1: Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Verify
curl http://127.0.0.1:8000/api/v1/health
# Expected: {"status":"ok","db":"connected"}
```

Then open `http://127.0.0.1:8000/docs` in a browser — all future endpoint stubs will appear here as they're added.

---

## Order of file creation (F01 then F02)

| Step | File | Action |
|---|---|---|
| 1 | `app/config.py` | Create — Settings class with pydantic-settings |
| 2 | `app/database.py` | Create — async engine, session factory, get_db, check_db_connection |
| 3 | `app/models/__init__.py` | Create — Base, model imports |
| 4 | `app/models/scan.py` | Create — Scan model |
| 5 | `app/models/scanned_file.py` | Create — ScannedFile model |
| 6 | `app/models/todo.py` | Create — Todo model |
| 7 | `app/models/duplicate.py` | Create — Duplicate model |
| 8 | `app/models/scan_settings.py` | Create — ScanSettings model |
| 9 | `app/api/__init__.py` | Create (empty) |
| 10 | `app/api/health.py` | Create — health endpoint with DB check |
| 11 | `app/api/router.py` | Create — top-level router including health |
| 12 | `app/main.py` | Rewrite — lifespan, CORS, router mount |
| 13 | `alembic.ini` | Create via `alembic init alembic` |
| 14 | `alembic/env.py` | Edit — point to app models, read DB URL from config |
| 15 | `alembic/versions/001_create_all_tables.py` | Create via `alembic revision --autogenerate` |
| 16 | — | Run `alembic upgrade head` |
