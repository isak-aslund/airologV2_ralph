"""Application configuration settings."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    # Database settings
    DATABASE_PATH: Path = Path("data/flight_logs.db")

    # Upload settings
    UPLOAD_DIR: Path = Path("data/logs")
    MAX_UPLOAD_SIZE: int = 500 * 1024 * 1024  # 500MB

    # Image directory
    IMG_DIR: Path = Path("img")

    # Frontend build directory
    FRONTEND_DIST_DIR: Path = Path("frontend/dist")

    class Config:
        env_prefix = "FLIGHT_LOG_"


settings = Settings()
