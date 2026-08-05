"""Inventory & Warehouse Management API routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import BinLocation, InventoryStock, Item, Warehouse
from app.schemas import (
    BinLocationCreate,
    BinLocationRead,
    InventoryStockCreate,
    InventoryStockItemRead,
    StockAdjustRequest,
    StockMovementCreate,
    StockMovementRead,
    StockTransferRequest,
    WarehouseCreate,
    WarehouseRead,
    WarehouseUpdate,
)
from app.services import inventory as inventory_service

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ------------------------------------------
# Warehouses
# ------------------------------------------

@router.get("/warehouses", response_model=list[WarehouseRead])
def list_warehouses(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[Warehouse]:
    return db.query(Warehouse).offset(skip).limit(limit).all()


@router.post("/warehouses", response_model=WarehouseRead, status_code=status.HTTP_201_CREATED)
def create_warehouse(payload: WarehouseCreate, db: Session = Depends(get_db)) -> Warehouse:
    if db.get(Warehouse, payload.warehouse_id):
        raise HTTPException(status_code=409, detail="Warehouse already exists")
    warehouse = Warehouse(**payload.model_dump())
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return warehouse


@router.get("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def get_warehouse(warehouse_id: str, db: Session = Depends(get_db)) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def update_warehouse(
    warehouse_id: str,
    payload: WarehouseUpdate,
    db: Session = Depends(get_db),
) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(warehouse, key, value)
    db.commit()
    db.refresh(warehouse)
    return warehouse


# ------------------------------------------
# Bin Locations
# ------------------------------------------

@router.get("/bins", response_model=list[BinLocationRead])
def list_bins(
    warehouse_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[BinLocationRead]:
    query = db.query(BinLocation).options(joinedload(BinLocation.warehouse))
    if warehouse_id:
        query = query.filter(BinLocation.warehouse_id == warehouse_id)
    bins = query.offset(skip).limit(limit).all()
    return [
        BinLocationRead(
            bin_id=b.bin_id,
            warehouse_id=b.warehouse_id,
            warehouse_code=b.warehouse.code if b.warehouse else None,
            bin_code=b.bin_code,
            description=b.description,
            is_active=b.is_active,
            created_at=b.created_at,
        )
        for b in bins
    ]


@router.post("/bins", response_model=BinLocationRead, status_code=status.HTTP_201_CREATED)
def create_bin(payload: BinLocationCreate, db: Session = Depends(get_db)) -> BinLocationRead:
    if db.get(BinLocation, payload.bin_id):
        raise HTTPException(status_code=409, detail="Bin already exists")
    warehouse = db.get(Warehouse, payload.warehouse_id)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    bin_loc = BinLocation(**payload.model_dump())
    db.add(bin_loc)
    db.commit()
    db.refresh(bin_loc)
    return BinLocationRead(
        bin_id=bin_loc.bin_id,
        warehouse_id=bin_loc.warehouse_id,
        warehouse_code=warehouse.code,
        bin_code=bin_loc.bin_code,
        description=bin_loc.description,
        is_active=bin_loc.is_active,
        created_at=bin_loc.created_at,
    )


# ------------------------------------------
# Stock overview / movements / actions
# ------------------------------------------

@router.get("/stock", response_model=list[InventoryStockItemRead])
def list_stock(db: Session = Depends(get_db)) -> list[InventoryStockItemRead]:
    return inventory_service.list_stock_overview(db)


@router.post("/stock", response_model=InventoryStockItemRead, status_code=status.HTTP_201_CREATED)
def create_stock_row(
    payload: InventoryStockCreate,
    db: Session = Depends(get_db),
) -> InventoryStockItemRead:
    if db.get(InventoryStock, payload.stock_id):
        raise HTTPException(status_code=409, detail="Stock row already exists")
    if not db.get(Item, payload.item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.get(Warehouse, payload.warehouse_id):
        raise HTTPException(status_code=404, detail="Warehouse not found")
    bin_loc = db.get(BinLocation, payload.bin_id)
    if not bin_loc:
        raise HTTPException(status_code=404, detail="Bin not found")
    if bin_loc.warehouse_id != payload.warehouse_id:
        raise HTTPException(status_code=400, detail="Bin does not belong to warehouse")

    stock = InventoryStock(**payload.model_dump())
    db.add(stock)
    inventory_service.sync_item_on_hand(db, payload.item_id)
    db.commit()
    overview = inventory_service.list_stock_overview(db)
    return next(item for item in overview if item.item_id == payload.item_id)


@router.get("/movements", response_model=list[StockMovementRead])
def list_movements(
    item_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[StockMovementRead]:
    rows = inventory_service.list_movements(db, item_id=item_id, skip=skip, limit=limit)
    return [
        StockMovementRead(
            movement_id=m.movement_id,
            item_id=m.item_id,
            movement_type=m.movement_type,
            quantity=m.quantity,
            warehouse_id=m.warehouse_id,
            warehouse_code=m.warehouse.code if m.warehouse else None,
            bin_id=m.bin_id,
            bin_code=m.bin_location.bin_code if m.bin_location else None,
            reference=m.reference,
            notes=m.notes,
            movement_date=m.movement_date,
            created_at=m.created_at,
        )
        for m in rows
    ]


@router.post("/movements", response_model=StockMovementRead, status_code=status.HTTP_201_CREATED)
def create_movement(
    payload: StockMovementCreate,
    db: Session = Depends(get_db),
) -> StockMovementRead:
    from app.models import StockMovement

    if db.get(StockMovement, payload.movement_id):
        raise HTTPException(status_code=409, detail="Movement already exists")
    if not db.get(Item, payload.item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    warehouse = db.get(Warehouse, payload.warehouse_id)
    bin_loc = db.get(BinLocation, payload.bin_id)
    if not warehouse or not bin_loc:
        raise HTTPException(status_code=404, detail="Warehouse or bin not found")

    data = payload.model_dump()
    if data.get("movement_date") is None:
        data.pop("movement_date", None)
    movement = StockMovement(**data)
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return StockMovementRead(
        movement_id=movement.movement_id,
        item_id=movement.item_id,
        movement_type=movement.movement_type,
        quantity=movement.quantity,
        warehouse_id=movement.warehouse_id,
        warehouse_code=warehouse.code,
        bin_id=movement.bin_id,
        bin_code=bin_loc.bin_code,
        reference=movement.reference,
        notes=movement.notes,
        movement_date=movement.movement_date,
        created_at=movement.created_at,
    )


@router.post("/adjust", response_model=InventoryStockItemRead)
def adjust_stock(payload: StockAdjustRequest, db: Session = Depends(get_db)) -> InventoryStockItemRead:
    item = inventory_service.adjust_stock(
        db,
        item_id=payload.item_id,
        quantity_delta=payload.quantity_delta,
        notes=payload.notes,
        warehouse_id=payload.warehouse_id,
        bin_id=payload.bin_id,
    )
    db.commit()
    return item


@router.post("/transfer", response_model=InventoryStockItemRead)
def transfer_stock(
    payload: StockTransferRequest,
    db: Session = Depends(get_db),
) -> InventoryStockItemRead:
    item = inventory_service.transfer_stock(
        db,
        item_id=payload.item_id,
        quantity=payload.quantity,
        to_warehouse_id=payload.to_warehouse_id,
        to_bin_id=payload.to_bin_id,
        from_warehouse_id=payload.from_warehouse_id,
        from_bin_id=payload.from_bin_id,
        notes=payload.notes,
    )
    db.commit()
    return item
