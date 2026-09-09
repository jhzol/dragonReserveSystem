"""Isolated Caddy 2.6.2 regression test; no production config reload.

Usage: python3 validate-cover-request-correlation.py /path/to/probe.caddy
Uses loopback ports 18989/18990; leaves evidence in a private temporary directory.
"""
import http.client
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


def main():
    assert subprocess.check_output(['caddy', 'version'], text=True).strip() == '2.6.2'
    work = pathlib.Path(tempfile.mkdtemp(prefix='dragon-correlation-validation-'))
    log = work / 'access.jsonl'
    config = work / 'probe.caddy'
    config.write_text(pathlib.Path(sys.argv[1]).read_text().replace(
        '/tmp/dragon-correlation-probe-20260909/access.jsonl', str(log)))
    received = []
    class Backend(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            received.append({'path': self.path, 'headers': dict(self.headers), 'method': self.command})
            self.send_response(200)
            self.send_header('X-Request-Id', self.headers.get('X-Request-Id', ''))
            self.send_header('X-Untrusted-Sentinel', 'response-private-sentinel')
            self.send_header('Set-Cookie', 'response-cookie-sentinel')
            self.send_header('Content-Length', '5')
            self.end_headers()
            self.wfile.write(b'probe')
    server = HTTPServer(('127.0.0.1', 18990), Backend)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    process = None
    try:
        adapted = subprocess.check_output(['caddy', 'adapt', '--config', str(config), '--adapter', 'caddyfile'], stderr=subprocess.PIPE)
        (work / 'adapted.json').write_bytes(adapted)
        with (work / 'process.log').open('wb') as output:
            process = subprocess.Popen(['caddy', 'run', '--config', str(config), '--adapter', 'caddyfile'], stdout=output, stderr=output, env={**os.environ, 'XDG_CONFIG_HOME': str(work / 'config'), 'XDG_DATA_HOME': str(work / 'data')})
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('isolated Caddy exited; inspect ' + str(work / 'process.log'))
            try:
                c = http.client.HTTPConnection('127.0.0.1', 18989, timeout=1)
                c.request('GET', '/health')
                r = c.getresponse(); r.read(); c.close()
                break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('isolated Caddy did not start')
        records = []
        cases = [
            ('/activity-cover-assets/author/images/picture.jpg', 'hm-mttj9bcz-4-dipg4ly1bf', 'hm-mttj9bcz-4-dipg4ly1bf'),
            ('/api/v2/activity-covers/author-001/glass-image', 'hm-mttjvjuk-3-ukhcr76qca', 'hm-mttjvjuk-3-ukhcr76qca'),
            ('/activity-cover-assets/author/images/picture.jpg?token=query-private-sentinel', 'hm-mttj9bcz-4-dipg4ly1bf', 'hm-mttj9bcz-4-dipg4ly1bf'),
            ('/activity-cover-assets/a.jpg', '', ''),
            ('/activity-cover-assets/a.jpg', 'token-private-sentinel', ''),
            ('/activity-cover-assets/a.jpg', 'hm-mttj9bcz-4-dipg4ly1bf, token-private-sentinel', ''),
            ('/activity-cover-assets/a.jpg', 'hm-' + 'x' * 300, ''),
            ('/activity-cover-assets/a.jpg', 'hm-mttj9bcz-4-192.0.2.123', ''),
            ('/activity-cover-assets/a.jpg', 'hm-mttj9bcz-4-secret@example.invalid', ''),
            ('/api/v1/activities', 'hm-mttj9bcz-4-dipg4ly1bf', None),
            ('/test-api/health', 'hm-mttj9bcz-4-dipg4ly1bf', None),
            ('/static/avatar.png', 'hm-mttj9bcz-4-dipg4ly1bf', None),
        ]
        for path, rid, expected in cases:
            headers = {'Authorization': 'Bearer request-private-sentinel', 'Cookie': 'request-cookie-sentinel',
                       'X-Arbitrary-Private-Header': 'other-private-sentinel'}
            if rid: headers['X-Request-Id'] = rid
            before = len(received)
            c = http.client.HTTPConnection('127.0.0.1', 18989, timeout=3)
            c.request('GET', path, headers=headers)
            r = c.getresponse(); body = r.read(); response_headers = dict(r.getheaders()); c.close()
            assert r.status == 200 and body == b'probe'
            assert len(received) == before + 1
            actual = received[-1]
            assert actual['path'] == path and actual['method'] == 'GET'
            for key, value in headers.items(): assert actual['headers'][key] == value
            assert response_headers['X-Request-Id'] == rid
            assert response_headers['Set-Cookie'] == 'response-cookie-sentinel'
            if expected is not None: records.append(expected)
        for _ in range(100):
            rows = [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
            if len(rows) >= len(records): break
            time.sleep(.05)
        assert len(rows) == len(records), (len(rows), len(records))
        assert [r['request_id'] for r in rows] == records
        allowed = {'ts', 'level', 'logger', 'msg', 'request_id', 'duration', 'size', 'status'}
        for r in rows:
            assert set(r) <= allowed and r['status'] == 200 and r['size'] == 5
            assert r['msg'] == 'handled request'
        text = log.read_text()
        for bad in ('private-sentinel', 'cookie-sentinel', '192.0.2.123', '@example', 'Authorization', 'Cookie', '127.0.0.1', 'picture.jpg'):
            assert bad not in text, bad
        report = {'passed': True, 'cases': len(cases), 'logged_cover_requests': len(rows),
                  'request_response_unchanged': True, 'malformed_ids_redacted': True,
                  'non_cover_requests_not_logged': True, 'log_keys': sorted(set().union(*(set(r) for r in rows))),
                  'evidence_directory': str(work)}
        (work / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
