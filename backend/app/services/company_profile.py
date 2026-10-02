# @author: Wendy Yang
# @date: 2026-10-02

"""Singleton company letterhead: contact, bill/ship addresses, and logo file."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import CompanyProfile, User

SETTINGS_ID = UUID("00000000-0000-4000-8000-000000000002")
DEFAULT_COMPANY_NAME = "Grand-Tek Technology USA"
ADDRESS_KEYS = (
    "location_name",
    "attention_to",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "contact_person",
    "contact_email",
    "contact_phone",
)
LOGO_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
LOGO_MAX_BYTES = 2 * 1024 * 1024


def empty_address() -> dict[str, str]:
    return {key: "" for key in ADDRESS_KEYS}


def normalize_address(value: Any) -> dict[str, str]:
    raw = value if isinstance(value, dict) else {}
    out = empty_address()
    for key in ADDRESS_KEYS:
        text = raw.get(key)
        out[key] = str(text).strip()[:255] if text is not None else ""
    return out


def get_or_create_profile(db: Session) -> CompanyProfile:
    row = db.get(CompanyProfile, SETTINGS_ID)
    if row is not None:
        return row
    row = (
        db.query(CompanyProfile)
        .order_by(CompanyProfile.updated_at.desc())
        .first()
    )
    if row is not None:
        return row
    row = CompanyProfile(
        id=SETTINGS_ID,
        company_name=DEFAULT_COMPANY_NAME,
        bill_to=empty_address(),
        ship_to=empty_address(),
    )
    db.add(row)
    db.flush()
    return row


def serialize_profile(row: CompanyProfile) -> dict[str, Any]:
    return {
        "id": row.id,
        "company_name": (row.company_name or "").strip() or DEFAULT_COMPANY_NAME,
        "contact_name": (row.contact_name or "").strip() or None,
        "contact_email": (row.contact_email or "").strip() or None,
        "contact_phone": (row.contact_phone or "").strip() or None,
        "bill_to": normalize_address(row.bill_to),
        "ship_to": normalize_address(row.ship_to),
        "has_logo": bool(row.logo_stored_filename),
        "logo_original_filename": row.logo_original_filename,
        "logo_content_type": row.logo_content_type,
        "updated_by_user_id": row.updated_by_user_id,
        "updated_at": row.updated_at,
    }


def update_profile(db: Session, user: User, payload: dict[str, Any]) -> CompanyProfile:
    row = get_or_create_profile(db)
    if "company_name" in payload:
        name = str(payload.get("company_name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Company name is required")
        row.company_name = name[:255]
    if "contact_name" in payload:
        value = payload.get("contact_name")
        row.contact_name = str(value).strip()[:255] if value else None
    if "contact_email" in payload:
        value = payload.get("contact_email")
        row.contact_email = str(value).strip()[:255] if value else None
    if "contact_phone" in payload:
        value = payload.get("contact_phone")
        row.contact_phone = str(value).strip()[:50] if value else None
    if "bill_to" in payload:
        row.bill_to = normalize_address(payload.get("bill_to"))
    if "ship_to" in payload:
        row.ship_to = normalize_address(payload.get("ship_to"))
    row.updated_by_user_id = user.id
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.flush()
    return row


def logo_dir(row: CompanyProfile) -> Path:
    root = get_settings().attachments_root()
    path = (root / "COMPANY_PROFILE" / str(row.id)).resolve()
    if not str(path).startswith(str(root.resolve())):
        raise HTTPException(status_code=400, detail="Invalid logo path")
    path.mkdir(parents=True, exist_ok=True)
    return path


def logo_path(row: CompanyProfile) -> Path | None:
    if not row.logo_stored_filename:
        return None
    path = (logo_dir(row) / row.logo_stored_filename).resolve()
    if not path.is_file():
        return None
    return path


def _detect_logo(filename: str, header: bytes) -> tuple[str, str]:
    ext = Path(filename or "").suffix.lower()
    if ext not in LOGO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a PNG or JPEG logo.",
        )
    if ext == ".png" and not header.startswith(b"\x89PNG"):
        raise HTTPException(status_code=400, detail="File is not a valid PNG")
    if ext in {".jpg", ".jpeg"} and not header.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=400, detail="File is not a valid JPEG")
    return ext, LOGO_TYPES[ext]


async def save_logo(db: Session, user: User, file: UploadFile) -> CompanyProfile:
    row = get_or_create_profile(db)
    header = await file.read(16)
    await file.seek(0)
    ext, content_type = _detect_logo(file.filename or "logo.png", header)
    body = await file.read()
    if len(body) > LOGO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Logo must be 2 MB or smaller")
    if not body:
        raise HTTPException(status_code=400, detail="Logo file is empty")

    dest_dir = logo_dir(row)
    if row.logo_stored_filename:
        previous = dest_dir / row.logo_stored_filename
        if previous.is_file():
            previous.unlink()

    stored = f"logo-{uuid.uuid4().hex}{ext}"
    (dest_dir / stored).write_bytes(body)
    row.logo_stored_filename = stored
    row.logo_original_filename = Path(file.filename or stored).name[:255]
    row.logo_content_type = content_type
    row.logo_file_size = len(body)
    row.updated_by_user_id = user.id
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.flush()
    return row


def delete_logo(db: Session, user: User) -> CompanyProfile:
    row = get_or_create_profile(db)
    path = logo_path(row)
    if path is not None and path.is_file():
        path.unlink()
    row.logo_stored_filename = None
    row.logo_original_filename = None
    row.logo_content_type = None
    row.logo_file_size = None
    row.updated_by_user_id = user.id
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.flush()
    return row
