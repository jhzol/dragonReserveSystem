import importlib.util
from pathlib import Path
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('transport_sampler', Path(__file__).with_name('sample-media-transport.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class TransportSamplerTests(unittest.TestCase):
    def test_metrics(self):
        r = m.parse_metrics('cubic rtt:18.6/2.1 rto:220 retrans:1/12 bytes_acked:100 busy:3200ms rwnd_limited:1200ms(37.5%) sndbuf_limited:2s(1%) delivery_rate 1.2Mbps app_limited notsent:800 snd_wnd:0')
        self.assertEqual(r['retrans_total'], 12)
        self.assertEqual(r['delivery_rate_bps'], 1200000)
        self.assertEqual(r['rwnd_limited_ms'], 1200)
        self.assertEqual(r['sndbuf_limited_ms'], 2000)
        self.assertEqual(r['rtt_ms'], 18.6)
        self.assertEqual(r['snd_wnd'], 0)

    def test_endpoints_are_not_persisted(self):
        text = '0 8192 10.0.0.15:443 198.51.100.12:55555\n cubic bytes_acked:12 retrans:0/1\nESTAB 0 0 [::ffff:10.0.0.15]:443 [::ffff:203.0.113.2]:42111\n cubic rtt:8/2\n'
        rows = m.parse_sockets(text, b'test-run-a')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['send_q'], 8192)
        serialized = json.dumps(rows)
        for value in ['10.0.0.15', '198.51.100.12', '203.0.113.2', '55555', '42111']:
            self.assertNotIn(value, serialized)
        self.assertNotEqual(rows[0]['flow'], m.parse_sockets(text, b'test-run-b')[0]['flow'])
        self.assertEqual(rows[0]['flow'], m.parse_sockets(text, b'test-run-a')[0]['flow'])

    def test_other_service_and_unknown_values_excluded(self):
        self.assertEqual(m.parse_sockets('0 0 10.0.0.15:22 198.51.100.12:33333\n rtt:1/2\n', b'a'), [])
        self.assertEqual(m.parse_metrics('secret:abcd peer:198.51.100.1 token:xyz bytes_acked:secret'), {})

    def test_inline_metrics(self):
        rows = m.parse_sockets('0 4096 [::]:443 [2001:db8::1]:3333 cubic bytes_sent:123 rtt:1/2', b'a')
        self.assertEqual(rows[0]['bytes_sent'], 123)

    def test_error_output_never_exposes_endpoints(self):
        proc = SimpleNamespace(returncode=1, stdout='198.51.100.1', stderr='private data')
        with patch.object(m.subprocess, 'run', return_value=proc):
            self.assertEqual(m.sample(b'a'), {'error': 'ss_failed', 'returncode': 1})

    def test_empty_snapshot_is_valid_and_read_only(self):
        proc = SimpleNamespace(returncode=0, stdout='', stderr='')
        with patch.object(m.subprocess, 'run', return_value=proc) as run, patch('builtins.open', side_effect=OSError):
            self.assertEqual(m.sample(b'a'), {'flows': [], 'flow_count': 0, 'host_counters': {}})
            self.assertEqual(run.call_args.args[0], ['ss', '-tinH', 'state', 'established', '( sport = :443 )'])

    def test_malformed_metrics_ignored(self):
        self.assertEqual(m.parse_metrics('retrans:x/2 rtt:1/error busy:infinite delivery_rate NaNbps'), {})

    def test_counter_allowlist(self):
        text = 'Tcp: RetransSegs InSegs Secret\nTcp: 5 100 99\nTcpExt: TCPTimeouts TCPToZeroWindowAdv\nTcpExt: 1 2\n'
        self.assertEqual(m.parse_counters(text), {'Tcp.RetransSegs': 5, 'Tcp.InSegs': 100, 'TcpExt.TCPTimeouts': 1, 'TcpExt.TCPToZeroWindowAdv': 2})


if __name__ == '__main__':
    unittest.main()
