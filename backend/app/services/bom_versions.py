# @author: Wendy Yang
# @date: 2026-09-19

"""Versioned assembly BOMs: headers (draft/active/obsolete) plus component lines."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models import ItemBOMComponent, ItemBOMHeader

WRITABLE_STATUSES = {"draft", "active"}


def list_headers(db: Session, parent_item_id: str) -> list[ItemBOMHeader]:
    return (
        db.query(ItemBOMHeader)
        .options(selectinload(ItemBOMHeader.components))
        .filter(ItemBOMHeader.parent_item_id == parent_item_id)
        .order_by(ItemBOMHeader.version_no.asc())
        .all()
    )


def get_header(db: Session, header_id: int) -> ItemBOMHeader | None:
    return db.get(ItemBOMHeader, header_id)


def get_active_header(db: Session, parent_item_id: str) -> ItemBOMHeader | None:
    return (
        db.query(ItemBOMHeader)
        .filter(
            ItemBOMHeader.parent_item_id == parent_item_id,
            ItemBOMHeader.status == "active",
        )
        .first()
    )


def resolve_header(
    db: Session,
    parent_item_id: str,
    bom_header_id: int | None = None,
) -> ItemBOMHeader | None:
    if bom_header_id is not None:
        header = get_header(db, bom_header_id)
        if header is None or header.parent_item_id != parent_item_id:
            raise HTTPException(status_code=404, detail="BOM version not found")
        return header
    return get_active_header(db, parent_item_id)


def ensure_writable_header(
    db: Session,
    parent_item_id: str,
    bom_header_id: int | None = None,
) -> ItemBOMHeader:
    header = resolve_header(db, parent_item_id, bom_header_id)
    if header is None:
        max_ver = (
            db.query(func.coalesce(func.max(ItemBOMHeader.version_no), 0))
            .filter(ItemBOMHeader.parent_item_id == parent_item_id)
            .scalar()
        )
        header = ItemBOMHeader(
            parent_item_id=parent_item_id,
            version_no=int(max_ver) + 1,
            status="active",
            effective_from=date.today(),
        )
        db.add(header)
        db.flush()
        return header
    if header.status not in WRITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit an obsolete BOM version. Create a new version first.",
        )
    return header


def create_draft_version(
    db: Session,
    parent_item_id: str,
    copy_from_header_id: int | None = None,
    notes: str | None = None,
) -> ItemBOMHeader:
    source = resolve_header(db, parent_item_id, copy_from_header_id)
    max_ver = (
        db.query(func.coalesce(func.max(ItemBOMHeader.version_no), 0))
        .filter(ItemBOMHeader.parent_item_id == parent_item_id)
        .scalar()
    )
    header = ItemBOMHeader(
        parent_item_id=parent_item_id,
        version_no=int(max_ver) + 1,
        status="draft",
        notes=notes,
    )
    db.add(header)
    db.flush()
    if source is not None:
        lines = (
            db.query(ItemBOMComponent)
            .filter(ItemBOMComponent.bom_header_id == source.bom_header_id)
            .all()
        )
        for line in lines:
            db.add(
                ItemBOMComponent(
                    bom_header_id=header.bom_header_id,
                    parent_item_id=parent_item_id,
                    component_item_id=line.component_item_id,
                    component_code=line.component_code,
                    quantity_per=line.quantity_per,
                    item_type=line.item_type,
                    scrap_factor=line.scrap_factor,
                    yield_loss_percentage=line.yield_loss_percentage,
                )
            )
    return header


def activate_header(db: Session, parent_item_id: str, bom_header_id: int) -> ItemBOMHeader:
    header = resolve_header(db, parent_item_id, bom_header_id)
    if header is None:
        raise HTTPException(status_code=404, detail="BOM version not found")
    for other in list_headers(db, parent_item_id):
        if other.bom_header_id != header.bom_header_id and other.status == "active":
            other.status = "obsolete"
    header.status = "active"
    if header.effective_from is None:
        header.effective_from = date.today()
    return header


def assert_line_writable(line: ItemBOMComponent) -> ItemBOMHeader:
    header = line.header
    if header is None:
        raise HTTPException(status_code=400, detail="BOM line is missing a version header")
    if header.status not in WRITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit an obsolete BOM version. Create a new version first.",
        )
    return header
