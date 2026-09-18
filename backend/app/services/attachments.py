# @author: Wendy Yang
# @date: 2026-09-19

"""Store and validate supporting files attached to any ERP document."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.models import DocumentAttachment, PurchaseOrder, SalesOrder, SubcontractOrder, User

# Known parents — add a model here when a new document type should verify existence.
PARENT_MODELS = {
    "PURCHASE_ORDER": PurchaseOrder,
    "SALES_ORDER": SalesOrder,
    "SUBCONTRACT_ORDER": SubcontractOrder,
}

ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

_SAFE_ID = re.compile(r"^[\w.\-]{1,50}$")
_SAFE_TYPE = re.compile(r"^[A-Z][A-Z0-9_]{1,29}$")
_UNSAFE_NAME = re.compile(r"[^\w.\- ()]+")


def _assert_parent_exists(db: Session, document_type: str, document_id: str) -> None:
    model = PARENT_MODELS.get(document_type)
    if model is None:
        return
    if db.get(model, document_id) is None:
        raise HTTPException(status_code=404, detail="Document not found")


def normalize_document_type(document_type: str) -> str:
    value = (document_type or "").strip().upper()
    if not _SAFE_TYPE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document_type",
        )
    return value


def normalize_document_id(document_id: str) -> str:
    value = (document_id or "").strip()
    if not _SAFE_ID.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id",
        )
    return value


def attachments_root() -> Path:
    root = get_settings().attachments_root()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def stored_path(row: DocumentAttachment) -> Path:
    root = attachments_root()
    path = (root / row.document_type / row.document_id / row.stored_filename).resolve()
    if not str(path).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid attachment path")
    return path


def _safe_original_name(filename: str | None) -> str:
    name = Path(filename or "document.pdf").name
    name = _UNSAFE_NAME.sub("_", name).strip(" .") or "document.pdf"
    return name[:255]


def _detect_kind(filename: str, content_type: str | None, header: bytes) -> tuple[str, str]:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Upload a PDF or common image/Office file.",
        )
    expected = ALLOWED_EXTENSIONS[ext]
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared and declared not in {"application/octet-stream", expected}:
        # Browsers sometimes send generic types; still require a matching extension + magic.
        if ext == ".pdf" and declared != "application/pdf":
            pass
    if ext == ".pdf" and not header.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF")
    if ext == ".png" and not header.startswith(b"\x89PNG"):
        raise HTTPException(status_code=400, detail="File is not a valid PNG")
    if ext in {".jpg", ".jpeg"} and not header.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=400, detail="File is not a valid JPEG")
    if ext in {".docx", ".xlsx"} and not header.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="File is not a valid Office document")
    return ext, expected


def to_read(row: DocumentAttachment) -> dict:
    return {
        "id": row.id,
        "document_type": row.document_type,
        "document_id": row.document_id,
        "original_filename": row.original_filename,
        "content_type": row.content_type,
        "file_size": row.file_size,
        "notes": row.notes,
        "uploaded_by_user_id": str(row.uploaded_by_user_id) if row.uploaded_by_user_id else None,
        "uploaded_by_name": row.uploaded_by.full_name if row.uploaded_by else None,
        "uploaded_at": row.uploaded_at,
    }


def list_attachments(
    db: Session, document_type: str, document_id: str
) -> list[DocumentAttachment]:
    document_type = normalize_document_type(document_type)
    document_id = normalize_document_id(document_id)
    return (
        db.query(DocumentAttachment)
        .options(joinedload(DocumentAttachment.uploaded_by))
        .filter(
            DocumentAttachment.document_type == document_type,
            DocumentAttachment.document_id == document_id,
        )
        .order_by(DocumentAttachment.uploaded_at.desc())
        .all()
    )


async def save_upload(
    db: Session,
    *,
    document_type: str,
    document_id: str,
    file: UploadFile,
    notes: str | None,
    user: User | None,
) -> DocumentAttachment:
    document_type = normalize_document_type(document_type)
    document_id = normalize_document_id(document_id)
    _assert_parent_exists(db, document_type, document_id)

    original = _safe_original_name(file.filename)
    header = await file.read(16)
    ext, content_type = _detect_kind(original, file.content_type, header)
    rest = await file.read()
    payload = header + rest
    max_bytes = get_settings().attachments_max_bytes
    if len(payload) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(payload) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the {max_bytes // (1024 * 1024)} MB limit",
        )

    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_dir = attachments_root() / document_type / document_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / stored_name
    dest.write_bytes(payload)

    row = DocumentAttachment(
        document_type=document_type,
        document_id=document_id,
        original_filename=original,
        stored_filename=stored_name,
        content_type=content_type,
        file_size=len(payload),
        notes=(notes or "").strip() or None,
        uploaded_by_user_id=user.id if user else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_attachment(db: Session, attachment_id: int) -> None:
    row = db.get(DocumentAttachment, attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = stored_path(row)
    db.delete(row)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
