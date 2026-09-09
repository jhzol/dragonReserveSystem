"""Build separate, content-versioned Q90 assets; never modify source images."""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'app/assets/activity-covers'

def build():
    catalog = json.loads((ROOT / 'catalog.json').read_text())
    manifest = {}
    for artist in catalog['artists']:
        paths = [artist['avatar_path']]
        for artwork in artist['artworks']:
            paths += [artwork[k] for k in ('image_path', 'thumbnail_path', 'glass_path') if artwork.get(k)]
        for relative in paths:
            if relative in manifest:
                continue
            source = ROOT / relative
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            dest = ROOT / 'webp-q90-v1' / Path(relative).with_suffix('.webp')
            dest.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['cwebp', '-quiet', '-q', '90', '-m', '6', '-sharp_yuv', str(source), '-o', str(dest)], check=True)
            with Image.open(source) as old, Image.open(dest) as new:
                new.load()
                assert old.size == new.size, relative
            assert hashlib.sha256(source.read_bytes()).hexdigest() == before
            manifest[relative] = {'path': str(dest.relative_to(ROOT)), 'source_sha256': before,
                'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
                'source_bytes': source.stat().st_size, 'bytes': dest.stat().st_size}
    (ROOT / 'webp-q90-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'count': len(manifest), 'original_bytes': sum(v['source_bytes'] for v in manifest.values()),
        'webp_bytes': sum(v['bytes'] for v in manifest.values())}))

if __name__ == '__main__':
    build()
