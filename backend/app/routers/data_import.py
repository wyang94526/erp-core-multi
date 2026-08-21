"""Admin utility: upload TIPTOP CSVs, preview mapping, and upsert into ERP tables."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.deps.auth import require_permission
from app.models import User
from app.services.gtt_import import apply_gtt_import, preview_gtt_import, save_uploads

router = APIRouter(prefix="/admin/data-import", tags=["admin-data-import"])


class DataImportApplyRequest(BaseModel):
    truncate: bool = Field(
        default=False,
        description="If true, wipe customers/vendors/items/BOM/COA (and related orders) before load. Use only for initial rebuilds, not live incremental updates.",
    )


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


@router.post("/apply")
def apply_csv_import(
    payload: DataImportApplyRequest,
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    """Run load_gtt_master_data against GTT_DATA_DIR (OCI: /data/imports).

    Default is incremental upsert (insert new IDs, update existing). Set truncate=true
    only for a first-time rebuild; that also removes related orders/inventory/invoices.
    """
    try:
        return apply_gtt_import(upsert=True, truncate=payload.truncate)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not apply CSV import: {exc}") from exc
