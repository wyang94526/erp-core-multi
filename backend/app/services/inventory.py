"""
Inventory service: stock aggregation, adjustments, transfers, and
sync of items.on_hand_quantity as company-wide cache.
"""

from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import BinLocation, InventoryStock, Item, StockMovement, Warehouse
from app.schemas import InventoryStockItemRead


def derive_status(on_hand: int, reorder_point: int) -> str:
    if on_hand <= 0:
        return "Out of Stock"
    if on_hand <= reorder_point:
        return "Low Stock"
    return "In Stock"


def sync_item_on_hand(db: Session, item_id: str) -> None:
    total = (
        db.query(func.coalesce(func.sum(InventoryStock.on_hand_quantity), 0))
        .filter(InventoryStock.item_id == item_id)
        .scalar()
    )
    item = db.get(Item, item_id)
    if item:
        item.on_hand_quantity = int(total or 0)


def _primary_stock_row(rows: list[InventoryStock]) -> InventoryStock:
    primary = next((r for r in rows if r.is_primary), None)
    if primary:
        return primary
    return max(rows, key=lambda r: r.on_hand_quantity)


def list_stock_overview(db: Session) -> list[InventoryStockItemRead]:
    rows = (
        db.query(InventoryStock)
        .options(
            joinedload(InventoryStock.item),
            joinedload(InventoryStock.warehouse),
            joinedload(InventoryStock.bin_location),
        )
        .all()
    )
    by_item: dict[str, list[InventoryStock]] = {}
    for row in rows:
        by_item.setdefault(row.item_id, []).append(row)

    result: list[InventoryStockItemRead] = []
    for item_id, stock_rows in by_item.items():
        on_hand = sum(r.on_hand_quantity for r in stock_rows)
        allocated = sum(r.allocated_quantity for r in stock_rows)
        on_order = sum(r.on_order_quantity for r in stock_rows)
        primary = _primary_stock_row(stock_rows)
        reorder = primary.reorder_point
        catalog_item = primary.item
        result.append(
            InventoryStockItemRead(
                item_id=item_id,
                description=catalog_item.description if catalog_item else None,
                uom=catalog_item.uom if catalog_item else "Each",
                on_hand_quantity=on_hand,
                allocated_quantity=allocated,
                on_order_quantity=on_order,
                available_to_promise=on_hand - allocated + on_order,
                reorder_point=reorder,
                status=derive_status(on_hand, reorder),  # type: ignore[arg-type]
                primary_warehouse_id=primary.warehouse_id,
                primary_warehouse_code=primary.warehouse.code if primary.warehouse else "",
                primary_bin_code=primary.bin_location.bin_code if primary.bin_location else "",
            )
        )

    result.sort(key=lambda item: item.item_id)
    return result


def _resolve_stock_location(
    db: Session,
    item_id: str,
    warehouse_id: str | None,
    bin_id: str | None,
) -> InventoryStock:
    query = db.query(InventoryStock).filter(InventoryStock.item_id == item_id)
    if warehouse_id:
        query = query.filter(InventoryStock.warehouse_id == warehouse_id)
    if bin_id:
        query = query.filter(InventoryStock.bin_id == bin_id)

    rows = query.options(
        joinedload(InventoryStock.warehouse),
        joinedload(InventoryStock.bin_location),
        joinedload(InventoryStock.item),
    ).all()

    if not rows:
        raise HTTPException(status_code=404, detail=f"No inventory stock for item {item_id}")
    if warehouse_id or bin_id:
        return rows[0]
    return _primary_stock_row(rows)


