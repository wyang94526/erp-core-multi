"""Admin utility: upload TIPTOP CSVs and preview the loader mapping (dry-run)."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.deps.auth import require_permission
from app.models import User
from app.services.gtt_import import preview_gtt_import, save_uploads

router = APIRouter(prefix="/admin/data-import", tags=["admin-data-import"])


@router.get("/preview")
def preview_csv_import(
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    """Mapped payload if CSVs are on the server; otherwise ready=false and missing file keys."""
    try:
        return preview_gtt_import()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not map CSV files: {exc}") from exc


@router.post("/files")
async def upload_csv_files(
    files: list[UploadFile] = File(...),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    """Store CSVs (or a zip) in the server import folder. Does not write ERP tables."""
    return await save_uploads(files)
