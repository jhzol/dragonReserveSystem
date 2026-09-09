#!/usr/bin/env python3
"""Bounded, read-only TCP/443 sampling; no packet data or endpoint identifiers stored.

Samples all established server-side TCP/443 sockets, not just cover requests.
A sample cannot identify a user, HTTP request, or a HTTP/3 (UDP) transfer.
Identifiers are run-local HMACs; the random key is never persisted.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone

NUMERIC = {
    'rto', 'backoff', 'ato', 'mss', 'pmtu', 'rcvmss', 'advmss', 'cwnd',
    'ssthresh', 'bytes_sent', 'bytes_retrans', 'bytes_acked', 'bytes_received',
    'segs_out', 'segs_in', 'data_segs_out', 'data_segs_in', 'lastsnd', 'lastrcv',
    'lastack', 'unacked', 'lost', 'sacked', 'reordering', 'rcv_space', 'rcv_ssthresh',
    'minrtt', 'notsent', 'delivered', 'delivered_ce', 'snd_wnd', 'rcv_rtt',
}
TIMES = {'busy', 'rwnd_limited', 'sndbuf_limited'}
RATES = {'send', 'pacing_rate', 'delivery_rate'}
COUNTERS = {
    'Tcp': {'ActiveOpens', 'PassiveOpens', 'AttemptFails', 'EstabResets',
            'CurrEstab', 'InSegs', 'OutSegs', 'RetransSegs', 'InErrs', 'OutRsts'},
    'TcpExt': {'TCPTimeouts', 'TCPLossProbes', 'TCPFastRetrans', 'TCPSlowStartRetrans',
               'TCPRcvQDrop', 'TCPBacklogDrop', 'ListenOverflows', 'ListenDrops',
               'TCPToZeroWindowAdv', 'TCPFromZeroWindowAdv', 'TCPWantZeroWindowAdv'},
}


def number(text):
    return float(text) if '.' in text else int(text)


def parse_metrics(text):
    result = {}
    tokens = text.split()
    for i, token in enumerate(tokens):
        if token in ('app_limited', 'retransmits', 'ecn', 'ecnseen'):
            result[token] = True
        if token in RATES and i + 1 < len(tokens):
            match = re.fullmatch(r'(\d+(?:\.\d+)?)([KMG]?)bps', tokens[i + 1])
            if match:
                result[token + '_bps'] = float(match[1]) * {'': 1, 'K': 1e3, 'M': 1e6, 'G': 1e9}[match[2]]
        key, sep, val = token.partition(':')
        if not sep:
            continue
        if key in NUMERIC and re.fullmatch(r'\d+(?:\.\d+)?', val):
            result[key] = number(val)
        elif key == 'rtt' and re.fullmatch(r'\d+(?:\.\d+)?/\d+(?:\.\d+)?', val):
            result['rtt_ms'], result['rtt_variation_ms'] = map(float, val.split('/'))
        elif key == 'retrans' and re.fullmatch(r'\d+/\d+', val):
            result['retrans_current'], result['retrans_total'] = map(int, val.split('/'))
        elif key in TIMES:
            match = re.fullmatch(r'(\d+(?:\.\d+)?)(us|ms|s)(?:\([\d.]+%\))?', val)
            if match:
                result[key + '_ms'] = float(match[1]) * {'us': .001, 'ms': 1, 's': 1000}[match[2]]
    return result


def parse_sockets(text, key):
    rows = []
    current = None
    # With explicit "state established", ss omits the state column.
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        offset = 1 if fields[0] == 'ESTAB' else 0
        if len(fields) >= offset + 4 and fields[offset].isdigit() and fields[offset + 1].isdigit():
            local, peer = fields[offset + 2:offset + 4]
            # Fail closed if a different service/socket format appears.
            if not local.endswith(':443'):
                current = None
                continue
            identity = (local + '|' + peer).encode()
            current = {
                'flow': hmac.new(key, identity, hashlib.sha256).hexdigest()[:24],
                'recv_q': int(fields[offset]), 'send_q': int(fields[offset + 1]),
            }
            current.update(parse_metrics(' '.join(fields[offset + 4:])))
            rows.append(current)
        elif current is not None:
            current.update(parse_metrics(line))
    return rows


def parse_counters(text):
    lines = text.splitlines()
    result = {}
    for names, values in zip(lines[::2], lines[1::2]):
        ns, vs = names.split(), values.split()
        if not ns or not vs or ns[0] != vs[0]:
            continue
        section = ns[0].rstrip(':')
        for key, value in zip(ns[1:], vs[1:]):
            if key in COUNTERS.get(section, ()) and value.isdigit():
                result[section + '.' + key] = int(value)
    return result


def sample(key):
    proc = subprocess.run(
        ['ss', '-tinH', 'state', 'established', '( sport = :443 )'],
        capture_output=True, text=True, timeout=5, check=False,
    )
    if proc.returncode:
        # Do not expose raw command output, which may contain endpoints.
        return {'error': 'ss_failed', 'returncode': proc.returncode}
    counters = {}
    for path in ('/proc/net/snmp', '/proc/net/netstat'):
        try:
            with open(path) as src:
                counters.update(parse_counters(src.read()))
        except OSError:
            pass
    rows = parse_sockets(proc.stdout, key)
    return {'flows': rows, 'flow_count': len(rows), 'host_counters': counters}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration', type=int, default=180)
    parser.add_argument('--interval', type=float, default=1)
    args = parser.parse_args()
    if not 1 <= args.duration <= 600 or not 1 <= args.interval <= 10:
        parser.error('duration must be 1..600 seconds; interval must be 1..10 seconds')
    key = os.urandom(32)
    start = time.monotonic()
    print(json.dumps({'kind': 'start', 'scope': 'all_server_tcp_443', 'duration_s': args.duration,
                      'interval_s': args.interval, 'request_correlation': False}), flush=True)
    count = errors = 0
    while time.monotonic() - start < args.duration:
        tick = time.monotonic()
        try:
            result = sample(key)
        except subprocess.TimeoutExpired:
            result = {'error': 'ss_timeout'}
        except OSError:
            result = {'error': 'ss_unavailable'}
        result.update(kind='sample', at=datetime.now(timezone.utc).isoformat(),
                      elapsed_s=round(time.monotonic() - start, 3))
        print(json.dumps(result, separators=(',', ':')), flush=True)
        count += 1
        errors += int('error' in result)
        if errors >= 3:
            break
        remaining = args.duration - (time.monotonic() - start)
        if remaining > 0:
            time.sleep(min(remaining, max(0, args.interval - (time.monotonic() - tick))))
    print(json.dumps({'kind': 'end', 'samples': count, 'errors': errors,
                      'elapsed_s': round(time.monotonic() - start, 3)}), flush=True)
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
