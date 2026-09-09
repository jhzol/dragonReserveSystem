import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('analyzer', Path(__file__).with_name('analyze-home-media.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RID = 'hm-mttupzs2-1-xgz3v5zs4a'


def mobile(time=100, event_id='one', system='ios', stage='attempt_succeeded', **evidence):
    return 'log client_diagnostic ' + json.dumps({'system_type': system, 'user_id': 'secret',
        'event': 'home_media_attempt', 'payload': {'occurredAt': time, 'diagnosticEventId': event_id,
        'stage': stage, 'url': 'https://private/path?token=secret',
        'evidence': {'requestId': RID, **evidence}}})


class AnalyzerTests(unittest.TestCase):
    def test_join_and_privacy(self):
        app = [mobile(bytes=9), 'log image_transfer ' + json.dumps({'request_id':RID,'duration_ms':3,'bytes_sent_to_asgi':9})]
        gateway = [json.dumps({'request_id':RID,'size':9,'status':200,'duration':.02,'ip':'secret'})]
        row = module.analyze(app,gateway)[0]
        self.assertEqual(row['asgi']['duration_ms'],3)
        self.assertEqual(row['gateway']['size'],9)
        self.assertNotIn('secret',json.dumps(row))
        self.assertTrue(row['client_prepared'])

    def test_missing_profile_is_not_zero_or_success(self):
        row = module.analyze([mobile(stage='page_cancelled',bytes=9,expectedBytes=100)],[])[0]
        self.assertEqual(row['profile_dominant_phase'],'unknown')
        self.assertFalse(row['client_prepared'])

    def test_dedup_and_out_of_order(self):
        row = module.analyze([mobile(time=200,event_id='new',bytes=90),mobile(bytes=10),mobile(bytes=20)],[])[0]
        self.assertEqual(row['bytes'],90)
        self.assertEqual(row['stages'],['attempt_succeeded'])

    def test_filter_by_occurrence_and_exclude_devtools(self):
        self.assertEqual(module.analyze([mobile(time=10),mobile(time=200,system='devtools')],[],100),[])

    def test_dns_tls_and_body_are_separate_not_summed(self):
        row = module.analyze([mobile(profile={'profileAvailable':True,'fetchStart':100,
            'domainLookUpStart':100,'domainLookUpEnd':4000,'connectStart':4000,'connectEnd':8500,
            'SSLconnectionStart':4100,'SSLconnectionEnd':8500,'responseStart':9500,'responseEnd':9700})],[])[0]
        self.assertEqual(row['timing_ms']['dns'],3900)
        self.assertEqual(row['timing_ms']['tls'],4400)
        self.assertEqual(row['timing_ms']['response_body'],200)
        self.assertEqual(row['profile_dominant_phase'],'before_response')

    def test_malformed_lines_and_invalid_request_id(self):
        self.assertEqual(module.analyze(['broken','client_diagnostic {',mobile(requestId='secret')],['{']),[])

    def test_invalid_timing_is_unknown(self):
        self.assertIsNone(module.delta({'a':5,'b':4},'a','b'))
        self.assertIsNone(module.delta({'a':5},'a','b'))


if __name__ == '__main__':
    unittest.main()
