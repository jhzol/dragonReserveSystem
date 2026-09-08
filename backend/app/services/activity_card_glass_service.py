from __future__ import annotations

"""Server-side pre-rendering for the large-card glass backdrop."""

from hashlib import md5
from io import BytesIO
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageFilter, ImageOps

from app.core.config import get_settings
from app.services.activity_cover_service import (
    get_activity_cover_glass_source_path,
    get_activity_cover_source_path,
)
from app.services.activity_type_style_service import get_activity_style


settings = get_settings()
MEDIA_ROOT = Path(settings.media_root).resolve()
CARD_GLASS_CACHE_DIR = MEDIA_ROOT / "card-glass"
CARD_GLASS_RENDER_VERSION = "v3"
CARD_GLASS_REMOTE_IMAGE_TIMEOUT = 8.0
# The previous 13px Pillow radius was visually calibrated against Pencil's
# former 24px background blur. Pencil is now 12px, so preserve that calibration
# ratio and halve the equivalent Pillow radius to 6.5px at the reference width.
CARD_GLASS_BLUR_RADIUS_RATIO = 6.5 / (530.77 * 420 / 750)


class ActivityCardGlassNotFoundError(ValueError):
    """Raised when the requested fixed activity type/style has no large image."""


def get_or_create_activity_card_glass(activity_type: str, style_key: str) -> Path:
    """Return a cached, pre-blurred image for one trusted activity style."""

    try:
        style = get_activity_style(activity_type, style_key)
    except ValueError as exc:
        raise ActivityCardGlassNotFoundError("activity type/style not found") from exc
    if not style:
        raise ActivityCardGlassNotFoundError("activity type/style not found")

    source = str(style.get("large_card_bg_image_url") or "").strip()
    if not source:
        raise ActivityCardGlassNotFoundError("large card background image not found")

    return _get_or_create_card_glass(
        source,
        cache_identity=f"legacy-style|{activity_type}|{style_key}|{source}",
    )


def get_or_create_activity_cover_card_glass(cover_id: str) -> Path:
    """Return the cached large-card glass image for a v2 activity cover."""

    prebuilt_path = get_activity_cover_glass_source_path(cover_id)
    if prebuilt_path is not None:
        return prebuilt_path
    source_path = get_activity_cover_source_path(cover_id)
    if source_path is None:
        raise ActivityCardGlassNotFoundError("activity cover not found")
    return _get_or_create_card_glass(
        str(source_path),
        cache_identity=f"activity-cover|{cover_id}|{source_path}",
    )


def _get_or_create_card_glass(source: str, cache_identity: str) -> Path:
    cache_key = md5(
        f"{CARD_GLASS_RENDER_VERSION}|{cache_identity}".encode("utf-8")
    ).hexdigest()
    target = CARD_GLASS_CACHE_DIR / f"{cache_key}.png"
    if target.is_file() and target.stat().st_size > 0:
        return target

    source_image = _load_source_image(source)
    rendered = _render_blurred_image(source_image)
    CARD_GLASS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Save in the target directory and atomically publish, so concurrent first
    # requests never observe a partially written image.
    with NamedTemporaryFile(
        prefix=f".{cache_key}-",
        suffix=".png",
        dir=CARD_GLASS_CACHE_DIR,
        delete=False,
    ) as temp_file:
        temp_path = Path(temp_file.name)
    try:
        rendered.save(temp_path, format="PNG", optimize=True)
        os.replace(temp_path, target)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return target


def _render_blurred_image(source: Image.Image) -> Image.Image:
    """Blur once on a mirror-extended bitmap, then crop back to source size."""

    image = ImageOps.exif_transpose(source).convert("RGB")
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("invalid source image dimensions")

    radius = max(1.0, width * CARD_GLASS_BLUR_RADIUS_RATIO)
    padding = max(1, min(math.ceil(radius * 3), width, height))
    extended = Image.new("RGB", (width + padding * 2, height + padding * 2))
    extended.paste(image, (padding, padding))

    extended.paste(
        image.crop((0, 0, padding, height)).transpose(Image.Transpose.FLIP_LEFT_RIGHT),
        (0, padding),
    )
    extended.paste(
        image.crop((width - padding, 0, width, height)).transpose(Image.Transpose.FLIP_LEFT_RIGHT),
        (padding + width, padding),
    )
    extended.paste(
        image.crop((0, 0, width, padding)).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (padding, 0),
    )
    extended.paste(
        image.crop((0, height - padding, width, height)).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (padding, padding + height),
    )

    extended.paste(
        image.crop((0, 0, padding, padding))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        .transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (0, 0),
    )
    extended.paste(
        image.crop((width - padding, 0, width, padding))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        .transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (padding + width, 0),
    )
    extended.paste(
        image.crop((0, height - padding, padding, height))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        .transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (0, padding + height),
    )
    extended.paste(
        image.crop((width - padding, height - padding, width, height))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        .transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (padding + width, padding + height),
    )

    blurred = extended.filter(ImageFilter.GaussianBlur(radius=radius))
    return blurred.crop((padding, padding, padding + width, padding + height))


def _load_source_image(source: str) -> Image.Image:
    local_path = _resolve_local_media_path(source)
    if local_path and local_path.is_file():
        with Image.open(local_path) as image:
            return image.copy()

    response = httpx.get(
        source,
        timeout=httpx.Timeout(CARD_GLASS_REMOTE_IMAGE_TIMEOUT, connect=2.0),
        follow_redirects=True,
        headers={"User-Agent": "dragonReserveSystem-card-glass/1.0"},
    )
    response.raise_for_status()
    with Image.open(BytesIO(response.content)) as image:
        return image.copy()


def _resolve_local_media_path(source: str) -> Path | None:
    value = str(source or "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    candidate_path = parsed.path or value
    media_prefix = settings.media_url_prefix.rstrip("/")
    if candidate_path.startswith(media_prefix + "/"):
        relative_path = candidate_path[len(media_prefix) + 1 :]
        return MEDIA_ROOT / relative_path
    local_path = Path(value)
    if local_path.is_absolute():
        return local_path
    return None
