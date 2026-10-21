"""Trusted local provisioning; students cannot self-assign teacher permissions."""
import argparse
import getpass
import secrets
from pydantic import ValidationError
from sqlalchemy import select
from .store import init_db, Session, User, Group
from .auth import hash_password, Credentials

def main():
    parser = argparse.ArgumentParser(description='Создать преподавателя и его учебную группу')
    parser.add_argument('username')
    parser.add_argument('--name', required=True)
    parser.add_argument('--group', required=True)
    args = parser.parse_args()
    password = getpass.getpass('Пароль (от 10 символов): ')
    if password != getpass.getpass('Повторите пароль: '):
        parser.error('Пароли не совпадают')
    try:
        Credentials(username=args.username, password=password)
    except ValidationError:
        parser.error('Логин: 3–100 латинских букв, цифр или _ . -; пароль: 10–128 символов')
    if not args.name.strip() or len(args.name) > 150 or not args.group.strip() or len(args.group) > 100:
        parser.error('Укажите имя (до 150 символов) и группу (до 100 символов)')
    init_db()
    with Session() as session:
        if session.scalar(select(User).where(User.username == args.username.lower())):
            parser.error('Логин уже занят')
        group = Group(name=args.group, invite=secrets.token_urlsafe(16))
        session.add(group)
        session.flush()
        session.add(User(username=args.username.lower(), name=args.name, password=hash_password(password), role='teacher', group_id=group.id))
        session.commit()
        print('Преподаватель создан. Код группы:', group.invite)

if __name__ == '__main__':
    main()
