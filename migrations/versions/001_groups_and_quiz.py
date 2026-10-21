"""Initial schema and upgrade of the original diploma database."""
from alembic import op
import sqlalchemy as sa

revision = '001_groups_and_quiz'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    definitions = [
        ('groups', [sa.Column('id', sa.Integer, primary_key=True), sa.Column('name', sa.String(100), nullable=False), sa.Column('invite', sa.String(100), nullable=False, unique=True)]),
        ('users', [sa.Column('id', sa.Integer, primary_key=True), sa.Column('username', sa.String(100), nullable=False, unique=True), sa.Column('name', sa.String(150), nullable=False), sa.Column('password', sa.Text, nullable=False), sa.Column('role', sa.String(20), nullable=False), sa.Column('group_id', sa.Integer, sa.ForeignKey('groups.id'), nullable=True)]),
        ('teacher_groups', [sa.Column('teacher_id', sa.Integer, sa.ForeignKey('users.id'), primary_key=True), sa.Column('group_id', sa.Integer, sa.ForeignKey('groups.id'), primary_key=True)]),
        ('sessions', [sa.Column('token', sa.String(64), primary_key=True), sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False), sa.Column('expires', sa.Integer, nullable=False)]),
        ('materials', [sa.Column('id', sa.Integer, primary_key=True), sa.Column('teacher_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False), sa.Column('group_id', sa.Integer, sa.ForeignKey('groups.id'), nullable=False), sa.Column('title', sa.String(300), nullable=False), sa.Column('content', sa.Text, nullable=False), sa.Column('published', sa.Boolean, nullable=False), sa.Column('quiz_revision', sa.Integer, nullable=False, server_default='1')]),
        ('views', [sa.Column('id', sa.Integer, primary_key=True), sa.Column('material_id', sa.Integer, sa.ForeignKey('materials.id'), nullable=False), sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False), sa.Column('first_at', sa.String(40), nullable=False), sa.Column('last_at', sa.String(40), nullable=False), sa.Column('count', sa.Integer, nullable=False), sa.UniqueConstraint('material_id', 'user_id')]),
        ('attempts', [sa.Column('id', sa.Integer, primary_key=True), sa.Column('material_id', sa.Integer, sa.ForeignKey('materials.id'), nullable=False), sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False), sa.Column('score', sa.Integer, nullable=False), sa.Column('total', sa.Integer, nullable=False), sa.Column('created_at', sa.String(40), nullable=False), sa.Column('quiz_revision', sa.Integer, nullable=False, server_default='1')]),
    ]
    for name, columns in definitions:
        if name not in existing:
            op.create_table(name, *columns)
    if 'users' in existing:
        columns = {c['name']: c for c in sa.inspect(bind).get_columns('users')}
        if not columns['group_id']['nullable']:
            with op.batch_alter_table('users') as batch:
                batch.alter_column('group_id', existing_type=sa.Integer(), nullable=True)
    for name in ('materials', 'attempts'):
        if name in existing and 'quiz_revision' not in {c['name'] for c in sa.inspect(bind).get_columns(name)}:
            op.add_column(name, sa.Column('quiz_revision', sa.Integer, nullable=False, server_default='1'))
    # This data migration runs once. Revoked assignments must never reappear at startup.
    op.execute(sa.text("INSERT INTO teacher_groups (teacher_id, group_id) SELECT id, group_id FROM users WHERE role = 'teacher' AND group_id IS NOT NULL"))
    op.execute(sa.text("UPDATE users SET group_id = NULL WHERE role IN ('teacher', 'admin')"))


def downgrade():
    raise RuntimeError('Restore the database backup to return to the original schema.')
