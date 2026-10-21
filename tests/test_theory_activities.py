import asyncio
import copy
import json

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app import main, activities
from app.interactive import InteractiveLab, TheoryChallenge
from app.store import Material
from test_accounts import accounts, login
from test_app import RESULT
from test_generation import mock_yandex, reply
from test_interactive import LAB

CHALLENGE = {'kind': 'order', 'title': 'Собери решение', 'topic': 'Свёртка тензоров',
             'prompt': 'Восстанови порядок вычисления.', 'items': ['Данные', 'Выбор диагонали', 'Сумма'],
             'answer': [0, 1, 2], 'explanation': 'Сначала определяем компоненты, затем складываем диагональные.'}


def test_every_original_fragment_gets_activities_not_just_compressed_notes(monkeypatch):
    source = ''.join(f'Тема {i}. Свёртка: сумма диагональных компонент.\n' for i in range(900))
    inputs = []
    def activity_handler(request):
        body = json.loads(request.content)
        inputs.append(body['messages'][1]['text'])
        item = copy.deepcopy(LAB)
        item['title'] += f' {len(inputs)}'
        challenge = {**CHALLENGE, 'title': f'Миссия {len(inputs)}'}
        return reply(json.dumps({'labs': [item], 'challenges': [challenge]}))
    def handler(request):
        body = json.loads(request.content)
        return reply(json.dumps(RESULT) if body.get('jsonObject') else '## Свёртка тензоров\n\nСумма диагональных компонент.')
    mock_yandex(monkeypatch, handler, activity_handler)
    result = asyncio.run(main.generate(source))
    assert ''.join(inputs) == source
    assert len(inputs) > 3
    assert len(result.labs) == len(inputs)
    assert len(result.challenges) == len(inputs)
    assert all(len(piece) <= activities.ACTIVITY_CHARS for piece in inputs)
    assert len(main.StudyMaterial.model_validate(result.model_dump()).labs) > 3


def test_invalid_activity_is_skipped_without_retry(monkeypatch):
    monkeypatch.setattr(activities, 'ACTIVITY_CHARS', 100)
    source = 'Учебная формула: сумма компонент. ' * 10
    inputs = []
    def handler(request):
        body = json.loads(request.content)
        text = body['messages'][1]['text']
        inputs.append(text)
        if len(inputs) == 2:
            bad = copy.deepcopy(LAB)
            bad['outputs'][0]['expression'] = 'javascript(1)'
            return reply(json.dumps({'labs': [bad], 'challenges': []}))
        return reply(json.dumps({'labs': [LAB], 'challenges': []}))
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)), handler)
    result = asyncio.run(main.generate(source))
    pieces = activities.split_text(source, 100)
    assert inputs == pieces
    # Identical activities are not duplicated across fragments.
    assert len(result.labs) == 1


@pytest.mark.parametrize('error', ['invalid', 'quota', 'timeout', 'json'])
def test_activity_failure_preserves_ready_material(database, monkeypatch, error):
    accounts(database)
    teacher = login('teacher')
    attempts = []
    def handler(request):
        attempts.append(request)
        if error == 'quota': return httpx.Response(429, json={'error': {'message': 'quota'}})
        if error == 'timeout': raise httpx.ReadTimeout('timeout', request=request)
        if error == 'json': return reply('invalid JSON')
        return reply(json.dumps({'labs': [{'invalid': True}], 'challenges': []}))
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)), handler)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', ('Учебная формула и её применение. ' * 10).encode())})
    assert response.status_code == 200
    assert response.json()['summary'] == RESULT['summary']
    assert response.json()['labs'] == []
    assert len(attempts) == 1
    with database() as session:
        assert len(session.scalars(select(Material)).all()) == 1


@pytest.mark.parametrize('kind,answer', [('choice', [0, 1]), ('choice', [9]), ('order', [0, 0, 2]), ('order', [0, 1])])
def test_challenge_requires_valid_solution(kind, answer):
    with pytest.raises(ValidationError):
        TheoryChallenge.model_validate({**CHALLENGE, 'kind': kind, 'answer': answer})


@pytest.mark.parametrize('mode,count,valid', [('vector', 2, True), ('vector', 3, False), ('matrix', 4, True), ('matrix', 9, True), ('matrix', 5, False)])
def test_visualization_component_counts(mode, count, valid):
    lab = copy.deepcopy(LAB)
    lab['visualization'] = mode
    lab['outputs'] = [{'label': f'Компонента {i}', 'expression': 'a11+a22'} for i in range(count)]
    if valid:
        assert InteractiveLab.model_validate(lab).visualization == mode
    else:
        with pytest.raises(ValidationError): InteractiveLab.model_validate(lab)


def test_mixed_good_and_bad_activities_keep_valid_ones(monkeypatch):
    bad = copy.deepcopy(LAB)
    bad['parameters'] = []
    mock_yandex(monkeypatch, lambda request: reply(json.dumps(RESULT)),
                lambda request: reply(json.dumps({'labs': [bad, LAB], 'challenges': [CHALLENGE, {'bad': True}]})))
    result = asyncio.run(main.generate('Учебный текст. ' * 20))
    assert len(result.labs) == len(result.challenges) == 1
    assert result.labs[0].title == LAB['title']
