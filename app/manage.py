"""Trusted local provisioning; students cannot self-assign teacher permissions."""
import argparse
import getpass
from pydantic import ValidationError
from sqlalchemy import select
from .store import init_db, Session, User
from .auth import hash_password, Credentials

def main():
    parser = argparse.ArgumentParser(description='Создать администратора или преподавателя без назначенных групп')
    parser.add_argument('username')
    parser.add_argument('--name', required=True)
    parser.add_argument('--role', choices=['teacher', 'admin'], default='teacher')
    args = parser.parse_args()
    password = getpass.getpass('Пароль (от 10 символов): ')
    if password != getpass.getpass('Повторите пароль: '):
        parser.error('Пароли не совпадают')
    try:
        Credentials(username=args.username, password=password)
    except ValidationError:
        parser.error('Логин: 3–100 латинских букв, цифр или _ . -; пароль: 10–128 символов')
    if not args.name.strip() or len(args.name) > 150:
        parser.error('Укажите имя (до 150 символов)')
    init_db()
    with Session() as session:
        if session.scalar(select(User).where(User.username == args.username.lower())):
            parser.error('Логин уже занят')
        session.add(User(username=args.username.lower(), name=args.name.strip(), password=hash_password(password), role=args.role, group_id=None))
        session.commit()
        print('Аккаунт создан. Роль:', args.role)


if __name__ == '__main__':
    main()
