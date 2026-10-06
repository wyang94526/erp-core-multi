# @author: Wendy Yang
# @date: 2026-09-19

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    postgres_user: str = "erp_admin"
    postgres_password: str = ""
    postgres_db: str = "erp_system"
    postgres_port: int = 5432
    postgres_host: str = "localhost"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    environment: str = "development"
    # Comma-separated origins. Empty = same-origin only (no extra CORS hosts).
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173"
    )
    # Auth — override JWT_SECRET in .env for any non-local deployment
    jwt_secret: str = "erp-dev-jwt-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12
    # Shared demo password used when seeding / migrating existing users
    default_user_password: str = "Password123!"
    # AI assistant (optional — heuristic tool router used when unset)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    ai_chroma_path: str = "backend/data/chroma"
    ai_knowledge_path: str = "backend/app/ai/knowledge"
    attachments_path: str = "backend/data/attachments"
    attachments_max_bytes: int = 15 * 1024 * 1024
    # Relative paths resolve from the repo root; Docker sets /data/imports.
    gtt_data_dir: str = "backend/data/imports"
    # Windows Explorer path shown on CSV Import. Empty on OCI/local (container path only).
    gtt_import_host_path: str = ""

    def attachments_root(self) -> Path:
        path = Path(self.attachments_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    def gtt_import_root(self) -> Path:
        path = Path(self.gtt_data_dir)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"prod", "production"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_url(self) -> str:
        password = quote_plus(self.postgres_password)
        return (
            f"postgresql+psycopg://{self.postgres_user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production:
        secret = (settings.jwt_secret or "").strip()
        if not secret or secret == "erp-dev-jwt-secret-change-me":
            raise ValueError(
                "Set JWT_SECRET to a random value before running in production"
            )
    return settings
