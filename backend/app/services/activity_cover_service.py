"""Catalog and validation for the version-2 activity-cover feature."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ASSET_ROOT = Path(__file__).resolve().parents[1] / "assets" / "activity-covers"
CATALOG_PATH = ASSET_ROOT / "catalog.json"
PUBLIC_PREFIX = "/activity-cover-assets"
FEATURED_ARTIST_SLUGS = (
    "yoneyama-mai",
    "patryk-wojciechowicz",
    "ardhira-putra",
)


@lru_cache(maxsize=1)
def _catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def _ordered_catalog_artists() -> list[dict[str, Any]]:
    catalog_artists = list(_catalog()["artists"])
    artists_by_slug = {artist["slug"]: artist for artist in catalog_artists}
    featured_artists = [
        artists_by_slug[slug]
        for slug in FEATURED_ARTIST_SLUGS
        if slug in artists_by_slug
    ]
    featured_slugs = set(FEATURED_ARTIST_SLUGS)
    return featured_artists + [
        artist for artist in catalog_artists if artist["slug"] not in featured_slugs
    ]


def _public_url(path: str, base_url: str = "") -> str:
    relative = f"{PUBLIC_PREFIX}/{path.lstrip('/')}"
    return f"{base_url.rstrip('/')}{relative}" if base_url else relative


def list_activity_cover_artists(base_url: str = "") -> list[dict[str, Any]]:
    artists: list[dict[str, Any]] = []
    for artist in _ordered_catalog_artists():
        artists.append(
            {
                "slug": artist["slug"],
                "display_name": artist["display_name"],
                "avatar_url": _public_url(artist["avatar_path"], base_url),
                "artworks": [
                    {
                        "id": artwork["id"],
                        "artist_slug": artist["slug"],
                        "artist_name": artist["display_name"],
                        "artist_avatar_url": _public_url(artist["avatar_path"], base_url),
                        "width": artwork["width"],
                        "height": artwork["height"],
                        "thumbnail_url": _public_url(artwork["thumbnail_path"], base_url),
                        "image_url": _public_url(artwork["image_path"], base_url),
                        "large_card_glass_image_url": (
                            f"{base_url.rstrip('/')}/api/v2/activity-covers/"
                            f"{artwork['id']}/glass-image?v=2"
                            if base_url
                            else f"/api/v2/activity-covers/{artwork['id']}/glass-image?v=2"
                        ),
                    }
                    for artwork in artist["artworks"]
                ],
            }
        )
    return artists


def get_activity_cover(cover_id: str | None, base_url: str = "") -> dict[str, Any] | None:
    normalized = str(cover_id or "").strip()
    if not normalized:
        return None
    for artist in list_activity_cover_artists(base_url):
        for artwork in artist["artworks"]:
            if artwork["id"] == normalized:
                return artwork
    return None


def get_activity_cover_source_path(cover_id: str | None) -> Path | None:
    """Resolve one trusted catalog artwork to its local full-size asset."""

    normalized = str(cover_id or "").strip()
    if not normalized:
        return None
    for artist in _catalog()["artists"]:
        for artwork in artist["artworks"]:
            if artwork["id"] != normalized:
                continue
            source = (ASSET_ROOT / artwork["image_path"]).resolve()
            try:
                source.relative_to(ASSET_ROOT.resolve())
            except ValueError:
                return None
            return source if source.is_file() else None
    return None


def get_activity_cover_glass_source_path(cover_id: str | None) -> Path | None:
    """Resolve the build-time glass asset for one trusted cover."""

    normalized = str(cover_id or "").strip()
    if not normalized:
        return None
    for artist in _catalog()["artists"]:
        for artwork in artist["artworks"]:
            if artwork["id"] != normalized or not artwork.get("glass_path"):
                continue
            source = (ASSET_ROOT / artwork["glass_path"]).resolve()
            try:
                source.relative_to(ASSET_ROOT.resolve())
            except ValueError:
                return None
            return source if source.is_file() else None
    return None


def require_activity_cover_id(cover_id: str | None) -> str:
    normalized = str(cover_id or "").strip()
    if not normalized or get_activity_cover(normalized) is None:
        raise ValueError("activity_cover_id is invalid")
    return normalized
