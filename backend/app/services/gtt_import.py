# @author: Wendy Yang
# @date: 2026-09-19

"""TIPTOP CSV import folder: inspect, upload, preview, and upsert.

Files live in GTT_DATA_DIR (default backend/data/imports locally, /data/imports in Docker/OCI).
Windows bind-mounts C:\\erp\\erp-project\\imports and sets GTT_IMPORT_HOST_PATH for the UI.
Admins upload the master CSVs (or a zip) from the ERP UI so no laptop path is required.
Apply uses the same load_gtt_master_data loader as the CLI, including BOM lines.
"""

from __future__ import annotations

import sys
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from datetime import date

from fastapi import HTTPException, UploadFile, status

from app.config import get_settings
from app.database import SessionLocal
from app.services.trial_balance_import import (
    apply_trial_balance,
    parse_csv,
    period_from_filename,
    row_to_preview,
)

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
    "trial_balance": "trial_balance.csv",
}

EMPTY_COUNTS = {
    "customers": 0,
    "suppliers": 0,
    "items": 0,
    "bom": 0,
    "accounts": 0,
    "trial_balance": 0,
    "customers_with_address": 0,
    "suppliers_with_address": 0,
    "warnings": 0,
}


def import_root() -> Path:
    root = get_settings().gtt_import_root()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def import_host_path() -> str | None:
    raw = (get_settings().gtt_import_host_path or "").strip()
    return raw or None


def classify_filename(name: str) -> str | None:
    stem = Path(name).name
    lower = stem.lower().replace(" ", "")
    if "試算表" in stem or "trialbalance" in lower or "trial_balance" in stem.lower():
        return "trial_balance"
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
        "data_dir_host": import_host_path(),
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
        "trial_balance": [],
        "trial_balance_errors": [],
        "trial_balance_period": None,
        "trial_balance_ready": False,
        "trial_balance_count": 0,
    }


def preview_gtt_import(data_dir: str | Path | None = None) -> dict[str, Any]:
    root = Path(data_dir).expanduser() if data_dir else import_root()
    if not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
    resolved = root.resolve()
    status = inspect_sources(resolved)
    if status["ready"]:
        mapped = preview_from_dir(resolved)
        mapped.update(status)
    else:
        mapped = _empty_preview(status)
    trial_balance = _trial_balance_preview(resolved)
    mapped.update(trial_balance)
    mapped["counts"] = {
        **mapped.get("counts", dict(EMPTY_COUNTS)),
        "trial_balance": trial_balance["trial_balance_count"],
    }
    return mapped


def require_ending_period(value: str | None) -> str:
    from app.services.trial_balance_import import normalize_period

    period = normalize_period(value, "")
    if not period:
        raise HTTPException(
            status_code=400,
            detail="Enter the ending period as YYYY-MM before loading the trial balance.",
        )
    return period


def _trial_balance_path(root: Path) -> Path | None:
    try:
        return find_file(root, FILE_GLOBS["trial_balance"])
    except FileNotFoundError:
        return None


def _trial_balance_preview(root: Path) -> dict[str, Any]:
    path = _trial_balance_path(root)
    if path is None:
        return {
            "trial_balance": [],
            "trial_balance_errors": [],
            "trial_balance_period": None,
            "trial_balance_ready": False,
            "trial_balance_count": 0,
        }
    suggested = period_from_filename(path.name, default=None)
    try:
        rows, failures = parse_csv(path, suggested or date.today().strftime("%Y-%m"))
    except Exception as exc:  # noqa: BLE001 — surface parse errors in the preview
        return {
            "trial_balance": [],
            "trial_balance_errors": [str(exc)],
            "trial_balance_period": suggested,
            "trial_balance_ready": True,
            "trial_balance_count": 0,
        }
    return {
        "trial_balance": [row_to_preview(row) for row in rows[:300]],
        "trial_balance_errors": failures[:50],
        "trial_balance_period": suggested,
        "trial_balance_ready": True,
        "trial_balance_count": len(rows),
    }


