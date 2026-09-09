"""Build immutable JPEG delivery assets without overwriting source images.

Q88, original dimensions and chroma sampling, optimized baseline JPEG.
Use lossless coefficient optimization instead when smaller than re-encoding.
"""
import hashlib
import io
import json
import subprocess
from pathlib import Path
from PIL import Image, JpegImagePlugin

ROOT = Path(__file__).resolve().parents[1] / 'app/assets/activity-covers'
RELEASE = 'jpeg-q88-v1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(source):
    original = source.read_bytes()
    lossless = subprocess.run(['jpegtran', '-copy', 'all', '-optimize', str(source)],
                              check=True, capture_output=True).stdout
    with Image.open(io.BytesIO(original)) as image:
        image.load()
        if image.format != 'JPEG' or image.mode != 'RGB':
            raise ValueError(f'Expected RGB JPEG: {source}')
        sampling = JpegImagePlugin.get_sampling(image)
        if sampling not in (0, 1, 2):
            raise ValueError(f'Unknown sampling: {source}')
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=88, subsampling=sampling,
                   optimize=True, progressive=False,
                   icc_profile=image.info.get('icc_profile'),
                   exif=image.info.get('exif', b''))
        candidates = [('original-copy', original), ('lossless-optimized', lossless),
                      ('jpeg-q88', output.getvalue())]
        method, data = min(candidates, key=lambda item: len(item[1]))
        with Image.open(io.BytesIO(data)) as check:
            check.load()
            if check.format != 'JPEG' or check.size != image.size:
                raise ValueError(f'Invalid output: {source}')
    return data, method


def build(root=ROOT):
    catalog = json.loads((root / 'catalog.json').read_text())
    manifest = {}
    for artist in catalog['artists']:
        paths = [artist['avatar_path']]
        for artwork in artist['artworks']:
            paths += [artwork[k] for k in ('image_path', 'thumbnail_path', 'glass_path') if artwork.get(k)]
        for relative in paths:
            if relative in manifest:
                continue
            source = root / relative
            original = source.read_bytes()
            data, method = encode(source)
            dest = root / RELEASE / relative
            if dest.exists() and dest.read_bytes() != data:
                raise ValueError(f'Release is immutable; choose a new RELEASE: {dest}')
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                dest.write_bytes(data)
            if source.read_bytes() != original:
                raise ValueError(f'Source changed: {source}')
            manifest[relative] = {'path': str(dest.relative_to(root)), 'source_sha256': digest(original),
                                  'sha256': digest(data), 'source_bytes': len(original),
                                  'bytes': len(data), 'method': method}
    manifest_path = root / 'jpeg-q88-manifest.json'
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if manifest_path.exists() and manifest_path.read_text() != text:
        raise ValueError('Manifest is immutable; choose a new manifest filename')
    manifest_path.write_text(text)
    print(json.dumps({'count': len(manifest), 'original_bytes': sum(v['source_bytes'] for v in manifest.values()),
                      'delivery_bytes': sum(v['bytes'] for v in manifest.values())}))


if __name__ == '__main__':
    build()
