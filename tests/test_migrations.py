import sqlite3
from sqlalchemy import create_engine, text
from app import store

LEGACY = '''
PRAGMA foreign_keys=ON;
CREATE TABLE groups (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, invite VARCHAR(100) UNIQUE NOT NULL);
CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, name VARCHAR(150) NOT NULL, password TEXT NOT NULL, role VARCHAR(20) NOT NULL, group_id INTEGER NOT NULL REFERENCES groups(id));
CREATE TABLE sessions (token VARCHAR(64) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE materials (id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES users(id), group_id INTEGER NOT NULL REFERENCES groups(id), title VARCHAR(300) NOT NULL, content TEXT NOT NULL, published BOOLEAN NOT NULL);
CREATE TABLE views (id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL REFERENCES materials(id), user_id INTEGER NOT NULL REFERENCES users(id), first_at VARCHAR(40) NOT NULL, last_at VARCHAR(40) NOT NULL, count INTEGER NOT NULL, UNIQUE(material_id,user_id));
CREATE TABLE attempts (id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL REFERENCES materials(id), user_id INTEGER NOT NULL REFERENCES users(id), score INTEGER NOT NULL, total INTEGER NOT NULL, created_at VARCHAR(40) NOT NULL);
INSERT INTO groups VALUES (1,'Old group','old-invite');
INSERT INTO users VALUES (1,'teacher','Teacher','password-hash','teacher',1),(2,'student','Student','student-hash','student',1);
INSERT INTO sessions VALUES ('session-hash',2,9999999999);
INSERT INTO materials VALUES (1,1,1,'Old title','{"quiz":[]}',1);
INSERT INTO views VALUES (1,1,2,'first','last',3);
INSERT INTO attempts VALUES (1,1,2,1,2,'date');
'''


def test_existing_database_migration_preserves_data(tmp_path, monkeypatch):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as connection:
        connection.executescript(LEGACY)
    engine = create_engine('sqlite:///' + str(path))
    monkeypatch.setattr(store, 'engine', engine)
    store.init_db()
    with engine.begin() as connection:
        assert connection.execute(text('SELECT teacher_id,group_id FROM teacher_groups')).all() == [(1, 1)]
        assert connection.execute(text('SELECT group_id FROM users WHERE id=1')).scalar() is None
        assert connection.execute(text('SELECT group_id FROM users WHERE id=2')).scalar() == 1
        assert connection.execute(text('SELECT username,password FROM users WHERE id=1')).one() == ('teacher', 'password-hash')
        assert connection.execute(text('SELECT token FROM sessions')).scalar() == 'session-hash'
        assert connection.execute(text('SELECT quiz_revision FROM materials')).scalar() == 1
        assert connection.execute(text('SELECT score,total,quiz_revision FROM attempts')).one() == (1, 2, 1)
        assert connection.execute(text('SELECT count FROM views')).scalar() == 3
        assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
        assert connection.exec_driver_sql('PRAGMA foreign_keys').scalar() == 1
        connection.execute(text('DELETE FROM teacher_groups'))
        connection.execute(text("INSERT INTO users (id,username,name,password,role,group_id) VALUES (3,'admin','Admin','hash','admin',NULL)"))
    store.init_db()
    with engine.connect() as connection:
        assert connection.execute(text('SELECT COUNT(*) FROM teacher_groups')).scalar() == 0
    backup = path.with_name(path.name + '.before-groups-migration.bak')
    assert backup.exists()
    with sqlite3.connect(backup) as connection:
        assert connection.execute('SELECT group_id FROM users WHERE id=1').fetchone()[0] == 1
    engine.dispose()


def test_fresh_database_migration_repeatable(tmp_path, monkeypatch):
    engine = create_engine('sqlite:///' + str(tmp_path / 'new.db'))
    monkeypatch.setattr(store, 'engine', engine)
    store.init_db()
    store.init_db()
    with engine.connect() as connection:
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar() == '001_groups_and_quiz'
        assert connection.execute(text('SELECT COUNT(*) FROM teacher_groups')).scalar() == 0
    engine.dispose()
