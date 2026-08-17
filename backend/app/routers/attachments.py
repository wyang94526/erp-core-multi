from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import DocumentAttachment, User
from app.schemas import DocumentAttachmentRead
from app.services import attachments as attachment_service

router = APIRouter(prefix="/attachments", tags=["attachments"])


def _load(db: Session, attachment_id: int) -> DocumentAttachment:
    row = (
        db.query(DocumentAttachment)
        .options(joinedload(DocumentAttachment.uploaded_by))
        .filter(DocumentAttachment.id == attachment_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return row


@router.get("", response_model=list[DocumentAttachmentRead])
def list_attachments(
    document_type: str,
    document_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    rows = attachment_service.list_attachments(db, document_type, document_id)
    return [attachment_service.to_read(row) for row in rows]


@router.post("", response_model=DocumentAttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    document_type: str = Form(...),
    document_id: str = Form(...),
    notes: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    row = await attachment_service.save_upload(
        db,
        document_type=document_type,
        document_id=document_id,
        file=file,
        notes=notes,
        user=user,
    )
    row = _load(db, row.id)
    return attachment_service.to_read(row)


@router.get("/{attachment_id}/download")
def download_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> FileResponse:
    row = _load(db, attachment_id)
    path = attachment_service.stored_path(row)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return FileResponse(
        path,
        media_type=row.content_type or "application/octet-stream",
        filename=row.original_filename,
        content_disposition_type="inline",
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> None:
    attachment_service.delete_attachment(db, attachment_id)
