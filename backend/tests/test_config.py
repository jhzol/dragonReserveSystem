import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_development_security_defaults():
    with pytest.raises(ValidationError, match="Production configuration is missing secure values"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            database_url="sqlite:///./dragon_reserve_dev.db",
            jwt_secret_key="dev-only-change-me",
            user_invite_code="",
            admin_invite_code="",
        )


def test_production_accepts_explicit_secure_configuration():
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        database_url="mysql+pymysql://service:strong-secret@database/dragon_reserve",
        jwt_secret_key="a-production-secret-that-is-not-a-default",
        user_invite_code="configured-user-code",
        admin_invite_code="configured-admin-code",
    )

    assert settings.environment == "production"
