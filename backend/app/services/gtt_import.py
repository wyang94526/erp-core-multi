"""TIPTOP CSV import folder: inspect, upload, preview, and upsert.

Files live in GTT_DATA_DIR (default backend/data/imports locally, /data/imports in Docker/OCI).
Admins upload the master CSVs (or a zip) from the ERP UI so OCI does not need a laptop path.
Apply uses the same load_gtt_master_data loader as the CLI, including BOM lines.
"""

from __future__ import annotations

import sys
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status

from app.config import get_settings

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from load_gtt_master_data import (  # noqa: E402
    CORE_IMPORT_KEYS,
    FILE_GLOBS,
    apply_plan,
    build_plan,
    collect_warnings,
    find_file,
    preview_from_dir,
)

CANONICAL_NAMES = {
    "customers": "customers.csv",
    "suppliers": "suppliers.csv",
    "items": "items.csv",
    "bom": "bom.csv",
    "accounts": "chartOfAccount.csv",
}

EMPTY_COUNTS = {
    "customers": 0,
    "suppliers": 0,
    "items": 0,
    "bom": 0,
    "accounts": 0,
    "customers_with_address": 0,
    "suppliers_with_address": 0,
    "warnings": 0,
}


def import_root() -> Path:
    root = get_settings().gtt_import_root()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def classify_filename(name: str) -> str | None:
    stem = Path(name).name
    lower = stem.lower().replace(" ", "")
    if "科目" in stem or "chartofaccount" in lower or ("chart" in lower and "account" in lower):
        return "accounts"
    if lower in {"accounts.csv", "coa.csv"}:
        return "accounts"
    if "客戶" in stem or "客户" in stem or "customer" in lower:
        return "customers"
    if "供應商" in stem or "供应商" in stem or "supplier" in lower or "vendor" in lower:
        return "suppliers"
    if "料件" in stem or "item" in lower:
        return "items"
    if "bom" in lower:
        return "bom"
    return None


def inspect_sources(data_dir: Path | None = None) -> dict[str, Any]:
    root = data_dir or import_root()
    files: dict[str, dict[str, Any] | None] = {}
    missing: list[str] = []
    for key, patterns in FILE_GLOBS.items():
        try:
            path = find_file(root, patterns)
            files[key] = {"name": path.name, "size": path.stat().st_size}
        except FileNotFoundError:
            files[key] = None
            if key in CORE_IMPORT_KEYS:
                missing.append(key)
    return {
        "data_dir": str(root),
        "files": files,
        "source_files": {key: (info["name"] if info else "") for key, info in files.items()},
        "missing": missing,
        "ready": not missing,
    }


def _empty_preview(status: dict[str, Any]) -> dict[str, Any]:
    return {
        "dry_run": True,
        **status,
        "counts": dict(EMPTY_COUNTS),
        "warnings": [],
        "customers": [],
        "suppliers": [],
        "items": [],
        "vendor_mappings": [],
        "bom": [],
        "accounts": [],
    }


def preview_gtt_import(data_dir: str | Path | None = None) -> dict[str, Any]:
    root = Path(data_dir).expanduser() if data_dir else import_root()
    if not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
    status = inspect_sources(root.resolve())
    if not status["ready"]:
        return _empty_preview(status)
    mapped = preview_from_dir(root.resolve())
    mapped.update(status)
    return mapped


def apply_gtt_import(upsert: bool = True, truncate: bool = False) -> dict[str, Any]:
    """Write mapped TIPTOP CSVs into ERP tables using the same loader as the CLI script.

    Default is incremental upsert. Pass truncate=True only for a first-time / rebuild load.
    """
    root = import_root()
    sources = inspect_sources(root)
    if not sources["ready"]:
        missing = ", ".join(sources["missing"]) or "required CSV files"
        raise HTTPException(
            status_code=400,
            detail=f"Upload the master CSVs before applying. Missing: {missing}",
        )
    plan = build_plan(root, {"customers", "suppliers", "items", "bom", "accounts"})
    stats = apply_plan(plan, upsert=upsert, truncate=truncate)
    warnings = collect_warnings(plan)
    return {
        "dry_run": False,
        "upsert": upsert,
        "truncated": bool(truncate),
        "data_dir": str(root),
        "stats": dict(stats),
        "warnings": warnings,
        "counts": {
            "customers": len(plan.customers),
            "suppliers": len(plan.suppliers),
            "items": len(plan.items),
            "bom": len(plan.bom),
            "accounts": len(plan.accounts),
            "warnings": len(warnings),
        },
        **sources,
    }


def _max_bytes() -> int:
    return get_settings().attachments_max_bytes


async def _read_limited(upload: UploadFile) -> bytes:
    limit = _max_bytes()
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{upload.filename or 'file'} exceeds {limit} bytes",
        )
    if not data:
        raise HTTPException(status_code=400, detail=f"{upload.filename or 'file'} is empty")
    return data


def _write_bytes(root: Path, kind: str, payload: bytes) -> str:
    dest = root / CANONICAL_NAMES[kind]
    dest.write_bytes(payload)
    return dest.name


async def save_uploads(uploads: list[UploadFile]) -> dict[str, Any]:
    if not uploads:
        raise HTTPException(status_code=400, detail="Select at least one CSV or a zip of the master files")
    root = import_root()
    saved: dict[str, str] = {}
    for upload in uploads:
        filename = upload.filename or "upload"
        suffix = Path(filename).suffix.lower()
        payload = await _read_limited(upload)
        if suffix == ".zip":
            saved.update(_extract_zip(root, payload, filename))
            continue
        if suffix != ".csv":
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file '{filename}'. Upload .csv files or a .zip.",
            )
        kind = classify_filename(filename)
        if kind is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot tell which master '{filename}' is. "
                    "Name files with 客戶 / 供應商 / 料件 / BOM / 科目, or customers.csv / "
                    "suppliers.csv / items.csv / bom.csv / chartOfAccount.csv."
                ),
            )
        saved[kind] = _write_bytes(root, kind, payload)
    return {"saved": saved, **inspect_sources(root)}


def _extract_zip(root: Path, payload: bytes, zip_name: str) -> dict[str, str]:
    saved: dict[str, str] = {}
    try:
        archive = zipfile.ZipFile(BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"{zip_name} is not a valid zip") from exc
    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if Path(name).suffix.lower() != ".csv":
                continue
            kind = classify_filename(name)
            if kind is None:
                continue
            data = archive.read(info)
            if not data:
                continue
            if len(data) > _max_bytes():
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"{name} in the zip exceeds the file size limit",
                )
            saved[kind] = _write_bytes(root, kind, data)
    if not saved:
        raise HTTPException(
            status_code=400,
            detail="Zip did not contain recognizable customer/supplier/item/BOM/chart-of-account CSV files",
        )
    return saved
