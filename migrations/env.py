from alembic import context

connection = context.config.attributes['connection']
is_sqlite = connection.dialect.name == 'sqlite'
if is_sqlite:
    # SQLite must temporarily disable FK enforcement while Alembic recreates users.
    connection.exec_driver_sql('PRAGMA foreign_keys=OFF')
    connection.commit()
try:
    context.configure(connection=connection, render_as_batch=is_sqlite)
    with context.begin_transaction():
        context.run_migrations()
    if connection.in_transaction():
        connection.commit()
    if is_sqlite:
        violations = connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall()
        if violations:
            raise RuntimeError('Foreign key check failed after migration')
finally:
    if is_sqlite:
        if connection.in_transaction():
            connection.rollback()
        connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        connection.commit()
