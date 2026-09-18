# @author: Wendy Yang
# @date: 2026-09-19

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
from app.services.item_types import skip_inventory_movement

DEFAULT_WAREHOUSE_ID = "WH-MAIN"
DEFAULT_WAREHOUSE_CODE = "MAIN"
DEFAULT_WAREHOUSE_NAME = "Main Warehouse"
DEFAULT_BIN_ID = "BIN-RECEIVING"
DEFAULT_BIN_CODE = "RECEIVING"


def derive_status(on_hand: int, reorder_point: int) -> str:
    if on_hand <= 0:
        return "Out of Stock"
    if on_hand <= reorder_point:
        return "Low Stock"
    return "In Stock"


def available_on_hand(db: Session, item_id: str) -> int:
    """Warehouse stock first; item-master cache only when no stock rows exist."""
    rows = (
        db.query(InventoryStock.on_hand_quantity)
        .filter(InventoryStock.item_id == item_id)
        .all()
    )
    if rows:
        return int(sum(int(row[0] or 0) for row in rows))
    item = db.get(Item, item_id)
    return int(item.on_hand_quantity or 0) if item is not None else 0


def sync_item_on_hand(db: Session, item_id: str) -> None:
    # Session autoflush is off; persist pending warehouse qty before summing.
    db.flush()
    total = (
        db.query(func.coalesce(func.sum(InventoryStock.on_hand_quantity), 0))
        .filter(InventoryStock.item_id == item_id)
        .scalar()
    )
    item = db.get(Item, item_id)
    if item:
        item.on_hand_quantity = int(total or 0)


def apply_live_on_hand(db: Session, items: list[Item]) -> None:
    """Overwrite item-master on-hand with warehouse totals when stock rows exist."""
    if not items:
        return
    db.flush()
    ids = [item.item_id for item in items]
    totals = dict(
        db.query(
            InventoryStock.item_id,
            func.coalesce(func.sum(InventoryStock.on_hand_quantity), 0),
        )
        .filter(InventoryStock.item_id.in_(ids))
        .group_by(InventoryStock.item_id)
        .all()
    )
    for item in items:
        if item.item_id in totals:
            item.on_hand_quantity = int(totals[item.item_id] or 0)


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
        if skip_inventory_movement(catalog_item):
            continue
        result.append(
            InventoryStockItemRead(
                item_id=item_id,
                description=catalog_item.description if catalog_item else None,
                uom=(catalog_item.uom if catalog_item and catalog_item.uom else "Each"),
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


def ensure_default_warehouse(db: Session) -> tuple[Warehouse, BinLocation]:
    """Return an active warehouse and bin, creating a receiving location if none exist."""
    warehouse = (
        db.query(Warehouse)
        .filter(Warehouse.is_active.is_(True))
        .order_by(Warehouse.code)
        .first()
    )
    if warehouse is None:
        warehouse = db.query(Warehouse).order_by(Warehouse.code).first()
    if warehouse is None:
        warehouse = db.get(Warehouse, DEFAULT_WAREHOUSE_ID)
    if warehouse is None:
        warehouse = Warehouse(
            warehouse_id=DEFAULT_WAREHOUSE_ID,
            name=DEFAULT_WAREHOUSE_NAME,
            code=DEFAULT_WAREHOUSE_CODE,
            address=None,
            is_active=True,
        )
        db.add(warehouse)
        db.flush()
    elif not warehouse.is_active:
        warehouse.is_active = True

    bin_row = (
        db.query(BinLocation)
        .filter(
            BinLocation.warehouse_id == warehouse.warehouse_id,
            BinLocation.is_active.is_(True),
        )
        .order_by(BinLocation.bin_code)
        .first()
    )
    if bin_row is None:
        bin_row = (
            db.query(BinLocation)
            .filter(BinLocation.warehouse_id == warehouse.warehouse_id)
            .order_by(BinLocation.bin_code)
            .first()
        )
    if bin_row is None:
        existing_default = db.get(BinLocation, DEFAULT_BIN_ID)
        bin_id = (
            DEFAULT_BIN_ID
            if existing_default is None
            else f"BIN-{uuid4().hex[:8].upper()}"
        )
        bin_row = BinLocation(
            bin_id=bin_id,
            warehouse_id=warehouse.warehouse_id,
            bin_code=DEFAULT_BIN_CODE,
            description="Default receiving bin",
            is_active=True,
        )
        db.add(bin_row)
        db.flush()
    elif not bin_row.is_active:
        bin_row.is_active = True
    return warehouse, bin_row


def issue_stock(
    db: Session,
    item_id: str,
    quantity: int,
    reference: str,
    notes: str | None = None,
    warehouse_id: str | None = None,
    bin_id: str | None = None,
) -> InventoryStockItemRead:
    """Deduct on-hand quantity and write an Issue stock movement."""
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Issue quantity must be positive")
    item = db.get(Item, item_id)
    if skip_inventory_movement(item):
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id} is not inventory-tracked and cannot be issued from stock",
        )

    stock = _resolve_stock_location(db, item_id, warehouse_id, bin_id)
    if quantity > stock.on_hand_quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient on-hand quantity for item {item_id}",
        )

    stock.on_hand_quantity -= quantity
    if stock.allocated_quantity >= quantity:
        stock.allocated_quantity -= quantity

    movement = StockMovement(
        movement_id=f"MOV-{uuid4().hex[:10].upper()}",
        item_id=item_id,
        movement_type="Issue",
        quantity=-quantity,
        warehouse_id=stock.warehouse_id,
        bin_id=stock.bin_id,
        reference=reference,
        notes=notes or f"Stock issue for {reference}",
        movement_date=date.today(),
    )
    db.add(movement)
    sync_item_on_hand(db, item_id)
    db.flush()
    return next(item for item in list_stock_overview(db) if item.item_id == item_id)


