def test_client_diagnostic_batch_is_accepted(client, user_headers) -> None:
    response = client.post(
        "/api/v1/diagnostics/client-logs/batch",
        headers=user_headers,
        json={
            "events": [
                {
                    "event": "request_fail",
                    "traceId": "trace-1",
                    "sessionId": "session-1",
                    "page": "pages/activity_list/activity_list",
                    "level": "error",
                    "payload": {"summary": "network failed"},
                },
                {"event": "activity_card_media_error"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "stored": True}


def test_single_client_diagnostic_log_endpoint_remains_available(client) -> None:
    methods = client.app.openapi()["paths"]["/api/v1/diagnostics/client-logs"]

    assert "post" in methods
