from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROTOTYPE_ASSETS = PROJECT_ROOT / "prototype" / "图片素材"
EXPECTED_LARGE_URL = "https://dragon.liqqihome.top/media/images/card-bg-other-v2-lg.jpg"
EXPECTED_SMALL_URL = "https://dragon.liqqihome.top/media/images/card-bg-other-v2-sm.jpg"


def test_other_activity_background_assets_and_configs_stay_in_sync() -> None:
    large_path = PROTOTYPE_ASSETS / "card-bg-other-v2-lg.jpg"
    small_path = PROTOTYPE_ASSETS / "card-bg-other-v2-sm.jpg"
    with Image.open(large_path) as large_image:
        assert large_image.size == (768, 1024)
    with Image.open(small_path) as small_image:
        assert small_image.size == (828, 828)

    for relative_path in (
        "miniprogram/pages/activity_list/activity_list.js",
        "miniprogram/utils/activityEnrich.js",
        "backend/app/services/activity_type_style_service.py",
    ):
        source = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
        assert EXPECTED_LARGE_URL in source
        assert EXPECTED_SMALL_URL in source

    for relative_path in (
        "miniprogram/pages/activity_list/activity_list.js",
        "miniprogram/utils/activityEnrich.js",
    ):
        source = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
        assert "/activities/type-styles/" not in source

    glass_service = (
        PROJECT_ROOT / "backend/app/services/activity_card_glass_service.py"
    ).read_text(encoding="utf-8")
    assert 'CARD_GLASS_RENDER_VERSION = "v3"' in glass_service
