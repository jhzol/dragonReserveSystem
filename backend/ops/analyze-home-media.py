#!/usr/bin/env python3
"""Read-only, offline join of existing mobile, ASGI and gateway evidence.

No user IDs, IPs, credentials, raw URLs or raw error text are emitted. Missing
profiles remain unknown; ASGI/gateway completion is not client receipt proof.
"""
import argparse
import json
import re
from pathlib import Path

REQUEST_ID = re.compile(r'^hm-[0-9a-z]{8,12}-[0-9a-z]{1,6}-[0-9a-z]{6,16}$')


def delta(profile, start, end):
    a, b = profile.get(start), profile.get(end)
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return None
    return b - a if 0 <= a <= b else None


def analyze(application, gateway, since=0):
    requests, asgi, seen = {}, {}, set()
    for line in application:
        if 'image_transfer ' in line:
            try:
                event = json.loads(line.split('image_transfer ', 1)[1])
            except (ValueError, IndexError):
                continue
            rid = event.get('request_id', '')
            if REQUEST_ID.fullmatch(rid):
                asgi[rid] = {key: event[key] for key in (
                    'duration_ms', 'bytes_sent_to_asgi', 'asgi_body_finished', 'status'
                ) if key in event}
        if 'client_diagnostic ' not in line:
            continue
        try:
            event = json.loads(line.split('client_diagnostic ', 1)[1])
        except (ValueError, IndexError):
            continue
        payload = event.get('payload', {})
        if event.get('system_type') == 'devtools' or payload.get('occurredAt', 0) < since:
            continue
        if event.get('event') != 'home_media_attempt':
            continue
        event_id = payload.get('diagnosticEventId')
        if event_id and event_id in seen:
            continue
        if event_id:
            seen.add(event_id)
        evidence = payload.get('evidence', {})
        rid = evidence.get('requestId', '')
        if not REQUEST_ID.fullmatch(rid):
            continue
        row = requests.setdefault(rid, {'request_id': rid, 'system': event.get('system_type'),
                                        'stages': [], 'last_occurred_at': 0})
        stage = payload.get('stage')
        if stage in ('attempt_succeeded', 'attempt_failed', 'logical_timeout', 'hard_timeout',
                     'page_cancelled', 'preparation_cancel_requested', 'retry_exhausted'):
            if stage not in row['stages']:
                row['stages'].append(stage)
        # Retry delivery can be out of order; never replace newer byte evidence.
        if payload.get('occurredAt', 0) >= row['last_occurred_at']:
            row['last_occurred_at'] = payload.get('occurredAt', 0)
            for key in ('bytes', 'expectedBytes', 'downloadTasksAwaitingCallback'):
                if key in evidence:
                    row[key] = evidence[key]
        profile = evidence.get('profile') or {}
        if profile.get('profileAvailable'):
            row['timing_ms'] = {
                'sdk_queue': delta(profile, 'queueStart', 'queueEnd'),
                'dns': delta(profile, 'domainLookUpStart', 'domainLookUpEnd'),
                # connect may include TLS: do not sum connect + TLS.
                'connect_including_tls': delta(profile, 'connectStart', 'connectEnd'),
                'tls': delta(profile, 'SSLconnectionStart', 'SSLconnectionEnd'),
                'before_response': delta(profile, 'fetchStart', 'responseStart'),
                'response_body': delta(profile, 'responseStart', 'responseEnd'),
            }
    for line in gateway:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        row = requests.get(event.get('request_id'))
        if row is not None:
            row['gateway'] = {key: event[key] for key in ('duration', 'size', 'status') if key in event}
    for rid, row in requests.items():
        if rid in asgi:
            row['asgi'] = asgi[rid]
        # Phase comparison only; not a carrier/device/server root-cause verdict.
        timing = row.get('timing_ms', {})
        before, body = timing.get('before_response'), timing.get('response_body')
        row['profile_dominant_phase'] = (
            'unknown' if before is None or body is None else
            'before_response' if before > body else 'response_body'
        )
        row['client_prepared'] = 'attempt_succeeded' in row['stages']
    return sorted(requests.values(), key=lambda row: (row['last_occurred_at'], row['request_id']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', type=Path, required=True)
    parser.add_argument('--gateway', type=Path, required=True)
    parser.add_argument('--since-ms', type=int, default=0, help='Filter client occurredAt, not upload time')
    args = parser.parse_args()
    with args.application.open() as app, args.gateway.open() as gw:
        print(json.dumps(analyze(app, gw, args.since_ms), ensure_ascii=False, indent=2))
