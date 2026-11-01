"""Banks, card issuers and brokers people add from the account form, with their logos."""

import base64
import binascii
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import Ctx, get_ctx, not_found
from app.models import Institution
from app.schemas import InstitutionIn, InstitutionOut

router = APIRouter(prefix="/institutions", tags=["institutions"])

MAX_LOGO_BYTES = 200 * 1024
DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$")
# The file's first bytes must agree with the type it claims. No SVG: it can carry script.
MAGIC = {
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}


def decode_logo(data_url: str) -> tuple[bytes, str]:
    match = DATA_URL.match(data_url)
    if match is None:
        raise HTTPException(422, "The logo must be a PNG, JPEG or WebP image")
    kind = match.group(1)
    try:
        data = base64.b64decode(match.group(2), validate=False)
    except binascii.Error as exc:
        raise HTTPException(422, "The logo file is damaged") from exc
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(422, "The logo must be 200 KB or smaller")
    if not MAGIC[kind](data):
        raise HTTPException(422, "The logo must be a PNG, JPEG or WebP image")
    return data, kind


@router.get("", response_model=list[InstitutionOut])
def list_institutions(
    _: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> list[Institution]:
    return list(db.scalars(select(Institution).order_by(func.lower(Institution.name))))


@router.post("", response_model=InstitutionOut, status_code=status.HTTP_201_CREATED)
def add_institution(
    body: InstitutionIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> Institution:
    taken = select(Institution.id).where(func.lower(Institution.name) == body.name.lower())
    if db.scalar(taken):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{body.name} is already in the list")
    logo, kind = decode_logo(body.logo)
    row = Institution(name=body.name, logo=logo, logo_type=kind, created_by=ctx.user.id)
    db.add(row)
    db.commit()
    return row


@router.get("/{institution_id}/logo")
def logo(
    institution_id: uuid.UUID, _: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> Response:
    row = db.get(Institution, institution_id)
    if row is None:
        raise not_found("Logo not found")
    return Response(
        row.logo,
        media_type=row.logo_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )
