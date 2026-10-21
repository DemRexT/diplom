"""Only administrators can create groups and assign teachers."""
import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .store import db, Group, User, TeacherGroup
from .auth import admin, Credentials, hash_password

router = APIRouter(prefix='/api/admin', dependencies=[Depends(admin)])

class GroupInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)

class TeacherInput(Credentials):
    name: str = Field(min_length=1, max_length=150)

@router.get('/groups')
def groups(session: Session = Depends(db)):
    assignments = session.scalars(select(TeacherGroup)).all()
    by_group = {}
    for assignment in assignments:
        by_group.setdefault(assignment.group_id, []).append(assignment.teacher_id)
    return [{'id': group.id, 'name': group.name, 'invite_code': group.invite,
             'teacher_ids': by_group.get(group.id, [])}
            for group in session.scalars(select(Group).order_by(Group.name, Group.id))]

@router.post('/groups', status_code=201)
def create_group(data: GroupInput, session: Session = Depends(db)):
    group = Group(name=data.name, invite=secrets.token_urlsafe(16))
    session.add(group)
    session.commit()
    return {'id': group.id, 'name': group.name, 'invite_code': group.invite, 'teacher_ids': []}

@router.get('/teachers')
def teachers(session: Session = Depends(db)):
    return [{'id': user.id, 'name': user.name, 'username': user.username}
            for user in session.scalars(select(User).where(User.role == 'teacher').order_by(User.name, User.id))]

@router.post('/teachers', status_code=201)
def create_teacher(data: TeacherInput, session: Session = Depends(db)):
    user = User(username=data.username.lower(), name=data.name.strip(), role='teacher', password=hash_password(data.password), group_id=None)
    if not user.name:
        raise HTTPException(422, 'Укажите имя преподавателя.')
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, 'Логин уже занят.')
    return {'id': user.id, 'name': user.name, 'username': user.username}

def check_assignment(teacher_id, group_id, session):
    teacher = session.get(User, teacher_id)
    if not teacher or teacher.role != 'teacher' or not session.get(Group, group_id):
        raise HTTPException(404, 'Преподаватель или группа не найдены.')

@router.put('/groups/{group_id}/teachers/{teacher_id}')
def assign(group_id: int, teacher_id: int, session: Session = Depends(db)):
    check_assignment(teacher_id, group_id, session)
    if not session.get(TeacherGroup, (teacher_id, group_id)):
        session.add(TeacherGroup(teacher_id=teacher_id, group_id=group_id))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            if not session.get(TeacherGroup, (teacher_id, group_id)):
                raise
    return {'ok': True}

@router.delete('/groups/{group_id}/teachers/{teacher_id}')
def unassign(group_id: int, teacher_id: int, session: Session = Depends(db)):
    check_assignment(teacher_id, group_id, session)
    assignment = session.get(TeacherGroup, (teacher_id, group_id))
    if assignment:
        session.delete(assignment)
        session.commit()
    return {'ok': True}
