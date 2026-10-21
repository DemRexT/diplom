import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app import main
from app.auth import hash_password, verify_password
from app.store import Group, User, LoginSession, View, TeacherGroup
from test_app import RESULT, TEXT

PASSWORD = 'safe-test-password'
HEADERS = {'X-Study-Request': '1'}


def accounts(database):
    with database() as session:
        group = Group(name='Группа 1', invite='invite-1')
        other = Group(name='Группа 2', invite='invite-2')
        session.add_all([group, other])
        session.flush()
        for username, role, gid in [('teacher', 'teacher', group.id), ('otherteacher', 'teacher', other.id)]:
            user = User(username=username, name=username, role=role, group_id=None, password=hash_password(PASSWORD))
            session.add(user)
            session.flush()
            session.add(TeacherGroup(teacher_id=user.id, group_id=gid))
        session.commit()


def login(username):
    client = TestClient(app, headers=HEADERS)
    assert client.post('/api/auth/login', json={'username': username, 'password': PASSWORD}).status_code == 200
    return client


def student(username='student', invite='invite-1'):
    client = TestClient(app, headers=HEADERS)
    r = client.post('/api/auth/register', json={'username': username, 'name': username, 'password': PASSWORD, 'invite_code': invite, 'role': 'teacher'})
    assert r.status_code == 200
    assert r.json()['role'] == 'student'
    assert 'password' not in r.json()
    assert 'invite_code' not in r.json()
    return client


def test_complete_learning_workflow(database, monkeypatch):
    accounts(database)
    teacher = login('teacher')
    learner = student()
    outsider = student('outsider', 'invite-2')
    other_teacher = login('otherteacher')
    async def fake(text):
        return main.StudyMaterial.model_validate(RESULT)
    monkeypatch.setattr(main, 'generate', fake)
    r = teacher.post('/api/material', data={'group_id': '1'}, files={'file': ('lecture.txt', TEXT.encode())})
    assert r.status_code == 200
    mid = r.json()['id']
    path = f'/api/materials/{mid}'
    page = TestClient(app).get(f'/materials/{mid}')
    assert page.status_code == 200
    assert RESULT['summary'] not in page.text
    assert TestClient(app).get(path).status_code == 401
    assert learner.get('/api/materials').json() == []
    assert learner.get(path).status_code == 404
    assert learner.post('/api/material', data={'group_id': '1'}, files={'file': ('a.txt', TEXT.encode())}).status_code == 403
    assert learner.patch(path, json={'published': True}).status_code == 403
    assert teacher.patch(path, json={'published': True}).status_code == 200
    library = learner.get('/api/materials').json()
    assert len(library) == 1
    assert library[0]['teacher_name'] == 'teacher'
    assert library[0]['group_name'] == 'Группа 1'
    assert learner.get(f'/materials/{mid}').status_code == 200
    content = learner.get(path).json()
    assert 'answer' not in content['quiz'][0]
    assert 'explanation' not in content['quiz'][0]
    assert outsider.get(path).status_code == 404
    assert outsider.post(path + '/view').status_code == 404
    assert outsider.post(path + '/attempts', json={'quiz_revision': 1, 'answers': [0]}).status_code == 404
    assert other_teacher.get(path + '/stats').status_code == 404
    assert other_teacher.patch(path, json={'published': False}).status_code == 404
    assert learner.get(path + '/stats').status_code == 403
    stats = teacher.get(path + '/stats').json()
    assert stats[0]['views'] == 0  # GET does not record engagement
    assert learner.post(path + '/view').status_code == 200
    assert learner.post(path + '/view').status_code == 200
    assert learner.post(path + '/attempts', json={'quiz_revision': 1, 'answers': [5]}).status_code == 422
    result = learner.post(path + '/attempts', json={'quiz_revision': 1, 'answers': [0]}).json()
    assert result['score'] == 1
    result = learner.post(path + '/attempts', json={'quiz_revision': 1, 'answers': [1]}).json()
    assert result['score'] == 0
    stats = teacher.get(path + '/stats').json()
    assert len(stats) == 1
    assert stats[0]['views'] == 2 and stats[0]['attempts'] == 2
    assert stats[0]['first_view'] <= stats[0]['last_view']
    assert stats[0]['last_score'] == 0
    assert teacher.patch(path, json={'published': False}).status_code == 200
    assert learner.get(path).status_code == 404
    assert learner.post(path + '/attempts', json={'quiz_revision': 1, 'answers': [0]}).status_code == 404


def test_sessions_and_registration(database):
    accounts(database)
    anon = TestClient(app, headers=HEADERS)
    assert anon.get('/api/materials').status_code == 401
    assert anon.get('/api/auth/me').status_code == 401
    assert anon.post('/api/auth/register', json={'username': 'test', 'name': 'Test', 'password': PASSWORD, 'invite_code': 'wrong'}).status_code == 400
    for name in ['teacher', 'unknown']:
        assert anon.post('/api/auth/login', json={'username': name, 'password': 'wrong-password'}).status_code == 401
    learner = student()
    cookie = learner.cookies.get('study_session')
    assert 'HttpOnly' in learner.post('/api/auth/login', json={'username': 'student', 'password': PASSWORD}).headers['set-cookie']
    assert learner.get('/api/auth/me').json()['role'] == 'student'
    assert learner.get('/api/auth/me').headers['cache-control'] == 'no-store'
    duplicate = anon.post('/api/auth/register', json={'username': 'STUDENT', 'name': 'Test', 'password': PASSWORD, 'invite_code': 'invite-1'})
    assert duplicate.status_code == 409
    with database() as session:
        assert all(s.token != cookie for s in session.scalars(select(LoginSession)))
        stored = session.scalar(select(User).where(User.username == 'student')).password
        assert stored != PASSWORD and verify_password(PASSWORD, stored)
    current = learner.cookies.get('study_session')
    assert learner.post('/api/auth/logout').status_code == 200
    learner.cookies.set('study_session', current)
    assert learner.get('/api/auth/me').status_code == 401
    teacher = login('teacher')
    with database() as session:
        for s in session.scalars(select(LoginSession)):
            s.expires = 0
        session.commit()
    assert teacher.get('/api/materials').status_code == 401


def test_csrf(database):
    accounts(database)
    client = TestClient(app)
    assert client.post('/api/auth/login', json={'username': 'teacher', 'password': PASSWORD}).status_code == 403


@pytest.mark.parametrize('role', ['teacher', 'admin'])
def test_cli_provisions_privileged_account(database, monkeypatch, capsys, role):
    import sys
    from app import manage
    monkeypatch.setattr(manage, 'init_db', lambda: None)
    monkeypatch.setattr(manage, 'Session', database)
    monkeypatch.setattr(sys, 'argv', ['manage', 'lecturer', '--name', 'Преподаватель', '--role', role])
    monkeypatch.setattr(manage.getpass, 'getpass', lambda _: PASSWORD)
    manage.main()
    output = capsys.readouterr().out
    assert PASSWORD not in output
    with database() as session:
        teacher = session.scalar(select(User).where(User.username == 'lecturer'))
        assert teacher.role == role and verify_password(PASSWORD, teacher.password)
        assert teacher.group_id is None
        assert not session.scalars(select(TeacherGroup).where(TeacherGroup.teacher_id == teacher.id)).all()
