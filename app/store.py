"""Persistent storage; SQLite locally, PostgreSQL through DATABASE_URL."""
import os
from pathlib import Path
from sqlalchemy import create_engine, event, ForeignKey, String, Text, Integer, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

class Base(DeclarativeBase):
    pass

class Group(Base):
    __tablename__ = 'groups'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    invite: Mapped[str] = mapped_column(String(100), unique=True)

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    password: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20))
    group_id: Mapped[int] = mapped_column(ForeignKey('groups.id'))

class LoginSession(Base):
    __tablename__ = 'sessions'
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    expires: Mapped[int] = mapped_column(Integer)

class Material(Base):
    __tablename__ = 'materials'
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    group_id: Mapped[int] = mapped_column(ForeignKey('groups.id'))
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(default=False)

class View(Base):
    __tablename__ = 'views'
    __table_args__ = (UniqueConstraint('material_id', 'user_id'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey('materials.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    first_at: Mapped[str] = mapped_column(String(40))
    last_at: Mapped[str] = mapped_column(String(40))
    count: Mapped[int] = mapped_column(default=1)

class Attempt(Base):
    __tablename__ = 'attempts'
    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey('materials.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    score: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40))

url = os.getenv('DATABASE_URL')
if not url:
    directory = Path(__file__).resolve().parent.parent / 'var'
    directory.mkdir(exist_ok=True)
    url = 'sqlite:///' + str(directory / 'study.db')
engine = create_engine(url, connect_args={'check_same_thread': False} if url.startswith('sqlite') else {})
if url.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
Session = sessionmaker(engine, expire_on_commit=False)

def init_db():
    Base.metadata.create_all(engine)

def db():
    with Session() as session:
        yield session
