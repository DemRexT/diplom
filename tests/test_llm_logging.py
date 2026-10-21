import asyncio
import copy
import json
import logging

import httpx
import pytest
from fastapi import HTTPException

from app import main
from test_app import RESULT
from test_generation import mock_yandex, reply


@pytest.mark.parametrize('status', [400, 401, 403, 429, 500])
def test_provider_error_logs_reason_and_request_id_without_credentials(monkeypatch, caplog, status):
    source = 'PRIVATE_DOCUMENT_CONTENT\n' * 10
    def handler(request):
        body = json.loads(request.content)
        return httpx.Response(status, headers={'x-request-id': 'request-123'}, json={
            'error': {'grpcCode': 3, 'message': f'Invalid model parameters; key=test-key; source={source}',
                      'details': {'headers': dict(request.headers), 'request': body}},
        })
    mock_yandex(monkeypatch, handler)
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        with pytest.raises(HTTPException):
            asyncio.run(main.generate(source))
    assert f'HTTP {status}' in caplog.text
    assert 'Invalid model parameters' in caplog.text
    assert 'request-123' in caplog.text
    assert 'конспект, карточки и тест' in caplog.text
    assert 'test-key' not in caplog.text
    assert 'PRIVATE_DOCUMENT_CONTENT' not in caplog.text
    assert 'Authorization' not in caplog.text


@pytest.mark.parametrize('status,reason', [
    ('ALTERNATIVE_STATUS_TRUNCATED_FINAL', 'достигнут лимит токенов ответа'),
    ('ALTERNATIVE_STATUS_CONTENT_FILTER', 'заблокирован фильтром'),
])
def test_provider_completion_status_is_explained(monkeypatch, caplog, status, reason):
    mock_yandex(monkeypatch, lambda request: reply('PRIVATE_MODEL_OUTPUT', status))
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        with pytest.raises(HTTPException):
            asyncio.run(main.generate('Учебный материал. ' * 10))
    assert status in caplog.text and reason in caplog.text
    assert 'PRIVATE_MODEL_OUTPUT' not in caplog.text


def test_invalid_generated_json_reports_location_without_dumping_content(monkeypatch, caplog):
    mock_yandex(monkeypatch, lambda request: reply('PRIVATE_MODEL_OUTPUT'))
    with pytest.raises(HTTPException):
        asyncio.run(main.generate('Учебный материал. ' * 10))
    assert 'некорректный JSON' in caplog.text and 'столбец=' in caplog.text
    assert 'PRIVATE_MODEL_OUTPUT' not in caplog.text


def test_validation_logs_field_and_reason_without_echoing_model_input(monkeypatch, caplog):
    result = copy.deepcopy(RESULT)
    result['quiz'][0]['options'] = ['PRIVATE_MODEL_OUTPUT']
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(result)))
    with pytest.raises(HTTPException):
        asyncio.run(main.generate('Учебный материал. ' * 10))
    assert 'Проверка итогового материала' in caplog.text
    assert 'quiz' in caplog.text and 'options' in caplog.text and 'too_short' in caplog.text
    assert 'PRIVATE_MODEL_OUTPUT' not in caplog.text


def test_network_failure_logs_type_without_exception_details(monkeypatch, caplog):
    def handler(request):
        raise httpx.ConnectError('PRIVATE_NETWORK_DETAILS test-key', request=request)
    mock_yandex(monkeypatch, handler)
    with pytest.raises(HTTPException):
        asyncio.run(main.generate('Учебный материал. ' * 10))
    assert 'ConnectError' in caplog.text
    assert 'PRIVATE_NETWORK_DETAILS' not in caplog.text and 'test-key' not in caplog.text


def test_non_json_provider_error_does_not_dump_html(monkeypatch, caplog):
    mock_yandex(monkeypatch, lambda request: httpx.Response(502, text='<html>PRIVATE_BODY</html>'))
    with pytest.raises(HTTPException):
        asyncio.run(main.generate('Учебный материал. ' * 10))
    assert 'Ответ не в формате JSON' in caplog.text
    assert 'PRIVATE_BODY' not in caplog.text


def test_progress_identifies_document_section_and_final_stage(monkeypatch, caplog):
    def handler(request):
        body = json.loads(request.content)
        return reply(json.dumps(RESULT) if body.get('jsonObject') else 'Подробное объяснение.')
    mock_yandex(monkeypatch, handler)
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        asyncio.run(main.generate('PRIVATE_SOURCE_CONTENT ' * 1000))
    assert 'конспект раздела 1/2' in caplog.text
    assert 'конспект раздела 2/2' in caplog.text
    assert 'сборка карточек и теста' in caplog.text
    assert 'PRIVATE_SOURCE_CONTENT' not in caplog.text
