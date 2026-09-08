"""Application configuration."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ — load .env then .env.test when present so WECHAT_* work without relying on
# uvicorn injecting --env-file into os.environ (unreliable on Windows + --reload).
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _env_files() -> tuple[Path | str, ...]:
    paths: list[Path] = []
    for name in (".env", ".env.test"):
        p = _BACKEND_DIR / name
        if p.is_file():
            paths.append(p)
    return tuple(paths) if paths else (_BACKEND_DIR / ".env",)


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    app_name: str = "Dragon Reserve Backend"
    app_version: str = "0.1.0"
    environment: str = Field(default="development", validation_alias="APP_ENV")
    api_v1_prefix: str = "/api/v1"
    api_v2_prefix: str = "/api/v2"
    debug: bool = Field(default=False, validation_alias="APP_DEBUG")

    database_url: str = Field(
        default="sqlite:///./dragon_reserve_dev.db",
        description="SQLAlchemy database URL",
    )

    jwt_secret_key: str = Field(
        default="dev-only-change-me",
        description="JWT signing secret",
    )
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 30
    checkin_radius_meters: int = 1000
    user_invite_code: str = ""
    admin_invite_code: str = ""
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    wechat_code2session_url: str = "https://api.weixin.qq.com/sns/jscode2session"
    bgg_api_token: str = ""
    bgg_api_base_url: str = "https://boardgamegeek.com/xmlapi2"
    qweather_developer_id: str = ""
    qweather_project_id: str = ""
    qweather_credential_id: str = ""
    qweather_api_host: str = "n46cdr3rep.re.qweatherapi.com"
    qweather_private_key_path: str = "secrets/qweather-ed25519-private.pem"
    qweather_timeout_seconds: float = 8.0
    qweather_cache_seconds: int = 1800
    qweather_refresh_far_hours: int = 12
    qweather_refresh_near_hours: int = 6
    qweather_air_refresh_near_hours: int = 3
    qweather_stale_max_hours: int = 24
    qweather_refresh_batch_size: int = 100
    qweather_refresh_max_concurrency: int = 2
    amap_web_service_key: str = ""
    amap_regeocode_url: str = "https://restapi.amap.com/v3/geocode/regeo"
    amap_timeout_seconds: float = 5.0
    public_base_url: str = ""
    media_root: str = "storage"
    media_url_prefix: str = "/media"
    client_cache_version: str = Field(default="1", validation_alias="CLIENT_CACHE_VERSION")

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def reject_insecure_production_defaults(self) -> "Settings":
        if self.environment.strip().lower() != "production":
            return self
        insecure = {
            "DATABASE_URL": self.database_url.startswith("sqlite:") or "password@" in self.database_url,
            "JWT_SECRET_KEY": not self.jwt_secret_key or "change-me" in self.jwt_secret_key,
            "USER_INVITE_CODE": not self.user_invite_code,
            "ADMIN_INVITE_CODE": not self.admin_invite_code,
        }
        invalid = [name for name, failed in insecure.items() if failed]
        if invalid:
            raise ValueError(
                "Production configuration is missing secure values for: " + ", ".join(invalid)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""

    s = Settings()
    env_test = _BACKEND_DIR / ".env.test"
    if env_test.is_file() and env_test.stat().st_size == 0:
        import logging

        logging.getLogger("dragon.reserve").warning(
            "backend/.env.test exists but is empty (0 bytes). Save the file in your editor or WECHAT_* will stay unset."
        )
    return s
