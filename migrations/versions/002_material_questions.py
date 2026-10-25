"""Questions students ask about a material and the generated answers."""
from alembic import op
import sqlalchemy as sa

revision = '002_material_questions'
down_revision = '001_groups_and_quiz'
branch_labels = None
depends_on = None


def upgrade():
    if 'questions' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table('questions',
                    sa.Column('id', sa.Integer, primary_key=True),
                    sa.Column('material_id', sa.Integer, sa.ForeignKey('materials.id'), nullable=False),
                    sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
                    sa.Column('question', sa.Text, nullable=False),
                    sa.Column('answer', sa.Text, nullable=False),
                    sa.Column('created_at', sa.String(40), nullable=False))
    op.create_index('ix_questions_material_id', 'questions', ['material_id'])


def downgrade():
    op.drop_index('ix_questions_material_id', 'questions')
    op.drop_table('questions')