def _apply_trial_balance_file(root: Path, period: str) -> dict[str, Any]:
    path = _trial_balance_path(root)
    if path is None:
        raise HTTPException(
            status_code=400,
            detail="Upload a trial balance CSV (試算表 / trial_balance.csv) before loading ending balances.",
        )
    db = SessionLocal()
    try:
        result = apply_trial_balance(db, path, period)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not load trial balance: {exc}") from exc
    finally:
        db.close()
    return {
        "trial_balance_inserted": result.inserted,
        "trial_balance_updated": result.updated,
        "trial_balance_skipped": result.skipped,
        "trial_balance_failed": len(result.failed),
        "trial_balance_period": period,
        "trial_balance_file": path.name,
        "trial_balance_errors": result.failed[:50],
    }


def apply_gtt_import(
    upsert: bool = True,
    truncate: bool = False,
    *,
    apply_masters: bool = True,
    trial_balance_period: str | None = None,
) -> dict[str, Any]:
    """Write mapped TIPTOP CSVs into ERP tables using the same loader as the CLI script.

    Default is incremental upsert. Pass truncate=True only for a first-time / rebuild load.
    Trial balance is applied only when trial_balance_period is provided.
    """
    if not apply_masters and not trial_balance_period:
        raise HTTPException(status_code=400, detail="Nothing to apply")

    root = import_root()
    sources = inspect_sources(root)
    payload: dict[str, Any] = {
        "dry_run": False,
        "upsert": upsert,
        "truncated": bool(truncate) if apply_masters else False,
        "data_dir": str(root),
        "stats": {},
        "warnings": [],
        "counts": dict(EMPTY_COUNTS),
        "trial_balance": [],
        "trial_balance_errors": [],
        "trial_balance_period": None,
        "trial_balance_ready": bool(sources["files"].get("trial_balance")),
        **sources,
    }

    if apply_masters:
        if not sources["ready"]:
            missing = ", ".join(sources["missing"]) or "required CSV files"
            raise HTTPException(
                status_code=400,
                detail=f"Upload the master CSVs before applying. Missing: {missing}",
            )
        plan = build_plan(root, {"customers", "suppliers", "items", "bom", "accounts"})
        stats = apply_plan(plan, upsert=upsert, truncate=truncate)
        warnings = collect_warnings(plan)
        payload.update(
            {
                "stats": dict(stats),
                "warnings": warnings,
                "counts": {
                    "customers": len(plan.customers),
                    "suppliers": len(plan.suppliers),
                    "items": len(plan.items),
                    "bom": len(plan.bom),
                    "accounts": len(plan.accounts),
                    "trial_balance": 0,
                    "warnings": len(warnings),
                },
            }
        )

    if trial_balance_period:
        period = require_ending_period(trial_balance_period)
        tb_stats = _apply_trial_balance_file(root, period)
        payload["stats"].update(
            {
                key: value
                for key, value in tb_stats.items()
                if isinstance(value, int)
            }
        )
        payload["trial_balance_period"] = tb_stats["trial_balance_period"]
        payload["trial_balance_errors"] = tb_stats["trial_balance_errors"]
        payload["counts"]["trial_balance"] = (
            tb_stats["trial_balance_inserted"] + tb_stats["trial_balance_updated"]
        )
        payload["warnings"] = [
            *payload["warnings"],
            *[
                {"entity": "trial_balance", "id": "", "message": message}
                for message in tb_stats["trial_balance_errors"]
            ],
        ]

    return payload


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


def _clear_trial_balance_files(root: Path) -> None:
    for path in root.iterdir():
        if path.is_file() and classify_filename(path.name) == "trial_balance":
            path.unlink(missing_ok=True)


def _write_bytes(root: Path, kind: str, payload: bytes, original_name: str | None = None) -> str:
    if kind == "trial_balance":
        _clear_trial_balance_files(root)
        name = Path(original_name or CANONICAL_NAMES[kind]).name
        if Path(name).suffix.lower() != ".csv":
            name = CANONICAL_NAMES[kind]
        dest = root / name
        dest.write_bytes(payload)
        return dest.name
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
                    "Name files with 客戶 / 供應商 / 料件 / BOM / 科目 / 試算表, or customers.csv / "
                    "suppliers.csv / items.csv / bom.csv / chartOfAccount.csv / trial_balance.csv."
                ),
            )
        saved[kind] = _write_bytes(root, kind, payload, filename)
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
            saved[kind] = _write_bytes(root, kind, data, name)
    if not saved:
        raise HTTPException(
            status_code=400,
            detail="Zip did not contain recognizable customer/supplier/item/BOM/chart-of-account/trial-balance CSV files",
        )
    return saved
