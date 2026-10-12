import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import Ctx, get_ctx, not_found, require_owner
from app.models import Household, HouseholdMember, Invite, User, UserSession
from app.routers.auth import start_session
from app.schemas import (
    InviteAcceptIn,
    InviteCreateIn,
    InviteInfoOut,
    InviteOut,
    MemberOut,
    MemberPatchIn,
)
from app.security import hash_password, hash_token, new_token
from app.services import create_household, get_setting

router = APIRouter(tags=["household"])


def make_invite(
    db: Session,
    *,
    created_by: uuid.UUID,
    household_id: uuid.UUID | None,
    new_household_name: str | None,
    role: str,
    note: str | None,
) -> InviteOut:
    days = int(get_setting(db, "invite_expiry_days", str(get_settings().invite_expiry_days)))
    token = new_token()
    invite = Invite(
        token_hash=hash_token(token),
        household_id=household_id,
        new_household_name=new_household_name,
        role=role,
        note=note,
        created_by=created_by,
        expires_at=datetime.now(UTC) + timedelta(days=days),
    )
    db.add(invite)
    db.commit()
    household = db.get(Household, household_id) if household_id else None
    return InviteOut(
        id=invite.id,
        url=f"{get_settings().public_base_url.rstrip('/')}/invite/{token}",
        expires_at=invite.expires_at,
        role=role,
        household_name=household.name if household else new_household_name,
    )


def members_of(db: Session, household_id: uuid.UUID) -> list[MemberOut]:
    rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household_id)
        .order_by(HouseholdMember.joined_at)
    ).all()
    return [
        MemberOut(
            user_id=u.id,
            display_name=u.display_name,
            email=u.email,
            role=m.role,
            is_active=u.is_active,
        )
        for m, u in rows
    ]


def owner_count(db: Session, household_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .join(User, User.id == HouseholdMember.user_id)
            .where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.role == "owner",
                User.is_active.is_(True),
            )
        )
        or 0
    )


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(
    body: InviteCreateIn, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> InviteOut:
    return make_invite(
        db,
        created_by=ctx.user.id,
        household_id=ctx.household_id,
        new_household_name=None,
        role=body.role,
        note=body.note,
    )


def _valid_invite(db: Session, token: str) -> Invite:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(token)))
    if invite is None:
        raise not_found("Invite not found")
    if invite.used_at is not None or invite.expires_at <= datetime.now(UTC):
        raise HTTPException(status.HTTP_410_GONE, "This invite has expired or was already used")
    return invite


@router.get("/invites/{token}", response_model=InviteInfoOut)
def invite_info(token: str, db: Session = Depends(get_db)) -> InviteInfoOut:
    invite = _valid_invite(db, token)
    household = db.get(Household, invite.household_id) if invite.household_id else None
    return InviteInfoOut(
        household_name=household.name if household else invite.new_household_name,
        new_household=household is None,
        expires_at=invite.expires_at,
    )


@router.post("/invites/{token}/accept", status_code=status.HTTP_201_CREATED)
def accept_invite(
    token: str, body: InviteAcceptIn, response: Response, db: Session = Depends(get_db)
) -> dict[str, str]:
    invite = _valid_invite(db, token)
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        email=body.email, display_name=body.display_name, password_hash=hash_password(body.password)
    )
    db.add(user)
    db.flush()
    if invite.household_id is None:
        name = invite.new_household_name or f"{body.display_name}'s household"
        household_id = create_household(db, name).id
        role = "owner"
    else:
        household_id = invite.household_id
        role = invite.role
    db.add(HouseholdMember(household_id=household_id, user_id=user.id, role=role))
    invite.used_at = datetime.now(UTC)
    invite.used_by = user.id
    start_session(db, response, user)
    db.commit()
    return {"status": "ok"}


@router.get("/household/members", response_model=list[MemberOut])
def list_members(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)) -> list[MemberOut]:
    return members_of(db, ctx.household_id)


def _member(db: Session, ctx: Ctx, user_id: uuid.UUID) -> HouseholdMember:
    member = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == ctx.household_id, HouseholdMember.user_id == user_id
        )
    )
    if member is None:
        raise not_found("Member not found")
    return member


@router.patch("/household/members/{user_id}", response_model=list[MemberOut])
def patch_member(
    user_id: uuid.UUID,
    body: MemberPatchIn,
    ctx: Ctx = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    member = _member(db, ctx, user_id)
    if member.role == "owner" and body.role == "member" and owner_count(db, ctx.household_id) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A household needs at least one owner")
    member.role = body.role
    db.commit()
    return members_of(db, ctx.household_id)


@router.delete("/household/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: uuid.UUID, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> None:
    """Deactivates the member's login. Their past entries stay in the household."""
    _member(db, ctx, user_id)
    if user_id == ctx.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't remove yourself")
    user = db.get(User, user_id)
    if user is None:
        raise not_found("Member not found")
    user.is_active = False
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))
    db.commit()
