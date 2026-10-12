"""schema

Revision ID: 0001
Revises:
Create Date: 2026-10-12 18:11:06.469166
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('app_settings',
    sa.Column('key', sa.String(length=50), nullable=False),
    sa.Column('value', sa.String(length=200), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('category_templates',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('parent_name', sa.String(length=60), nullable=False),
    sa.Column('sub_name', sa.String(length=60), nullable=False),
    sa.Column('stats_group', sa.String(length=10), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.CheckConstraint("kind IN ('expense', 'income', 'transfer')", name='kind_valid'),
    sa.CheckConstraint("stats_group IN ('spend', 'saving', 'lent', 'earned', 'repaid', 'transfer')", name='stats_group_valid'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kind', 'parent_name', 'sub_name', name='uq_category_templates_name')
    )
    op.create_table('households',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('login_attempts',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('succeeded', sa.Boolean(), nullable=False),
    sa.Column('attempted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_login_attempts_email_at', 'login_attempts', ['email', 'attempted_at'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('display_name', sa.String(length=100), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('is_site_admin', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('accounts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('pay_type', sa.String(length=15), nullable=False),
    sa.Column('opening_balance', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('visibility', sa.String(length=10), nullable=False),
    sa.Column('owner_user_id', sa.Uuid(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("pay_type IN ('bank', 'credit_card', 'share_broker', 'cash')", name='pay_type_valid'),
    sa.CheckConstraint("visibility = 'shared' OR owner_user_id IS NOT NULL", name='private_has_owner'),
    sa.CheckConstraint("visibility IN ('shared', 'private')", name='visibility_valid'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('household_id', 'name', 'pay_type', name='uq_accounts_name')
    )
    op.create_index(op.f('ix_accounts_household_id'), 'accounts', ['household_id'], unique=False)
    op.create_table('categories',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('parent_name', sa.String(length=60), nullable=False),
    sa.Column('sub_name', sa.String(length=60), nullable=False),
    sa.Column('stats_group', sa.String(length=10), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.CheckConstraint("kind IN ('expense', 'income', 'transfer')", name='kind_valid'),
    sa.CheckConstraint("stats_group IN ('spend', 'saving', 'lent', 'earned', 'repaid', 'transfer')", name='stats_group_valid'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('household_id', 'kind', 'parent_name', 'sub_name', name='uq_categories_name')
    )
    op.create_index(op.f('ix_categories_household_id'), 'categories', ['household_id'], unique=False)
    op.create_table('household_members',
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(length=10), nullable=False),
    sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('owner', 'member')", name='role_valid'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('household_id', 'user_id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('invites',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=True),
    sa.Column('new_household_name', sa.String(length=100), nullable=True),
    sa.Column('role', sa.String(length=10), nullable=False),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('used_by', sa.Uuid(), nullable=True),
    sa.CheckConstraint("role IN ('owner', 'member')", name='role_valid'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['used_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_table('password_resets',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_table('sessions',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('token_hash')
    )
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)
    op.create_table('budgets',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('category_id', sa.Uuid(), nullable=False),
    sa.Column('month', sa.Date(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.CheckConstraint('EXTRACT(DAY FROM month) = 1', name='month_is_first_day'),
    sa.CheckConstraint('amount >= 0', name='amount_non_negative'),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('category_id', 'month', name='uq_budgets_category_month')
    )
    op.create_index(op.f('ix_budgets_household_id'), 'budgets', ['household_id'], unique=False)
    op.create_table('category_rules',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('pattern', sa.String(length=100), nullable=False),
    sa.Column('category_id', sa.Uuid(), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_category_rules_household_id'), 'category_rules', ['household_id'], unique=False)
    op.create_table('transactions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('household_id', sa.Uuid(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('account_id', sa.Uuid(), nullable=False),
    sa.Column('to_account_id', sa.Uuid(), nullable=True),
    sa.Column('category_id', sa.Uuid(), nullable=True),
    sa.Column('description', sa.String(length=200), nullable=False),
    sa.Column('counterparty', sa.String(length=100), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.Column('statement_matched', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(type = 'transfer') = (to_account_id IS NOT NULL)", name='transfer_has_to_account'),
    sa.CheckConstraint("source IN ('manual', 'import')", name='source_valid'),
    sa.CheckConstraint("type IN ('expense', 'income', 'transfer')", name='type_valid'),
    sa.CheckConstraint('amount > 0', name='amount_positive'),
    sa.CheckConstraint('to_account_id IS NULL OR to_account_id <> account_id', name='transfer_distinct'),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['to_account_id'], ['accounts.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_transactions_household_account_date', 'transactions', ['household_id', 'account_id', 'date'], unique=False)
    op.create_index('ix_transactions_household_category_date', 'transactions', ['household_id', 'category_id', 'date'], unique=False)
    op.create_index('ix_transactions_household_date', 'transactions', ['household_id', 'date'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_transactions_household_date', table_name='transactions')
    op.drop_index('ix_transactions_household_category_date', table_name='transactions')
    op.drop_index('ix_transactions_household_account_date', table_name='transactions')
    op.drop_table('transactions')
    op.drop_index(op.f('ix_category_rules_household_id'), table_name='category_rules')
    op.drop_table('category_rules')
    op.drop_index(op.f('ix_budgets_household_id'), table_name='budgets')
    op.drop_table('budgets')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_table('password_resets')
    op.drop_table('invites')
    op.drop_table('household_members')
    op.drop_index(op.f('ix_categories_household_id'), table_name='categories')
    op.drop_table('categories')
    op.drop_index(op.f('ix_accounts_household_id'), table_name='accounts')
    op.drop_table('accounts')
    op.drop_table('users')
    op.drop_index('ix_login_attempts_email_at', table_name='login_attempts')
    op.drop_table('login_attempts')
    op.drop_table('households')
    op.drop_table('category_templates')
    op.drop_table('app_settings')
