"""Bound anonymous telemetry before parsing; never collect IPs or credentials."""
import time
from collections import deque
from starlette.responses import JSONResponse


class DiagnosticBodyGuard:
    def __init__(self, app):
        self.app = app
        self.accepted = deque()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].endswith('/diagnostics/anonymous-client-logs/batch'):
            return await self.app(scope, receive, send)
        now = time.monotonic()
        while self.accepted and self.accepted[0] < now - 60:
            self.accepted.popleft()
        # Global per-worker cap, intentionally no per-device/IP identifiers.
        if len(self.accepted) >= 60:
            return await JSONResponse({'detail': 'Diagnostic rate limit'}, status_code=429)(scope, receive, send)
        self.accepted.append(now)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > 128 * 1024:
                return await JSONResponse({'detail': 'Diagnostic body too large'}, status_code=413)(scope, receive, send)
            if not message.get('more_body', False):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)
