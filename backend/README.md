# Backend — FastAPI + PostgreSQL

## Setup

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Database

```powershell
alembic upgrade head
```

## Run

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Verify

```powershell
curl.exe http://127.0.0.1:8000/api/v1/health
```

Expected: `{"status":"ok","db":"connected"}`
