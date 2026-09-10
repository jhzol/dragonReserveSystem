"""Standalone asset/delivery tests: python3 -m unittest discover -s backend/tests -p test_cover_jpeg_delivery.py."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND / 'app/assets/activity-covers'


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class JpegDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.settings = types.SimpleNamespace(activity_cover_cdn_base_url='')
        config = types.ModuleType('app.core.config')
        config.get_settings = lambda: self.settings
        with patch.dict('sys.modules', {'app.core.config': config}):
            self.service = module_at('jpeg_delivery_under_test', BACKEND / 'app/services/activity_cover_service.py')
        self.env = patch.dict(os.environ, {'ACTIVITY_COVER_JPEG_ENABLED': '0', 'ACTIVITY_COVER_WEBP_ENABLED': '0'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_all_assets_match_manifest_and_original_dimensions(self):
        manifest = json.loads((ROOT / 'jpeg-q88-manifest.json').read_text())
        self.assertEqual(len(manifest), 287)
        for source, record in manifest.items():
            with self.subTest(source=source):
                old, new = ROOT / source, ROOT / record['path']
                self.assertEqual(hashlib.sha256(old.read_bytes()).hexdigest(), record['source_sha256'])
                self.assertEqual(hashlib.sha256(new.read_bytes()).hexdigest(), record['sha256'])
                self.assertLessEqual(new.stat().st_size, old.stat().st_size)
                with Image.open(old) as a, Image.open(new) as b:
                    b.load()
                    self.assertEqual(a.size, b.size)
                    self.assertEqual(b.format, 'JPEG')

    def test_disabled_preserves_original_urls(self):
        artists = self.service.list_activity_cover_artists('https://origin.example')
        self.assertNotIn('jpeg-q88-v1', json.dumps(artists))
        self.assertNotIn('webp-q90-v1', json.dumps(artists))

    def test_enabled_all_fields_versioned_and_sources_original(self):
        os.environ['ACTIVITY_COVER_JPEG_ENABLED'] = '1'
        artists = self.service.list_activity_cover_artists('https://origin.example')
        self.assertEqual(sum(len(a['artworks']) for a in artists), 93)
        for artist in artists:
            self.assertIn('/jpeg-q88-v1/', artist['avatar_url'])
            for artwork in artist['artworks']:
                for field in ('image_url', 'thumbnail_url', 'large_card_glass_image_url', 'artist_avatar_url'):
                    url = artwork[field]
                    self.assertIn('/jpeg-q88-v1/', url)
                    self.assertIn('.jpg?v=', url)
                self.assertNotIn('jpeg-q88-v1', str(self.service.get_activity_cover_source_path(artwork['id'])))

    def test_jpeg_takes_precedence_over_webp(self):
        os.environ.update(ACTIVITY_COVER_JPEG_ENABLED='1', ACTIVITY_COVER_WEBP_ENABLED='1')
        self.assertNotIn('.webp', json.dumps(self.service.list_activity_cover_artists()))

    def test_cdn_prefix_preserved(self):
        os.environ['ACTIVITY_COVER_JPEG_ENABLED'] = '1'
        self.settings.activity_cover_cdn_base_url = 'https://cdn.example/release'
        self.assertTrue(self.service.list_activity_cover_artists()[0]['artworks'][0]['image_url'].startswith('https://cdn.example/release/jpeg-q88-v1/'))

    def test_missing_manifest_falls_back(self):
        os.environ['ACTIVITY_COVER_JPEG_ENABLED'] = '1'
        with tempfile.TemporaryDirectory() as directory:
            self.service.ASSET_ROOT = Path(directory)
            self.assertEqual(self.service._delivery_url('a.jpg'), '/activity-cover-assets/a.jpg')

    def test_build_is_repeatable_and_refuses_overwrite(self):
        builder = module_at('jpeg_builder_under_test', BACKEND / 'scripts/build_cover_jpeg.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new('RGB', (64, 48), (123, 99, 71)).save(root / 'a.jpg', quality=98)
            source = (root / 'a.jpg').read_bytes()
            (root / 'catalog.json').write_text(json.dumps({'artists': [{'avatar_path': 'a.jpg', 'artworks': []}]}))
            builder.build(root)
            builder.build(root)
            self.assertEqual((root / 'a.jpg').read_bytes(), source)
            (root / builder.RELEASE / 'a.jpg').write_bytes(b'preserve-existing')
            with self.assertRaisesRegex(ValueError, 'immutable'):
                builder.build(root)
            self.assertEqual((root / builder.RELEASE / 'a.jpg').read_bytes(), b'preserve-existing')


if __name__ == '__main__':
    unittest.main()
