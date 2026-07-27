from fastapi import APIRouter
from app.api.health import router as health_router
from app.api.scans import router as scans_router
from app.api.settings import router as settings_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health_router)
api_router.include_router(scans_router)
api_router.include_router(settings_router)
