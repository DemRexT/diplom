import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import llm, main
from app.store import Material
from test_accounts import accounts, login
from test_app import RESULT


def mock_yandex(monkeypatch, handler):
    monkeypatch.setenv('YANDEX_API_KEY', 'test-key')
    monkeypatch.setenv('YANDEX_FOLDER_ID', 'test-folder')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))


def reply(text, status='ALTERNATIVE_STATUS_FINAL'):
    return httpx.Response(200, json={'result': {'alternatives': [{'status': status, 'message': {'text': text}}]}})


@pytest.mark.parametrize('source,limit', [('', 8), ('x' * 51, 10), ('Раздел 1\n\nСлова и формулы. ' * 100, 23), ('\n \n' * 30, 1)])
def test_split_preserves_every_character(source, limit):
    chunks = llm.split_text(source, limit)
    assert ''.join(chunks) == source
    assert all(0 < len(chunk) <= limit for chunk in chunks)


def test_long_material_keeps_detailed_sections_instead_of_final_short_summary(monkeypatch):
    source = ''.join(f'Тема {i}: определение и пример.\n' for i in range(3000))
    assert len(source) > 45000
    details, notes, final_calls = [], [], []
    def handler(request):
        body = json.loads(request.content)
        assert request.headers['Authorization'] == 'Api-Key test-key'
        text = body['messages'][1]['text']
        if body.get('jsonObject'):
            final_calls.append(body)
            for index in range(1, len(notes) + 1):
                assert f'Заметки для интерактива {index}' in text
            assert len(text) <= llm.DIRECT_TEXT_CHARS
            return reply(json.dumps(RESULT))  # This short summary must never replace the chapters.
        if 'понятный учебный конспект' in body['messages'][0]['text']:
            details.append(text)
            assert len(text) <= llm.DETAILED_CHUNK_CHARS
            return reply(f'## Объяснение раздела {len(details)}\n\n' + text[:6500])
        notes.append(text)
        assert len(text) <= llm.CHUNK_CHARS
        return reply(f'Заметки для интерактива {len(notes)}')
    mock_yandex(monkeypatch, handler)
    generated = asyncio.run(main.generate(source))
    assert ''.join(details) == source
    assert ''.join(notes) == source
    assert len(final_calls) == 1
    assert len(generated.summary) > 10000
    assert generated.summary != RESULT['summary']
    for index in range(1, len(details) + 1):
        assert f'## Объяснение раздела {index}' in generated.summary
    for field in ['title', 'key_points', 'cards', 'quiz']:
        assert generated.model_dump()[field] == RESULT[field]


def test_hierarchical_reduction_combines_every_intermediate_note(monkeypatch):
    # Force two levels of reduction without needing an extremely large fixture.
    monkeypatch.setattr(llm, 'DIRECT_TEXT_CHARS', 100)
    monkeypatch.setattr(llm, 'CHUNK_CHARS', 80)
    original_split = llm.split_text
    monkeypatch.setattr(llm, 'split_text', lambda text: original_split(text, 80))
    levels = []
    def handler(request):
        body = json.loads(request.content)
        if body.get('jsonObject'):
            assert len(body['messages'][1]['text']) <= 100
            return reply(json.dumps(RESULT))
        levels.append(body['messages'][1]['text'])
        return reply('Ключевые факты.')
    mock_yandex(monkeypatch, handler)
    source = 'Начальный материал. ' * 50
    async def prepare():
        async with httpx.AsyncClient() as client:
            return await llm.prepare_text(client, source, key='test-key', folder='test-folder')
    result = asyncio.run(prepare())
    initial_chunks = original_split(source, 80)
    assert ''.join(levels[:len(initial_chunks)]) == source
    assert len(levels) > len(initial_chunks)
    assert 'Ключевые факты.' in levels[len(initial_chunks)]
    assert len(result) <= 100
    assert 'Ключевые факты.' in result


def test_extraction_no_longer_rejects_45000_characters():
    text = 'Учебная глава с полезными определениями. ' * 3000
    assert len(text) > 45000
    assert main.extract_text('long.txt', text.encode()) == text.strip()


@pytest.mark.parametrize('kind,expected', [('rate_limit', 503), ('timeout', 504), ('truncated', 502), ('empty', 502), ('invalid_json', 502)])
def test_intermediate_errors_do_not_save_material(database, monkeypatch, kind, expected):
    accounts(database)
    teacher = login('teacher')
    calls = []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert not body.get('jsonObject')
        if len(calls) == 1:
            return reply('Корректные промежуточные заметки.')
        if kind == 'rate_limit':
            return httpx.Response(429, json={'error': {'message': 'rate limit'}})
        if kind == 'timeout':
            raise httpx.ReadTimeout('timeout', request=request)
        if kind == 'truncated':
            return reply('Незавершённые заметки', 'ALTERNATIVE_STATUS_TRUNCATED_FINAL')
        if kind == 'empty':
            return reply('   ')
        return httpx.Response(200, content=b'not json')
    mock_yandex(monkeypatch, handler)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('large.txt', ('Содержание главы. ' * 5000).encode())})
    assert response.status_code == expected
    assert len(calls) == 2  # No retry or final request after failure.
    with database() as session:
        assert session.scalars(select(Material)).all() == []


def test_excessively_long_notes_fail_without_reduction_loop(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        return reply('x' * (llm.MAX_NOTE_CHARS + 1))
    mock_yandex(monkeypatch, handler)
    async def prepare():
        async with httpx.AsyncClient() as client:
            return await llm.prepare_text(client, 'x' * 60000, key='test-key', folder='test-folder')
    with pytest.raises(HTTPException) as error:
        asyncio.run(prepare())
    assert error.value.status_code == 502 and len(calls) == 1
