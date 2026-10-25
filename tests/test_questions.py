import json

from app import answers, main
from app.store import Material
from test_accounts import accounts, login, student
from test_app import RESULT
from test_generation import mock_yandex, reply

SOURCE = ('Введение в базы данных. ' * 40 + '\n'
          + 'Нормализация — процесс устранения избыточности. Третья нормальная форма запрещает транзитивные зависимости. ' * 3 + '\n'
          + 'Индексы ускоряют поиск строк. ' * 40)


def published_material(database, monkeypatch, source=SOURCE):
    accounts(database)
    teacher = login('teacher')
    async def fake(text):
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', fake)
    material = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', source.encode())}).json()
    assert teacher.patch(f"/api/materials/{material['id']}", json={'published': True}).status_code == 200
    return teacher, material['id']


def test_short_source_is_sent_whole_and_long_source_is_narrowed():
    assert answers.select_context(SOURCE, 'что угодно', limit=len(SOURCE)) == SOURCE
    context = answers.select_context(SOURCE, 'Что запрещает третья нормальная форма?', limit=800)
    assert 'транзитивные зависимости' in context
    assert 'Введение' not in context and len(context) <= 800
    assert answers.select_context(SOURCE, 'квантовая хромодинамика', limit=800) == ''


def test_question_is_answered_from_methodology_and_stored(database, monkeypatch):
    teacher, material_id = published_material(database, monkeypatch)
    requests = []
    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert not body.get('jsonObject')
        assert 'только на основе' in body['messages'][0]['text']
        text = body['messages'][1]['text']
        assert 'Третья нормальная форма' in text and RESULT['summary'] in text
        assert '<<<\nЧто такое нормализация?\n>>>' in text
        return reply('Нормализация — процесс устранения избыточности.')
    mock_yandex(monkeypatch, handler)
    first, second = student('first'), student('second')
    response = first.post(f'/api/materials/{material_id}/questions', json={'question': '  Что такое нормализация?  '})
    assert response.status_code == 200
    item = response.json()
    assert item['question'] == 'Что такое нормализация?'
    assert item['answer'] == 'Нормализация — процесс устранения избыточности.'
    assert item['author_name'] == 'first'
    second.post(f'/api/materials/{material_id}/questions', json={'question': 'Что такое нормализация?'})
    assert len(requests) == 2
    # A student sees only their own questions; the teacher sees the whole group.
    assert [q['author_name'] for q in first.get(f'/api/materials/{material_id}/questions').json()] == ['first']
    assert [q['author_name'] for q in teacher.get(f'/api/materials/{material_id}/questions').json()] == ['first', 'second']


def test_questions_follow_material_visibility(database, monkeypatch):
    teacher, material_id = published_material(database, monkeypatch)
    mock_yandex(monkeypatch, lambda request: reply('Ответ.'))
    outsider = student('outsider', 'invite-2')
    assert outsider.post(f'/api/materials/{material_id}/questions', json={'question': 'Вопрос?'}).status_code == 404
    assert outsider.get(f'/api/materials/{material_id}/questions').status_code == 404
    assert login('otherteacher').get(f'/api/materials/{material_id}/questions').status_code == 404
    learner = student()
    assert learner.post(f'/api/materials/{material_id}/questions', json={'question': 'а'}).status_code == 422
    assert teacher.patch(f'/api/materials/{material_id}', json={'published': False}).status_code == 200
    assert learner.post(f'/api/materials/{material_id}/questions', json={'question': 'Вопрос?'}).status_code == 404
    assert teacher.post(f'/api/materials/{material_id}/questions', json={'question': 'Проверка ответа?'}).status_code == 200


def test_provider_failure_does_not_store_question(database, monkeypatch):
    teacher, material_id = published_material(database, monkeypatch)
    mock_yandex(monkeypatch, lambda request: reply('', 'ALTERNATIVE_STATUS_CONTENT_FILTER'))
    assert teacher.post(f'/api/materials/{material_id}/questions', json={'question': 'Вопрос?'}).status_code == 502
    assert teacher.get(f'/api/materials/{material_id}/questions').json() == []


def test_material_saved_before_update_has_no_source_but_still_answers(database, monkeypatch):
    teacher, material_id = published_material(database, monkeypatch)
    with database() as session:
        record = session.get(Material, material_id)
        record.content = json.dumps({'summary': 'Старая суть.', 'key_points': ['x'], 'cards': [], 'quiz': RESULT['quiz']})
        session.commit()
    payload = teacher.get(f'/api/materials/{material_id}').json()
    assert payload['source'] is None and payload['summary'] == 'Старая суть.'
    assert 'cards' not in payload
    def handler(request):
        text = json.loads(request.content)['messages'][1]['text']
        assert 'Старая суть.' in text and 'подходящих фрагментов не найдено' in text
        return reply('В методичке нет ответа на этот вопрос.')
    mock_yandex(monkeypatch, handler)
    assert teacher.post(f'/api/materials/{material_id}/questions', json={'question': 'Вопрос?'}).status_code == 200