def receive_stock(
    db: Session,
    item_id: str,
    quantity: int,
    reference: str,
    notes: str | None = None,
    warehouse_id: str | None = None,
    bin_id: str | None = None,
) -> InventoryStockItemRead:
    """Increase on-hand quantity and write a Receipt stock movement."""
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Receipt quantity must be positive")
    catalog = db.get(Item, item_id)
    if skip_inventory_movement(catalog):
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id} is not inventory-tracked and cannot be received into stock",
        )

    try:
        stock = _resolve_stock_location(db, item_id, warehouse_id, bin_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        if db.get(Item, item_id) is None:
            raise HTTPException(
                status_code=400,
                detail=f"Item {item_id} not found — cannot receive into stock",
            )
        warehouse, bin_row = ensure_default_warehouse(db)
        if warehouse_id:
            chosen = db.get(Warehouse, warehouse_id)
            if chosen is None:
                raise HTTPException(status_code=400, detail="Warehouse not found for stock receipt")
            warehouse = chosen
            matching_bin = (
                db.query(BinLocation)
                .filter(
                    BinLocation.warehouse_id == warehouse.warehouse_id,
                    BinLocation.is_active.is_(True),
                )
                .order_by(BinLocation.bin_code)
                .first()
            )
            if matching_bin is None:
                matching_bin = BinLocation(
                    bin_id=f"BIN-{uuid4().hex[:8].upper()}",
                    warehouse_id=warehouse.warehouse_id,
                    bin_code=DEFAULT_BIN_CODE,
                    description="Default receiving bin",
                    is_active=True,
                )
                db.add(matching_bin)
                db.flush()
            bin_row = matching_bin
        stock = InventoryStock(
            stock_id=f"STK-{uuid4().hex[:10].upper()}",
            item_id=item_id,
            warehouse_id=warehouse.warehouse_id,
            bin_id=bin_row.bin_id,
            on_hand_quantity=0,
            allocated_quantity=0,
            on_order_quantity=0,
            reorder_point=0,
            is_primary=True,
        )
        db.add(stock)
        db.flush()

    stock.on_hand_quantity += quantity
    movement = StockMovement(
        movement_id=f"MOV-{uuid4().hex[:10].upper()}",
        item_id=item_id,
        movement_type="Receipt",
        quantity=quantity,
        warehouse_id=stock.warehouse_id,
        bin_id=stock.bin_id,
        reference=reference,
        notes=notes or f"Stock receipt for {reference}",
        movement_date=date.today(),
    )
    db.add(movement)
    sync_item_on_hand(db, item_id)
    db.flush()
    return next(item for item in list_stock_overview(db) if item.item_id == item_id)


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
