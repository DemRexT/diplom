import asyncio
import copy
import json
import logging

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import main
from app.store import Material
from test_accounts import accounts, login
from test_app import RESULT
from test_generation import mock_yandex, reply


@pytest.mark.parametrize('first', [
    {'summary': 'Подробный исходный конспект с объяснениями.'},
    'not-json',
    [],
])
def test_one_repair_fills_missing_fields_and_preserves_available_summary(monkeypatch, caplog, first):
    calls = []
    source = 'Учебная глава с определениями и примерами. ' * 20
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return reply(first if isinstance(first, str) else json.dumps(first))
        repair = json.loads(body['messages'][1]['text'])
        assert repair['source'] == source
        assert repair['validation_errors']
        assert body['jsonObject'] is True
        return reply(json.dumps(RESULT))
    mock_yandex(monkeypatch, handler)
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        generated = asyncio.run(main.generate(source))
    assert len(calls) == 2
    assert generated.title == RESULT['title'] and generated.quiz[0].answer == 0
    assert generated.summary == (first['summary'] if isinstance(first, dict) else RESULT['summary'])
    assert 'Исправление структуры успешно' in caplog.text


def test_repair_does_not_regenerate_long_document_chapters(monkeypatch):
    calls, chapter_calls, structured = [], [], []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if not body.get('jsonObject'):
            chapter_calls.append(body)
            return reply(f'## Тема {len(chapter_calls)}\n\nПодробное объяснение раздела {len(chapter_calls)}.')
        structured.append(body)
        return reply(json.dumps({'summary': 'Короткий ответ без остальных полей'} if len(structured) == 1 else RESULT))
    mock_yandex(monkeypatch, handler)
    generated = asyncio.run(main.generate('Учебный материал. ' * 1000))
    assert len(chapter_calls) == 2 and len(structured) == 2 and len(calls) == 4
    assert 'Подробное объяснение раздела 1.' in generated.summary
    assert 'Подробное объяснение раздела 2.' in generated.summary
    assert RESULT['summary'] not in generated.summary


def test_invalid_quiz_is_repaired_before_saving(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    bad = copy.deepcopy(RESULT)
    bad['quiz'][0]['options'] = ['Один вариант']
    bad['quiz'][0]['answer'] = 8
    calls = []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 2:
            repair = json.loads(body['messages'][1]['text'])
            paths = [issue['loc'] for issue in repair['validation_errors']]
            assert ['quiz', 0, 'options'] in paths and ['quiz', 0, 'answer'] in paths
        return reply(json.dumps(bad if len(calls) == 1 else RESULT))
    mock_yandex(monkeypatch, handler)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Учебный текст. ' * 100).encode())})
    assert response.status_code == 200
    assert len(response.json()['quiz'][0]['options']) == 4
    with database() as session:
        saved = session.scalars(select(Material)).all()
        assert len(saved) == 1
        assert json.loads(saved[0].content)['quiz'][0]['answer'] == 0


@pytest.mark.parametrize('second', ['invalid', {'summary': 'Still missing fields'}, []])
def test_failed_repair_stops_and_saves_nothing(database, monkeypatch, second, caplog):
    accounts(database)
    teacher = login('teacher')
    calls = []
    def handler(request):
        calls.append(request)
        candidate = {'summary': 'Ready summary'} if len(calls) == 1 else second
        return reply(candidate if isinstance(candidate, str) else json.dumps(candidate))
    mock_yandex(monkeypatch, handler)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Учебный текст. ' * 100).encode())})
    assert response.status_code == 502 and len(calls) == 2
    assert 'не смогла исправить' in response.json()['detail']
    assert 'дополнительных попыток не будет' in caplog.text
    with database() as session:
        assert session.scalars(select(Material)).all() == []


@pytest.mark.parametrize('kind,status', [('http', 502), ('quota', 503), ('timeout', 504)])
def test_repair_network_error_is_not_retried(monkeypatch, kind, status):
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return reply(json.dumps({'summary': 'Ready summary'}))
        if kind == 'timeout':
            raise httpx.ReadTimeout('timeout', request=request)
        return httpx.Response(429 if kind == 'quota' else 500, json={'message': 'provider error'})
    mock_yandex(monkeypatch, handler)
    with pytest.raises(HTTPException) as error:
        asyncio.run(main.generate('Учебный текст. ' * 100))
    assert error.value.status_code == status and len(calls) == 2
