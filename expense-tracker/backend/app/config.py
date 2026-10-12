from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (or a local .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"
    cors_origins: Annotated[list[str], NoDecode] = []
    db_pool_size: int = 5
    session_ttl_days: int = 30
    cookie_secure: bool = True
    public_base_url: str = "http://localhost:8080"
    invite_expiry_days: int = 7
    login_max_failures: int = 5
    login_window_minutes: int = 15
    # config/seed.yaml, mounted into the containers. Unset: nothing is seeded.
    seed_config: str | None = None

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
