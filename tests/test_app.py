import io

from docx import Document
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)
TEXT = 'Учебный материал о базах данных и нормализации. ' * 10
RESULT = {'title': 'Базы данных', 'summary': 'Нормализация уменьшает избыточность.',
          'key_points': ['Данные организованы в таблицы.'],
          'cards': [{'term': 'Таблица', 'explanation': 'Строки и столбцы.'}],
          'quiz': [{'question': 'Где хранятся строки?', 'options': ['В таблице', 'В шрифте', 'В цвете', 'В поле зрения'],
                    'answer': 0, 'explanation': 'Таблица состоит из строк.'}]}


def test_page_and_health():
    assert client.get('/').status_code == 200
    assert client.get('/health').json()['status'] == 'ok'


def test_txt_and_docx():
    assert main.extract_text('lecture.txt', TEXT.encode()) == TEXT.strip()
    doc = Document()
    doc.add_paragraph(TEXT)
    buf = io.BytesIO()
    doc.save(buf)
    assert main.extract_text('lecture.docx', buf.getvalue()) == TEXT.strip()


def test_upload_calls_generator(monkeypatch):
    async def fake(text):
        assert text == TEXT.strip()
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', fake)
    r = client.post('/api/material', files={'file': ('lecture.txt', TEXT.encode())})
    assert r.status_code == 200
    assert r.json() == RESULT


def test_missing_key(monkeypatch):
    monkeypatch.delenv('YANDEX_API_KEY', raising=False)
    assert client.post('/api/material', files={'file': ('a.txt', TEXT.encode())}).status_code == 503


def test_invalid_files():
    for name, data, expected in [('a.exe', b'x', 415), ('a.pdf', b'bad pdf', 422),
                                  ('a.txt', b'tiny', 422), ('a.txt', b'x' * (10 * 1024 * 1024 + 1), 413)]:
        assert client.post('/api/material', files={'file': (name, data)}).status_code == expected


def test_yandex_contract(monkeypatch):
    import asyncio
    import httpx
    import json
    monkeypatch.setenv('YANDEX_API_KEY', 'test-key')
    monkeypatch.setenv('YANDEX_FOLDER_ID', 'test-folder')
    real_client = httpx.AsyncClient

    def handler(request):
        body = json.loads(request.content)
        assert request.url.host == 'llm.api.cloud.yandex.net'
        assert request.headers['Authorization'] == 'Api-Key test-key'
        assert body['modelUri'] == 'gpt://test-folder/yandexgpt/latest'
        assert body['messages'][1]['text'] == TEXT
        return httpx.Response(200, json={'result': {'alternatives': [
            {'message': {'text': json.dumps(RESULT)}}]}})

    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    assert asyncio.run(main.generate(TEXT)).title == RESULT['title']
