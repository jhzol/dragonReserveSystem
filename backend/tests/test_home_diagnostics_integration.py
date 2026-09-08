"""Actual JS diagnostic generation -> disk/restart -> API/auth -> application log."""
import json
import logging
import subprocess
from pathlib import Path

from app.core.logging import logger
from app.services import diagnostic_service


def test_client_offline_restart_to_backend_log(client, user_headers, normal_user, tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / 'miniprogram/tests/fixtures/homeDiagnosticBridge.js'
    storage = tmp_path / 'client-outbox.json'
    seeded = subprocess.run(['node', str(script), 'seed', str(storage)], check=True, capture_output=True, text=True, timeout=15)
    seed = json.loads(seeded.stdout)
    assert seed['retained'] == 3
    assert 'integration-token' not in storage.read_text()
    assert '?token=' not in storage.read_text()
    log_path = tmp_path / 'application.log'
    monkeypatch.setattr(diagnostic_service, '_diagnostic_log_path', lambda: log_path)
    handler = logging.FileHandler(log_path, encoding='utf-8')
    old_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    process = subprocess.Popen(['node', str(script), 'replay', str(storage)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = json.loads(process.stdout.readline())['request']
        response = client.post('/api/v1/diagnostics/client-logs/batch', headers=user_headers, json=request)
        assert response.status_code == 200
        stdout, stderr = process.communicate(json.dumps({'statusCode': response.status_code, 'data': response.json()})+'\n', timeout=15)
        assert process.returncode == 0, stderr
        assert json.loads(stdout)['retained'] == 0
        handler.flush()
        rows = diagnostic_service.read_recent_client_diagnostic_logs()
        assert len(rows) == 3
        assert {row['payload']['diagnosticEventId'] for row in rows} == set(seed['ids'])
        assert all(row['user_id'] == normal_user.id for row in rows)
        cases = {row['trace_id']: row['payload'] for row in rows}
        assert cases['integration-list_missing']['listStage'] == 'request_pending'
        assert cases['integration-list_missing']['listLoading'] is True
        for role in ('cover','glass'):
            case = cases[f'integration-{role}_missing']
            assert case['pending'] == 1
            assert case['tabHidden'] is False
            assert case['cards'][0][role].startswith('pending;native=no_callback')
            assert case['cards'][1]['ready'] is True
        assert json.loads(storage.read_text()) == []
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
        logger.removeHandler(handler)
        handler.close()
        logger.setLevel(old_level)
