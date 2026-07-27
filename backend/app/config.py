from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://fileanalyzer:fileanalyzer@localhost:5432/fileanalyzer"
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    CORS_ORIGINS: List[str] = ["http://localhost:1420", "tauri://localhost"]

    class Config:
        env_file = ".env"


settings = Settings()