def adjust_stock(
    db: Session,
    item_id: str,
    quantity_delta: int,
    notes: str | None = None,
    warehouse_id: str | None = None,
    bin_id: str | None = None,
) -> InventoryStockItemRead:
    if quantity_delta == 0:
        raise HTTPException(status_code=400, detail="quantity_delta must be non-zero")

    stock = _resolve_stock_location(db, item_id, warehouse_id, bin_id)
    new_qty = stock.on_hand_quantity + quantity_delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Insufficient on-hand quantity for adjustment")

    stock.on_hand_quantity = new_qty
    movement = StockMovement(
        movement_id=f"MOV-{uuid4().hex[:10].upper()}",
        item_id=item_id,
        movement_type="Adjustment",
        quantity=quantity_delta,
        warehouse_id=stock.warehouse_id,
        bin_id=stock.bin_id,
        reference=f"ADJ-{uuid4().hex[:8].upper()}",
        notes=notes or "Manual stock adjustment",
        movement_date=date.today(),
    )
    db.add(movement)
    sync_item_on_hand(db, item_id)
    db.flush()
    return next(item for item in list_stock_overview(db) if item.item_id == item_id)


def transfer_stock(
    db: Session,
    item_id: str,
    quantity: int,
    to_warehouse_id: str,
    to_bin_id: str,
    from_warehouse_id: str | None = None,
    from_bin_id: str | None = None,
    notes: str | None = None,
) -> InventoryStockItemRead:
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Transfer quantity must be positive")

    source = _resolve_stock_location(db, item_id, from_warehouse_id, from_bin_id)
    if quantity > source.on_hand_quantity:
        raise HTTPException(status_code=400, detail="Insufficient on-hand quantity for transfer")

    to_warehouse = db.get(Warehouse, to_warehouse_id)
    to_bin = db.get(BinLocation, to_bin_id)
    if not to_warehouse or not to_bin:
        raise HTTPException(status_code=404, detail="Destination warehouse or bin not found")
    if to_bin.warehouse_id != to_warehouse_id:
        raise HTTPException(status_code=400, detail="Destination bin does not belong to warehouse")

    dest = (
        db.query(InventoryStock)
        .filter(
            InventoryStock.item_id == item_id,
            InventoryStock.bin_id == to_bin_id,
        )
        .first()
    )
    if not dest:
        dest = InventoryStock(
            stock_id=f"STK-{uuid4().hex[:10].upper()}",
            item_id=item_id,
            warehouse_id=to_warehouse_id,
            bin_id=to_bin_id,
            on_hand_quantity=0,
            allocated_quantity=0,
            on_order_quantity=0,
            reorder_point=source.reorder_point,
            is_primary=False,
        )
        db.add(dest)

    source.on_hand_quantity -= quantity
    dest.on_hand_quantity += quantity

    # Keep a single primary location: prefer destination if source emptied
    if source.is_primary and source.on_hand_quantity == 0:
        source.is_primary = False
        dest.is_primary = True

    ref = f"XFER-{uuid4().hex[:8].upper()}"
    today = date.today()
    note_text = notes or f"Transfer {quantity} to {to_warehouse.code}/{to_bin.bin_code}"
    db.add(
        StockMovement(
            movement_id=f"MOV-{uuid4().hex[:10].upper()}",
            item_id=item_id,
            movement_type="Transfer",
            quantity=-quantity,
            warehouse_id=source.warehouse_id,
            bin_id=source.bin_id,
            reference=ref,
            notes=note_text,
            movement_date=today,
        )
    )
    db.add(
        StockMovement(
            movement_id=f"MOV-{uuid4().hex[:10].upper()}",
            item_id=item_id,
            movement_type="Transfer",
            quantity=quantity,
            warehouse_id=to_warehouse_id,
            bin_id=to_bin_id,
            reference=ref,
            notes=note_text,
            movement_date=today,
        )
    )

    sync_item_on_hand(db, item_id)
    db.flush()
    return next(item for item in list_stock_overview(db) if item.item_id == item_id)


def list_movements(
    db: Session,
    item_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[StockMovement]:
    query = (
        db.query(StockMovement)
        .options(
            joinedload(StockMovement.warehouse),
            joinedload(StockMovement.bin_location),
        )
        .order_by(StockMovement.movement_date.desc(), StockMovement.created_at.desc())
    )
    if item_id:
        query = query.filter(StockMovement.item_id == item_id)
    return query.offset(skip).limit(limit).all()
