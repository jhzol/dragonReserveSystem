"""Small QWeather HTTP/JWT client used only by refresh jobs."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.config import get_settings

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class QWeatherClient:
    """Authenticated QWeather transport. It never logs credentials or payloads."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._private_key: Ed25519PrivateKey | None = None
        self._token: str | None = None
        self._token_expires_at = 0
        self._client = httpx.Client(timeout=self.settings.qweather_timeout_seconds)

    def is_configured(self) -> bool:
        return all((
            self.settings.qweather_developer_id,
            self.settings.qweather_project_id,
            self.settings.qweather_credential_id,
            self.settings.qweather_api_host,
            self.settings.qweather_private_key_path,
        ))

    def _resolve_private_key_path(self) -> Path:
        configured = Path(self.settings.qweather_private_key_path)
        return configured if configured.is_absolute() else _BACKEND_DIR / configured

    def _load_private_key(self) -> Ed25519PrivateKey:
        if self._private_key is None:
            key = serialization.load_pem_private_key(self._resolve_private_key_path().read_bytes(), password=None)
            if not isinstance(key, Ed25519PrivateKey):
                raise ValueError("QWeather private key must be Ed25519")
            self._private_key = key
        return self._private_key

    def _build_token(self) -> str:
        now = int(time.time())
        if self._token and now < self._token_expires_at - 60:
            return self._token
        header = {"alg": "EdDSA", "kid": self.settings.qweather_credential_id}
        payload = {
            "sub": self.settings.qweather_project_id,
            "iss": self.settings.qweather_developer_id,
            "iat": now - 30,
            "exp": now + 900,
        }
        encoded_header = _base64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        encoded_payload = _base64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        self._token = f"{encoded_header}.{encoded_payload}.{_base64url(self._load_private_key().sign(signing_input))}"
        self._token_expires_at = now + 900
        return self._token

    def request_json(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.is_configured():
            raise RuntimeError("QWeather is not configured")
        host = self.settings.qweather_api_host.strip().replace("https://", "").replace("http://", "").rstrip("/")
        response = self._client.get(
            f"https://{host}{path}",
            params=params,
            headers={"Authorization": f"Bearer {self._build_token()}"},
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and str(payload.get("code", "200")) not in {"200", "0"}:
            raise RuntimeError(f"QWeather returned code {payload.get('code')}")
        return payload

    def get_daily_weather(self, *, longitude: float, latitude: float) -> dict[str, Any]:
        return self.request_json(
            "/v7/weather/30d",
            params={"location": f"{longitude:.6f},{latitude:.6f}", "lang": "zh"},
        )

    def get_daily_air_quality(self, *, longitude: float, latitude: float) -> dict[str, Any]:
        return self.request_json(f"/airquality/v1/daily/{latitude:.6f}/{longitude:.6f}")

    def close(self) -> None:
        self._client.close()
