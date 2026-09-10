from app.services import activity_cover_service as covers
from app.core.config import get_settings
import pytest


def test_disabled_cdn_preserves_origin(monkeypatch):
    monkeypatch.setattr(get_settings(), "activity_cover_cdn_base_url", "")
    assert covers._public_url("artist/images/a.jpg", "https://origin.example") == "https://origin.example/activity-cover-assets/artist/images/a.jpg"


def test_cdn_applies_to_all_catalog_resources(monkeypatch):
    monkeypatch.setattr(get_settings(), "activity_cover_cdn_base_url", "https://cdn.example/covers/release-1/")
    for artist in covers.list_activity_cover_artists("https://origin.example"):
        assert artist["avatar_url"].startswith("https://cdn.example/covers/release-1/")
        for artwork in artist["artworks"]:
            for key in ("image_url", "thumbnail_url", "large_card_glass_image_url"):
                assert artwork[key].startswith("https://cdn.example/covers/release-1/")


@pytest.mark.parametrize("url", ["http://cdn.example", "https://user:secret@cdn.example", "https://cdn.example?x=1"])
def test_invalid_cdn_rejected(monkeypatch, url):
    monkeypatch.setattr(get_settings(), "activity_cover_cdn_base_url", url)
    with pytest.raises(ValueError):
        covers._public_url("a.jpg")
