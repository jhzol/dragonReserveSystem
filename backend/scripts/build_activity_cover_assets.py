"""Build deployable activity-cover images and catalog from the local inbox.

The source inbox is intentionally gitignored. This script creates optimized JPEG
assets under ``backend/app/assets/activity-covers`` so the API can serve them
without putting the original 50+ MB PNG collection in the mini-program package.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = PROJECT_ROOT / ".local-assets" / "activity-cover-inbox"
OUTPUT_ROOT = PROJECT_ROOT / "backend" / "app" / "assets" / "activity-covers"
ARTIST_ORDER = [
    "aleksey-rico",
    "lam",
    "ardhira-putra",
    "magoyama",
    "yoneyama-mai",
    "benjamin-flouw",
    "venmen",
    "patryk-wojciechowicz",
]


def save_jpeg(source: Path, destination: Path, *, max_size: tuple[int, int], quality: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        image.save(destination, "JPEG", quality=quality, optimize=True, progressive=True)


def save_glass_jpeg(source: Path, destination: Path) -> None:
    """Build the exact card-width blur once so API requests only serve a file."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((531, 708), Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.GaussianBlur(radius=6.5))
        image.save(destination, "JPEG", quality=80, optimize=True, progressive=True)


def build() -> dict[str, object]:
    if not SOURCE_ROOT.is_dir():
        raise FileNotFoundError(f"activity cover inbox not found: {SOURCE_ROOT}")

    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    OUTPUT_ROOT.mkdir(parents=True)

    artists: list[dict[str, object]] = []
    for artist_slug in ARTIST_ORDER:
        artist_root = SOURCE_ROOT / artist_slug
        metadata = json.loads((artist_root / "metadata.json").read_text(encoding="utf-8"))
        author = metadata["author"]
        avatar_name = "avatar.jpg"
        save_jpeg(
            artist_root / author["avatar"]["file"],
            OUTPUT_ROOT / artist_slug / avatar_name,
            max_size=(112, 112),
            quality=86,
        )

        artworks: list[dict[str, object]] = []
        for artwork in metadata["artworks"]:
            artwork_id = artwork["id"]
            source = artist_root / artwork["file"]
            thumb_name = f"thumbs/{artwork_id}.jpg"
            image_name = f"images/{artwork_id}.jpg"
            glass_name = f"glass/{artwork_id}.jpg"
            save_jpeg(source, OUTPUT_ROOT / artist_slug / thumb_name, max_size=(360, 360), quality=82)
            save_jpeg(source, OUTPUT_ROOT / artist_slug / image_name, max_size=(1440, 1440), quality=88)
            save_glass_jpeg(source, OUTPUT_ROOT / artist_slug / glass_name)
            artworks.append(
                {
                    "id": artwork_id,
                    "width": artwork["width"],
                    "height": artwork["height"],
                    "thumbnail_path": f"{artist_slug}/{thumb_name}",
                    "image_path": f"{artist_slug}/{image_name}",
                    "glass_path": f"{artist_slug}/{glass_name}",
                }
            )

        artists.append(
            {
                "slug": artist_slug,
                "display_name": author["display_name"],
                "avatar_path": f"{artist_slug}/{avatar_name}",
                "artworks": artworks,
            }
        )

    catalog = {"schema_version": 1, "artists": artists}
    (OUTPUT_ROOT / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return catalog


if __name__ == "__main__":
    result = build()
    artwork_count = sum(len(artist["artworks"]) for artist in result["artists"])
    print(f"built {len(result['artists'])} artists / {artwork_count} artworks at {OUTPUT_ROOT}")
