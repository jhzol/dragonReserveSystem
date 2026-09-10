"""ASGI body-send observation, not a claim of client receipt or screen paint."""
import json
import re
import time
from app.core.logging import logger


class ImageTransferDiagnostics:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not (path.startswith('/activity-cover-assets/') or
                (path.startswith('/api/v2/activity-covers/') and path.endswith('/glass-image'))):
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        request_id = headers.get(b'x-request-id', b'').decode('ascii', errors='ignore')
        if not re.fullmatch(r'hm-[a-zA-Z0-9_-]{1,90}', request_id):
            return await self.app(scope, receive, send)
        started = time.monotonic()
        status = None
        body_bytes = 0
        body_finished = False
        first_body_ms = None

        async def observe(message):
            nonlocal status, body_bytes, body_finished, first_body_ms
            if message['type'] == 'http.response.start':
                status = message['status']
            await send(message)
            if message['type'] == 'http.response.body':
                body_bytes += len(message.get('body', b''))
                if first_body_ms is None:
                    first_body_ms = round((time.monotonic() - started) * 1000, 2)
                body_finished = not message.get('more_body', False)

        try:
            await self.app(scope, receive, observe)
        finally:
            logger.info('image_transfer %s', json.dumps({
                'request_id': request_id, 'status': status, 'bytes_sent_to_asgi': body_bytes,
                'asgi_body_finished': body_finished, 'first_body_ms': first_body_ms,
                'duration_ms': round((time.monotonic() - started) * 1000, 2),
                'route': 'static_cover' if path.startswith('/activity-cover-assets/') else 'glass_image',
                'client_receipt': 'unobservable',
            }, separators=(',', ':')))
