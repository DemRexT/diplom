import asyncio
import io
import json

from fastapi import UploadFile
from sqlalchemy import select
from app import main
from app.store import Material
from app.local import ensure_local_user
from test_workflow import app_client
from test_app import RESULT, TEXT
from test_generation import mock_yandex, reply


def test_stream_completes_with_saved_material_and_source(database, monkeypatch):
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)))
    response = app_client().post('/api/material?stream=true', files={'file': ('lecture.txt', TEXT.encode())})
    assert response.status_code == 200
    assert 'application/x-ndjson' in response.headers['content-type']
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'complete'
    payload = events[-1]['material']
    assert payload['summary'] == RESULT['summary'] and payload['source'] == TEXT.strip()
    assert app_client().get(f"/api/materials/{payload['id']}").json()['source'] == TEXT.strip()


def test_stream_generation_error_is_explicit_and_does_not_save(database, monkeypatch):
    mock_yandex(monkeypatch, lambda request: reply('invalid JSON'))
    response = app_client().post('/api/material?stream=true', files={'file': ('lecture.txt', TEXT.encode())})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event['type'] for event in events] == ['error']
    with database() as session:
        assert session.scalars(select(Material)).all() == []


def test_stream_rejects_bad_file_before_stream(database):
    assert app_client().post('/api/material?stream=true', files={'file': ('a.exe', b'x')}).status_code == 415


def test_disconnect_cancels_generation_without_saving(database, monkeypatch):
    async def scenario():
        started, stopped = asyncio.Event(), asyncio.Event()
        async def waiting(text, lang='ru'):
            started.set()
            try: await asyncio.Event().wait()
            finally: stopped.set()
        monkeypatch.setattr(main, 'generate', waiting)
        with database() as session:
            user = ensure_local_user(session)
            response = await main.material(file=UploadFile(filename='lecture.txt', file=io.BytesIO(TEXT.encode())), stream=True, user=user, session=session, lang='ru')
            iterator = response.body_iterator
            pending = asyncio.ensure_future(anext(iterator))
            await asyncio.wait_for(started.wait(), 2)
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            await iterator.aclose()
            await asyncio.wait_for(stopped.wait(), 2)
            assert session.scalars(select(Material)).all() == []
    asyncio.run(scenario())
