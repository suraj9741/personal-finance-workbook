import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import structlog
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Account, HouseholdMember, Transaction, User, UserSession
from app.security import hash_token

SESSION_COOKIE = "et_session"


@dataclass(frozen=True)
class Ctx:
    """Who is asking, and which household every query must be scoped to."""

    user: User
    household_id: uuid.UUID
    role: str

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    def visible_account(self) -> ColumnElement[bool]:
        """Shared accounts, plus private accounts that belong to this user."""
        return and_(
            Account.household_id == self.household_id,
            or_(Account.visibility == "shared", Account.owner_user_id == self.user.id),
        )

    def visible_account_ids(self) -> object:
        return select(Account.id).where(self.visible_account()).scalar_subquery()

    def visible_transaction(self) -> ColumnElement[bool]:
        """Household scope, and both sides of the row must be on visible accounts."""
        ids = self.visible_account_ids()
        return and_(
            Transaction.household_id == self.household_id,
            Transaction.account_id.in_(ids),  # type: ignore[arg-type]
            or_(Transaction.to_account_id.is_(None), Transaction.to_account_id.in_(ids)),  # type: ignore[arg-type]
        )

    def just_me(self) -> ColumnElement[bool]:
        """Entries this user added, plus anything on their own private accounts."""
        mine = (
            select(Account.id)
            .where(Account.owner_user_id == self.user.id, Account.visibility == "private")
            .scalar_subquery()
        )
        return or_(Transaction.created_by == self.user.id, Transaction.account_id.in_(mine))


def not_found(what: str = "Not found") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, what)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    now = datetime.now(UTC)
    session = db.get(UserSession, hash_token(token))
    if session is None or session.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    # Sliding expiry, written at most once an hour.
    if now - session.last_seen_at > timedelta(hours=1):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=get_settings().session_ttl_days)
        db.commit()
    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return user


def get_ctx(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Ctx:
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in a household")
    return Ctx(user=user, household_id=member.household_id, role=member.role)


def require_owner(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    if not ctx.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the household owner can do this")
    return ctx


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_site_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return user
