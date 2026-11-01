from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from prometheus_client import Counter
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import SESSION_COOKIE, current_user
from app.models import (
    Household,
    HouseholdMember,
    LoginAttempt,
    PasswordReset,
    User,
    UserSession,
)
from app.schemas import EmailChangeIn, LoginIn, MeOut, PasswordChangeIn, ResetIn
from app.security import hash_password, hash_token, new_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

LOGINS = Counter("logins_total", "Login attempts", ["result"])
for _label in ("ok", "failed", "rate_limited"):
    LOGINS.labels(_label)  # export zeros from boot


def start_session(db: Session, response: Response, user: User) -> None:
    settings = get_settings()
    token = new_token()
    now = datetime.now(UTC)
    db.add(
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=now + timedelta(days=settings.session_ttl_days),
            last_seen_at=now,
        )
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def me_out(db: Session, user: User) -> MeOut:
    row = db.execute(
        select(HouseholdMember, Household)
        .join(Household, Household.id == HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user.id)
    ).first()
    return MeOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_site_admin=user.is_site_admin,
        household_id=row[1].id if row else None,
        household_name=row[1].name if row else None,
        role=row[0].role if row else None,
    )


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    since = datetime.now(UTC) - timedelta(minutes=settings.login_window_minutes)
    failures = db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            LoginAttempt.email == body.email,
            LoginAttempt.succeeded.is_(False),
            LoginAttempt.attempted_at >= since,
        )
    )
    if (failures or 0) >= settings.login_max_failures:
        LOGINS.labels("rate_limited").inc()
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed logins. Try again later."
        )
    user = db.scalar(select(User).where(User.email == body.email))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        db.add(LoginAttempt(email=body.email, succeeded=False))
        db.commit()
        LOGINS.labels("failed").inc()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    db.add(LoginAttempt(email=body.email, succeeded=True))
    start_session(db, response, user)
    db.commit()
    LOGINS.labels("ok").inc()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeOut:
    return me_out(db, user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChangeIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    db.commit()


def email_taken(db: Session, email: str, user: User) -> bool:
    """Another login already signs in with this email (emails are stored lower case)."""
    return db.scalar(select(User.id).where(User.email == email, User.id != user.id)) is not None


@router.post("/email", response_model=MeOut)
def change_email(
    body: EmailChangeIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> MeOut:
    """Only you change your own email (a site admin can too, from Admin). You stay signed in."""
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    if body.new_email == user.email:
        raise HTTPException(status.HTTP_409_CONFLICT, "That's already your email")
    if email_taken(db, body.new_email, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "Another login already uses that email")
    user.email = body.new_email
    db.commit()
    return me_out(db, user)


@router.post("/reset/{token}", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(token: str, body: ResetIn, db: Session = Depends(get_db)) -> None:
    reset = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == hash_token(token)))
    if reset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reset link not found")
    if reset.used_at is not None or reset.expires_at <= datetime.now(UTC):
        raise HTTPException(status.HTTP_410_GONE, "Reset link has expired or was used")
    user = db.get(User, reset.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reset link not found")
    user.password_hash = hash_password(body.password)
    reset.used_at = datetime.now(UTC)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
