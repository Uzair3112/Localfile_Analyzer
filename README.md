# Local File Analyzer

A desktop application that scans a user-selected folder and generates statistics, reports, and visual dashboards about the files inside it — file counts, line counts, duplicate files, large files, and extension breakdowns.

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
- **PostgreSQL** 16+ installed and running as a native Windows service

## Quick Start

### 1. Database Setup

PostgreSQL must be installed and running on `localhost:5432`. Create the database user and database:

```powershell
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

Verify: [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health)

### 3. Frontend (Web)

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:1420](http://localhost:1420)

### 4. Frontend (Tauri Desktop)

```powershell
cd frontend
npm run tauri dev
```

This opens a native window loading the React app.

## Project Structure

```
Localfile_Analyzer/
├── backend/           # FastAPI + SQLAlchemy + Alembic
│   ├── app/
│   │   ├── api/       # REST endpoints
│   │   ├── models/    # SQLAlchemy ORM models
│   │   └── scanner/   # File scanning engine
│   ├── alembic/       # Database migrations
│   └── requirements.txt
├── frontend/          # Tauri + React + Vite
│   ├── src/           # React components, pages, hooks
│   └── src-tauri/     # Tauri Rust shell
└── docs/
    ├── PRD.md         # Product Requirements
    ├── PDD.md         # Product Design Document
    ├── features.md    # Feature tracker / progress
    └── plan/          # Implementation plans
```

## Available Scripts

See [docs/features.md](docs/features.md) for the full feature list and [docs/plan/](docs/plan/) for implementation plans.
