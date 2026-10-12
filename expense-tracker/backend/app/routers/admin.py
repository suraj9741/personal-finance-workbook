"""Site-admin page: users, households, the category template for new households, settings."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import not_found, require_admin
from app.models import (
    AppSetting,
    CategoryTemplate,
    Household,
    HouseholdMember,
    PasswordReset,
    User,
    UserSession,
)
from app.routers.household import make_invite, members_of
from app.schemas import (
    AdminHouseholdOut,
    AdminInviteCreateIn,
    AdminUserOut,
    AdminUserPatchIn,
    CategoryIn,
    HouseholdPatchIn,
    InviteOut,
    LinkOut,
    SettingsIn,
    SettingsOut,
    TemplateOut,
)
from app.security import hash_token, new_token

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

RESET_LINK_HOURS = 24
DEFAULT_GROUP = {"expense": "spend", "income": "earned", "transfer": "transfer"}


def get_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User not found")
    return user


# ---- users ----------------------------------------------------------------------------


@router.get("/users", response_model=list[AdminUserOut])
def list_users(db: Session = Depends(get_db)) -> list[AdminUserOut]:
    rows = db.execute(
        select(User, Household)
        .outerjoin(HouseholdMember, HouseholdMember.user_id == User.id)
        .outerjoin(Household, Household.id == HouseholdMember.household_id)
        .order_by(User.created_at)
    ).all()
    out = []
    for user, household in rows:
        item = AdminUserOut.model_validate(user)
        item.household_id = household.id if household else None
        item.household_name = household.name if household else None
        out.append(item)
    return out


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def patch_user(
    user_id: uuid.UUID,
    body: AdminUserPatchIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    user = get_user(db, user_id)
    if user.id == admin.id and (body.is_active is False or body.is_site_admin is False):
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't deactivate or demote yourself")
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, field, value)
    if body.is_active is False:
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    return AdminUserOut.model_validate(user)


@router.post(
    "/users/{user_id}/reset-link", response_model=LinkOut, status_code=status.HTTP_201_CREATED
)
def reset_link(user_id: uuid.UUID, db: Session = Depends(get_db)) -> LinkOut:
    """One-time link the admin passes on; the user sets a new password with it."""
    user = get_user(db, user_id)
    token = new_token()
    expires = datetime.now(UTC) + timedelta(hours=RESET_LINK_HOURS)
    db.add(PasswordReset(token_hash=hash_token(token), user_id=user.id, expires_at=expires))
    db.commit()
    return LinkOut(
        url=f"{get_settings().public_base_url.rstrip('/')}/reset/{token}", expires_at=expires
    )


@router.post("/users/{user_id}/revoke-sessions", status_code=status.HTTP_204_NO_CONTENT)
def revoke_sessions(user_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    get_user(db, user_id)
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))
    db.commit()


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def admin_invite(
    body: AdminInviteCreateIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> InviteOut:
    if body.household_id is not None and db.get(Household, body.household_id) is None:
        raise not_found("Household not found")
    return make_invite(
        db,
        created_by=admin.id,
        household_id=body.household_id,
        new_household_name=None if body.household_id else (body.new_household_name or None),
        role="owner" if body.household_id is None else body.role,
        note=body.note,
    )


# ---- households -----------------------------------------------------------------------


@router.get("/households", response_model=list[AdminHouseholdOut])
def list_households(db: Session = Depends(get_db)) -> list[AdminHouseholdOut]:
    return [
        AdminHouseholdOut(
            id=h.id, name=h.name, created_at=h.created_at, members=members_of(db, h.id)
        )
        for h in db.scalars(select(Household).order_by(Household.created_at))
    ]


@router.patch("/households/{household_id}", response_model=AdminHouseholdOut)
def rename_household(
    household_id: uuid.UUID, body: HouseholdPatchIn, db: Session = Depends(get_db)
) -> AdminHouseholdOut:
    household = db.get(Household, household_id)
    if household is None:
        raise not_found("Household not found")
    household.name = body.name
    db.commit()
    return AdminHouseholdOut(
        id=household.id,
        name=household.name,
        created_at=household.created_at,
        members=members_of(db, household.id),
    )


# ---- category template ----------------------------------------------------------------


@router.get("/category-template", response_model=list[TemplateOut])
def list_template(db: Session = Depends(get_db)) -> list[CategoryTemplate]:
    return list(db.scalars(select(CategoryTemplate).order_by(CategoryTemplate.sort_order)))


@router.post("/category-template", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
def add_template(body: CategoryIn, db: Session = Depends(get_db)) -> CategoryTemplate:
    row = CategoryTemplate(
        kind=body.kind,
        parent_name=body.parent_name,
        sub_name=body.sub_name,
        stats_group=body.stats_group or DEFAULT_GROUP[body.kind],
        sort_order=body.sort_order,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That template category already exists"
        ) from exc
    return row


@router.delete("/category-template/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    row = db.get(CategoryTemplate, template_id)
    if row is None:
        raise not_found("Template category not found")
    db.delete(row)
    db.commit()


# ---- settings -------------------------------------------------------------------------


@router.get("/settings", response_model=SettingsOut)
def get_app_settings(db: Session = Depends(get_db)) -> SettingsOut:
    return SettingsOut(values={s.key: s.value for s in db.scalars(select(AppSetting))})


@router.put("/settings", response_model=SettingsOut)
def put_app_settings(body: SettingsIn, db: Session = Depends(get_db)) -> SettingsOut:
    if "invite_expiry_days" in body.values and not body.values["invite_expiry_days"].isdigit():
        raise HTTPException(422, "invite_expiry_days must be a whole number")
    for key, value in body.values.items():
        db.merge(AppSetting(key=key, value=value))
    db.commit()
    return get_app_settings(db)
