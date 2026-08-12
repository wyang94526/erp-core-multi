from functools import lru_cache
from pathlib import Path

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
    # Auth — override JWT_SECRET in .env for any non-local deployment
    jwt_secret: str = "erp-dev-jwt-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12
    # Shared demo password used when seeding / migrating existing users
    default_user_password: str = "Password123!"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
