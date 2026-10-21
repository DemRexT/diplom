import hashlib
import secrets
import time
import os
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .store import db, User, Group, LoginSession, TeacherGroup

router = APIRouter(prefix='/api/auth')
COOKIE = 'study_session'

def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return salt + ':' + digest

def verify_password(password, stored):
    salt, expected = stored.split(':')
    actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return secrets.compare_digest(actual, expected)

def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()

def current_user(request: Request, session: Session = Depends(db)):
    token = request.cookies.get(COOKIE)
    login = session.get(LoginSession, token_hash(token)) if token else None
    if not login or login.expires <= time.time():
        raise HTTPException(401, 'Войдите в аккаунт.')
    user = session.get(User, login.user_id)
    if not user:
        raise HTTPException(401, 'Войдите в аккаунт.')
    return user

def teacher(user: User = Depends(current_user)):
    if user.role != 'teacher':
        raise HTTPException(403, 'Доступно только преподавателю.')
    return user

def admin(user: User = Depends(current_user)):
    if user.role != 'admin':
        raise HTTPException(403, 'Доступно только администратору.')
    return user


def teacher_groups(user, session):
    return session.scalars(select(Group).join(TeacherGroup, TeacherGroup.group_id == Group.id)
                           .where(TeacherGroup.teacher_id == user.id).order_by(Group.name, Group.id)).all()


def require_group(user, group_id, session):
    if not session.get(TeacherGroup, (user.id, group_id)):
        raise HTTPException(403, 'Преподаватель не назначен в эту группу.')


def public_user(user, session):
    result = dict(id=user.id, username=user.username, name=user.name, role=user.role)
    if user.role == 'student':
        group = session.get(Group, user.group_id)
        result['group'] = group.name if group else None
    if user.role == 'teacher':
        result['groups'] = [{'id': group.id, 'name': group.name, 'invite_code': group.invite}
                            for group in teacher_groups(user, session)]
    return result

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=100, pattern=r'^[A-Za-z0-9_.-]+$')
    password: str = Field(min_length=10, max_length=128)

class Registration(Credentials):
    name: str = Field(min_length=1, max_length=150)
    invite_code: str = Field(min_length=1, max_length=100)

# Calculate a dummy hash once so unknown usernames also incur password verification.
DUMMY = hash_password('unknown-account-password')

def issue_session(user, session, response):
    token = secrets.token_urlsafe(32)
    session.execute(delete(LoginSession).where(LoginSession.expires < int(time.time())))
    session.add(LoginSession(token=token_hash(token), user_id=user.id, expires=int(time.time()) + 86400))
    session.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite='strict', secure=os.getenv('COOKIE_SECURE') == '1', max_age=86400)
    return public_user(user, session)

@router.post('/register')
def register(data: Registration, response: Response, session: Session = Depends(db)):
    group = session.scalar(select(Group).where(Group.invite == data.invite_code))
    if not group:
        raise HTTPException(400, 'Неверный код учебной группы.')
    user = User(username=data.username.lower(), name=data.name.strip(), password=hash_password(data.password), role='student', group_id=group.id)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, 'Логин уже занят.')
    return issue_session(user, session, response)

@router.post('/login')
def login(data: Credentials, response: Response, session: Session = Depends(db)):
    user = session.scalar(select(User).where(User.username == data.username.lower()))
    valid = verify_password(data.password, user.password if user else DUMMY)
    if not user or not valid:
        raise HTTPException(401, 'Неверный логин или пароль.')
    return issue_session(user, session, response)

@router.post('/logout')
def logout(request: Request, response: Response, session: Session = Depends(db)):
    token = request.cookies.get(COOKIE)
    if token:
        session.execute(delete(LoginSession).where(LoginSession.token == token_hash(token)))
        session.commit()
    response.delete_cookie(COOKIE)
    return {'ok': True}

@router.get('/me')
def me(user: User = Depends(current_user), session: Session = Depends(db)):
    return public_user(user, session)
