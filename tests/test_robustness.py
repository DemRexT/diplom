import io
import json

import pytest
from docx import Document
from fastapi.testclient import TestClient

from app import main
from app.main import app
from test_workflow import app_client
from test_app import RESULT
from test_generation import mock_yandex, reply
from test_questions import published_material


def test_json_in_fences_with_single_latex_backslashes_is_accepted():
    content = '```json\n{"title": "Т", "summary": "Строка 1\\nФормула \\(\\frac{a}{b}\\), \\alpha, \\nu и \\theta\\tконец", "quiz": []}\n```'
    data = main.parse_json_object(content)
    assert data['summary'] == 'Строка 1\nФормула \\(\\frac{a}{b}\\), \\alpha, \\nu и \\theta\tконец'


def test_json_surrounded_by_remarks_and_properly_escaped_json_stay_intact():
    escaped = json.dumps({'summary': 'Формула \\(x^2\\) и \\frac{1}{2}\nабзац'}, ensure_ascii=False)
    assert main.parse_json_object(escaped)['summary'] == 'Формула \\(x^2\\) и \\frac{1}{2}\nабзац'
    assert main.parse_json_object('Вот ответ:\n' + escaped + '\nГотово.')['summary'].startswith('Формула')


def test_string_answer_index_is_accepted(monkeypatch):
    result = json.loads(json.dumps(RESULT))
    result['quiz'][0]['answer'] = '0'
    calls = []
    def handler(request):
        calls.append(request)
        return reply(json.dumps(result))
    mock_yandex(monkeypatch, handler)
    import asyncio
    assert asyncio.run(main.generate('Учебный текст. ' * 20)).quiz[0].answer == 0
    assert len(calls) == 1  # No paid repair request for a harmless type mismatch.


def test_cp1251_txt_and_control_characters():
    text = 'Методичка по базам данных.\x00\r\nНормализация устраняет избыточность.\n\n\n\nКонец. ' * 3
    extracted = main.extract_text('lecture.txt', text.encode('cp1251'))
    assert '\x00' not in extracted and '\r' not in extracted and '\n\n\n' not in extracted
    assert extracted.startswith('Методичка по базам данных.')


def test_docx_keeps_tables_in_document_order():
    document = Document()
    document.add_paragraph('Вступление к главе о нормальных формах базы данных. ' * 2)
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text, table.rows[0].cells[1].text = '1НФ', 'Атомарные значения'
    document.add_paragraph('Текст после таблицы: вторая и третья нормальные формы. ' * 2)
    buffer = io.BytesIO(); document.save(buffer)
    text = main.extract_text('lecture.docx', buffer.getvalue())
    assert text.index('Вступление') < text.index('1НФ | Атомарные значения') < text.index('Текст после таблицы')


def test_questions_are_rate_limited(database, monkeypatch):
    client, material_id = published_material(database, monkeypatch)
    mock_yandex(monkeypatch, lambda request: reply('Ответ.'))
    codes = [client.post(f'/api/materials/{material_id}/questions', json={'question': f'Вопрос {index}?'}).status_code
             for index in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429


def test_failed_upload_releases_generation_slot(database):
    client = app_client()
    for _ in range(3):
        assert client.post('/api/material', files={'file': ('a.txt', b'tiny')}).status_code == 422


def test_stream_saves_with_its_own_session(database, monkeypatch):
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)))
    client = app_client()
    response = client.post('/api/material?stream=true', files={'file': ('a.txt', ('Учебный текст. ' * 20).encode())})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'complete'
    # The slot is free again once the stream ends.
    second = client.post('/api/material?stream=true', files={'file': ('a.txt', ('Учебный текст. ' * 20).encode())})
    assert json.loads(second.text.splitlines()[-1])['type'] == 'complete'
