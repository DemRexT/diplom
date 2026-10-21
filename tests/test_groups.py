import copy
from fastapi.testclient import TestClient
from sqlalchemy import select
from app import main
from app.store import User, Group, TeacherGroup, Attempt
from app.auth import hash_password
from test_app import RESULT, TEXT
from test_accounts import accounts, login, student, PASSWORD, HEADERS


def admin_account(database):
    with database() as session:
        user = User(username='administrator', name='Администратор', role='admin', password=hash_password(PASSWORD), group_id=None)
        session.add(user)
        session.commit()
    return login('administrator')


def test_many_groups_and_admin_permissions(database, monkeypatch):
    accounts(database)
    admin = admin_account(database)
    teacher = login('teacher')
    colleague = login('otherteacher')
    learner = student()
    anon = TestClient(main.app, headers=HEADERS)
    for client, status in [(teacher, 403), (learner, 403), (anon, 401)]:
        assert client.get('/api/admin/groups').status_code == status
        assert client.get('/api/admin/teachers').status_code == status
        assert client.post('/api/admin/groups', json={'name': 'Injected'}).status_code == status
        assert client.post('/api/admin/teachers', json={'name': 'Injected', 'username': 'injected', 'password': PASSWORD}).status_code == status
        assert client.put('/api/admin/groups/1/teachers/1').status_code == status
        assert client.delete('/api/admin/groups/1/teachers/1').status_code == status
    group = admin.post('/api/admin/groups', json={'name': 'Новая группа'}).json()
    assert group['name'] == 'Новая группа'
    teacher_id = teacher.get('/api/auth/me').json()['id']
    colleague_id = colleague.get('/api/auth/me').json()['id']
    for tid in [teacher_id, colleague_id]:
        path = f"/api/admin/groups/{group['id']}/teachers/{tid}"
        assert admin.put(path).status_code == 200
        assert admin.put(path).status_code == 200
    assert len(teacher.get('/api/groups').json()) == 2
    assert len(colleague.get('/api/groups').json()) == 2
    newteacher = admin.post('/api/admin/teachers', json={'name': 'Новый преподаватель', 'username': 'newteacher', 'password': PASSWORD})
    assert newteacher.status_code == 201 and 'password' not in newteacher.json()
    assert login('newteacher').get('/api/groups').json() == []
    assert admin.post('/api/admin/teachers', json={'name': 'X', 'username': 'NEWTEACHER', 'password': PASSWORD}).status_code == 409
    assert admin.post('/api/admin/groups', json={'name': '   '}).status_code == 422
    assert admin.put('/api/admin/groups/999/teachers/1').status_code == 404
    student_id = learner.get('/api/auth/me').json()['id']
    assert admin.put(f'/api/admin/groups/1/teachers/{student_id}').status_code == 404
    called = []
    async def fake(text):
        called.append(text)
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', fake)
    assert teacher.post('/api/material', data={'group_id': '2'}, files={'file': ('a.txt', TEXT.encode())}).status_code == 403
    assert not called
    response = teacher.post('/api/material', data={'group_id': str(group['id'])}, files={'file': ('a.txt', TEXT.encode())})
    assert response.status_code == 200
    material = response.json()
    assert material['group_id'] == group['id']
    assert material['teacher_name'] == 'teacher'
    path = f"/api/materials/{material['id']}"
    assert teacher.patch(path, json={'published': True}).status_code == 200
    # Sharing a group does not grant another teacher editing rights to someone else's material.
    assert colleague.get(path).status_code == 404
    assert admin.get(path).status_code == 403
    assert learner.get(path).status_code == 404
    newstudent = student('newstudent', group['invite_code'])
    assert newstudent.get(path).json()['teacher_name'] == 'teacher'
    assert newstudent.get('/api/materials').json()[0]['teacher_name'] == 'teacher'
    assert admin.delete(f"/api/admin/groups/{group['id']}/teachers/{teacher_id}").status_code == 200
    assert teacher.get(path).status_code == 404
    assert teacher.patch(path, json={'published': False}).status_code == 404
    assert teacher.get(path + '/stats').status_code == 404
    assert teacher.put(path + '/quiz', json={'quiz': RESULT['quiz'], 'quiz_revision': 1}).status_code == 404
    assert teacher.post('/api/material', data={'group_id': str(group['id'])}, files={'file': ('a.txt', TEXT.encode())}).status_code == 403
    assert teacher.get('/api/materials').json() == []
    # Existing published materials remain available to the group's students.
    assert newstudent.get(path).status_code == 200


def test_quiz_editing_versions_and_scores(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    learner = student()
    colleague = login('otherteacher')
    async def fake(text):
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', fake)
    response = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('a.txt', TEXT.encode())})
    mid = response.json()['id']
    path = f'/api/materials/{mid}'
    assert teacher.patch(path, json={'published': True}).status_code == 200
    assert learner.post(path + '/attempts', json={'answers': [0], 'quiz_revision': 1}).json()['score'] == 1
    questions = copy.deepcopy(RESULT['quiz'])
    questions[0]['question'] = 'Изменённый вопрос?'
    questions[0]['answer'] = 1
    questions.append(copy.deepcopy(RESULT['quiz'][0]))
    payload = {'quiz': questions, 'quiz_revision': 1}
    assert learner.put(path + '/quiz', json=payload).status_code == 403
    assert colleague.put(path + '/quiz', json=payload).status_code == 404
    updated = teacher.put(path + '/quiz', json=payload).json()
    assert updated['quiz_revision'] == 2 and not updated['published']
    assert len(updated['quiz']) == 2
    assert learner.get(path).status_code == 404
    assert teacher.put(path + '/quiz', json=payload).status_code == 409
    assert teacher.patch(path, json={'published': True}).status_code == 200
    assert learner.post(path + '/attempts', json={'answers': [0], 'quiz_revision': 1}).status_code == 409
    assert learner.post(path + '/attempts', json={'answers': [0], 'quiz_revision': 2}).status_code == 422
    assert 'answer' not in learner.get(path).json()['quiz'][0]
    result = learner.post(path + '/attempts', json={'answers': [1, 0], 'quiz_revision': 2}).json()
    assert result['score'] == 2 and result['total'] == 2
    stats = teacher.get(path + '/stats').json()[0]
    assert stats['attempts'] == 2 and stats['last_quiz_revision'] == 2
    with database() as session:
        assert [attempt.quiz_revision for attempt in session.scalars(select(Attempt).order_by(Attempt.id))] == [1, 2]
    # Delete a question and then delete the last remaining question; empty drafts are allowed.
    assert len(teacher.put(path + '/quiz', json={'quiz': questions[:1], 'quiz_revision': 2}).json()['quiz']) == 1
    empty = teacher.put(path + '/quiz', json={'quiz': [], 'quiz_revision': 3}).json()
    assert empty['quiz'] == [] and empty['quiz_revision'] == 4
    assert teacher.patch(path, json={'published': True}).status_code == 422
    invalid = copy.deepcopy(questions[:1])
    invalid[0]['options'][0] = '   '
    assert teacher.put(path + '/quiz', json={'quiz': invalid, 'quiz_revision': 4}).status_code == 422
    assert teacher.put(path + '/quiz', json={'quiz': questions[:1] * 51, 'quiz_revision': 4}).status_code == 422


def test_assignment_revoked_during_generation(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    async def revoke(text):
        with database() as session:
            assignment = session.get(TeacherGroup, (1, 1))
            session.delete(assignment)
            session.commit()
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', revoke)
    result = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('a.txt', TEXT.encode())})
    assert result.status_code == 403
    assert teacher.get('/api/materials').json() == []
