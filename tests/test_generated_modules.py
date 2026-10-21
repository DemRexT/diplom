import copy
from pathlib import Path
import json
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from app.interactive import GeneratedModule
from app.store import Material
from test_accounts import accounts, login, student
from test_app import RESULT, TEXT
from test_generation import mock_yandex, reply
from test_interactive import LAB

MODULE = json.loads((Path(__file__).parent / 'fixtures/generated_module.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('change', ['empty', 'script', 'iframe', 'no_controls', 'duplicate', 'oversize'])
def test_invalid_modules_are_rejected(change):
    module = copy.deepcopy(MODULE)
    if change == 'empty': module['javascript'] = ' '
    if change == 'script': module['html'] += '<script>alert(1)</script>'
    if change == 'iframe': module['html'] += '<iframe></iframe>'
    if change == 'no_controls': module['html'] = '<p>Статичная картинка</p>'
    if change == 'duplicate': module['html'] += '<span id="x">Повтор</span>'
    if change == 'oversize': module['javascript'] = 'x' * 12001
    with pytest.raises(ValidationError): GeneratedModule.model_validate(module)


def test_modules_are_saved_loaded_and_bad_module_does_not_lose_lesson(database, monkeypatch):
    accounts(database)
    bad = {**MODULE, 'javascript': ''}
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)),
                lambda request: reply(json.dumps({'labs': [LAB], 'challenges': [], 'modules': [bad, MODULE]})))
    teacher = login('teacher')
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload['modules']) == len(payload['labs']) == 1
    assert payload['modules'][0]['javascript'] == MODULE['javascript']
    with database() as session:
        record = session.get(Material, payload['id'])
        record.published = True
        session.commit()
        before = record.content
    visible = student().get(f"/api/materials/{payload['id']}")
    assert visible.status_code == 200 and visible.json()['modules'][0]['html'] == MODULE['html']
    with database() as session: assert session.get(Material, payload['id']).content == before


def test_failed_modules_leave_empty_field_and_save_base(database, monkeypatch):
    accounts(database)
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)),
                lambda request: reply(json.dumps({'labs': [], 'challenges': [], 'modules': [{'invalid': True}]})))
    response = login('teacher').post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())})
    assert response.status_code == 200 and response.json()['modules'] == []
    assert response.json()['summary'] == RESULT['summary']
