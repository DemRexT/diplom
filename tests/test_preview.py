import asyncio
import io
import json

from fastapi import UploadFile
from sqlalchemy import select
from app import main
from app.store import Material, User
from test_accounts import accounts, login, student
from test_app import RESULT, TEXT
from test_generation import mock_yandex, reply


def test_preview_arrives_while_interactive_is_still_running(database, monkeypatch):
    accounts(database)
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)))
    async def scenario():
        gate = asyncio.Event()
        entered = asyncio.Event()
        async def slow_activities(client, source, summary, **kwargs):
            entered.set()
            await gate.wait()
            return [], []
        monkeypatch.setattr(main, 'create_activities', slow_activities)
        with database() as session:
            user = session.scalar(select(User).where(User.username == 'teacher'))
            response = await main.material(file=UploadFile(filename='lecture.txt', file=io.BytesIO(TEXT.encode())), group_id=1, stream=True, user=user, session=session)
            iterator = response.body_iterator
            try:
                first = json.loads(await asyncio.wait_for(anext(iterator), 2))
                assert first['type'] == 'preview'
                assert first['material']['summary'] == RESULT['summary']
                await asyncio.wait_for(entered.wait(), 2)
                assert not gate.is_set()
                assert session.scalars(select(Material)).all() == []
                gate.set()
                last = json.loads(await asyncio.wait_for(anext(iterator), 2))
                assert last['type'] == 'complete'
                assert last['material']['id'] > 0
                assert len(session.scalars(select(Material)).all()) == 1
            finally:
                await iterator.aclose()
    asyncio.run(scenario())


def test_stream_finishes_even_if_interactive_is_invalid(database, monkeypatch):
    accounts(database)
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)),
                lambda request: reply(json.dumps({'labs': [{'formula': ''}], 'challenges': []})))
    response = login('teacher').post('/api/material?stream=true', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())})
    assert response.status_code == 200
    assert 'application/x-ndjson' in response.headers['content-type']
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]['type'] == 'preview'
    assert any(event['type'] == 'progress' for event in events)
    assert events[-1]['type'] == 'complete'
    payload = events[-1]['material']
    assert payload['summary'] == RESULT['summary'] and payload['labs'] == []
    assert login('teacher').get(f"/api/materials/{payload['id']}").status_code == 200


def test_stream_generation_error_is_explicit_and_does_not_save(database, monkeypatch):
    accounts(database)
    mock_yandex(monkeypatch, lambda request: reply('invalid JSON'))
    response = login('teacher').post('/api/material?stream=true', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event['type'] for event in events] == ['error']
    with database() as session:
        assert session.scalars(select(Material)).all() == []


def test_preview_access_checks_happen_before_stream(database):
    accounts(database)
    teacher = login('teacher')
    assert teacher.post('/api/material?stream=true', data={'group_id': '2'}, files={'file': ('lecture.txt', TEXT.encode())}).status_code == 403
    assert student().post('/api/material?stream=true', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())}).status_code == 403


def test_disconnect_cancels_generation_without_saving(database, monkeypatch):
    accounts(database)
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)))
    async def scenario():
        stopped = asyncio.Event()
        async def waiting(client, source, summary, **kwargs):
            try: await asyncio.Event().wait()
            finally: stopped.set()
        monkeypatch.setattr(main, 'create_activities', waiting)
        with database() as session:
            user = session.scalar(select(User).where(User.username == 'teacher'))
            response = await main.material(file=UploadFile(filename='lecture.txt', file=io.BytesIO(TEXT.encode())), group_id=1, stream=True, user=user, session=session)
            assert json.loads(await anext(response.body_iterator))['type'] == 'preview'
            await response.body_iterator.aclose()
            await asyncio.wait_for(stopped.wait(), 2)
            assert session.scalars(select(Material)).all() == []
    asyncio.run(scenario())
