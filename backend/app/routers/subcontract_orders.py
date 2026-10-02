# @author: Wendy Yang
# @date: 2026-09-19

from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import (
    ComponentIssueLog,
    FinishedGoodsReceipt,
    Item,
    MaterialIssue,
    MaterialIssueLine,
    SubcontractOrder,
    SubcontractOrderComponent,
    SubcontractOrderItem,
    SubcontractOrderLineCharge,
    Supplier,
    User,
)
from app.schemas import (
    CalculateComponentsResponse,
    CalculatedComponentLine,
    EligibleMaterialPoScoRead,
    EligibleSalesOrderRead,
    FinishedGoodsReceiptCreate,
    FinishedGoodsReceiptRead,
    MaterialIssueCreate,
    MaterialIssueRead,
    PreviewComponentLine,
    PreviewComponentsRequest,
    PreviewComponentsResponse,
    SalesOrderSubcontractAvailabilityRead,
    SubcontractChargeRead,
    DocumentChangeLogRead,
    DocumentRevisionRead,
    DocumentReviseRequest,
    SubcontractOrderAmendRequest,
    SubcontractOrderCreate,
    SubcontractOrderLineCreate,
    SubcontractOrderRead,
    SubcontractOrderUpdate,
    UnfulfilledScoComponentRead,
)
from app.services import approval, inventory
from app.services.document_revisions import list_change_logs, list_revisions, resync_sco_bom_quantities
from app.services.document_sequences import (
    DOC_FINISHED_GOODS_RECEIPT,
    DOC_MATERIAL_ISSUE,
    DOC_SUBCONTRACT_ORDER,
    generate_document_number,
    next_document_number,
)
from app.services.period_close import assert_transaction_date_open
from app.services.bom_versions import resolve_header
from app.services.catalog import explode_assembly_components, material_bom_lines, required_quantity
from app.services.po_sco_demand import list_eligible_for_material_po, unfulfilled_components
from app.services.subcontract import (
    apply_line_charge_sheet,
    attach_sco_remaining_flags,
    attach_sco_revise_flags,
    close_subcontract_order_remaining,
    assert_linked_sales_order_approved,
    assert_sco_fulfillment_allowed,
    assert_sco_receive_allowed,
    assert_so_line_allocatable,
    compute_charge_sheet,
    default_cost_sheet,
    list_eligible_sales_orders,
    remaining_qty_for_so_line,
    sales_order_subcontract_availability,
    so_is_eligible,
)

router = APIRouter(prefix="/subcontract-orders", tags=["subcontract-orders"])

_CLOSED_STATUSES = {"COMPLETED", "CANCELLED"}


def _load_sco(db: Session, sco_number: str) -> SubcontractOrder | None:
    sco = (
        db.query(SubcontractOrder)
        .options(
            selectinload(SubcontractOrder.components),
            selectinload(SubcontractOrder.bom_header),
            selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.components),
            selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.charges),
            selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.bom_header),
            selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.sales_order_item),
            selectinload(SubcontractOrder.material_issues).selectinload(MaterialIssue.lines),
            selectinload(SubcontractOrder.finished_goods_receipts),
        )
        .filter(SubcontractOrder.sco_number == sco_number)
        .first()
    )
    if sco is not None:
        attach_sco_revise_flags(sco)
        attach_sco_remaining_flags(sco, db)
    return sco


def _normalize_lines(payload: SubcontractOrderCreate) -> list[SubcontractOrderLineCreate]:
    if payload.lines:
        return payload.lines
    return [
        SubcontractOrderLineCreate(
            item_id=payload.item_id or "",
            quantity_ordered=payload.quantity_ordered or 0,
            bom_header_id=payload.bom_header_id,
            unit_price=payload.unit_price,
        )
    ]


def _charge_read(row: dict) -> SubcontractChargeRead:
    return SubcontractChargeRead(
        line_no=row["line_no"],
        name=row["name"],
        detail_explanation=row.get("detail_explanation"),
        labor_minutes=row.get("labor_minutes"),
        sf_rate=row.get("sf_rate"),
        cost_per_unit=row.get("cost_per_unit") or Decimal("0"),
        margin_percent=row.get("margin_percent"),
        is_margin=bool(row.get("is_margin")),
    )


def _calculated_line(row: dict, **extra) -> CalculatedComponentLine:
    return CalculatedComponentLine(
        component_item_id=row["component_item_id"],
        description=row.get("description"),
        uom=row.get("uom"),
        quantity_per=row["quantity_per"],
        scrap_factor=row.get("scrap_factor") or Decimal("0"),
        yield_loss_percentage=row.get("yield_loss_percentage") or Decimal("0"),
        quantity_required=row["quantity_required"],
        quantity_issued=row.get("quantity_issued") or Decimal("0"),
        quantity_remaining=row.get("quantity_remaining") or row["quantity_required"],
        on_hand_quantity=row.get("on_hand_quantity") or 0,
        available_to_promise=row.get("available_to_promise") or 0,
        stock_shortfall=row.get("stock_shortfall") or Decimal("0"),
        primary_vendor_id=row.get("primary_vendor_id"),
        primary_vendor_sku=row.get("primary_vendor_sku"),
        unit_cost=row.get("unit_cost"),
        sco_line_id=extra.get("sco_line_id"),
        notes=extra.get("notes"),
        is_overridden=bool(extra.get("is_overridden")),
    )


def _consolidate(components: list[CalculatedComponentLine]) -> list[CalculatedComponentLine]:
    grouped: dict[str, CalculatedComponentLine] = {}
    for row in components:
        existing = grouped.get(row.component_item_id)
        if existing is None:
            grouped[row.component_item_id] = row.model_copy()
            continue
        existing.quantity_required += row.quantity_required
        existing.quantity_issued += row.quantity_issued
        existing.quantity_remaining += row.quantity_remaining
        existing.stock_shortfall = max(
            existing.quantity_required - Decimal(existing.available_to_promise),
            Decimal("0"),
        )
    return list(grouped.values())


def _resolve_issue_component(
    components: list[SubcontractOrderComponent],
    component_item_id: str,
    sco_line_id: int | None,
) -> SubcontractOrderComponent:
    matches = [c for c in components if c.component_item_id == component_item_id]
    if sco_line_id is not None:
        matches = [c for c in matches if c.sco_line_id == sco_line_id]
    if not matches:
        raise HTTPException(
            status_code=400,
            detail=f"Component {component_item_id} is not part of this subcontract order's BOM",
        )
    if len(matches) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Component {component_item_id} appears on multiple assembly lines; provide sco_line_id",
        )
    return matches[0]


@router.get("", response_model=list[SubcontractOrderRead])
def list_subcontract_orders(
    skip: int = 0,
    limit: int = 100,
    sales_order_id: str | None = Query(
        default=None,
        max_length=50,
        description="Return only subcontract orders linked to this parent sales order.",
    ),
    db: Session = Depends(get_db),
) -> list[SubcontractOrder]:
    query = db.query(SubcontractOrder).options(
        selectinload(SubcontractOrder.components),
        selectinload(SubcontractOrder.bom_header),
        selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.components),
        selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.charges),
        selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.bom_header),
        selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.sales_order_item),
        selectinload(SubcontractOrder.material_issues).selectinload(MaterialIssue.lines),
        selectinload(SubcontractOrder.finished_goods_receipts),
    )
    if sales_order_id:
        query = query.filter(SubcontractOrder.sales_order_id == sales_order_id)
    rows = (
        query.order_by(SubcontractOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    for sco in rows:
        attach_sco_revise_flags(sco)
        attach_sco_remaining_flags(sco, db)
    return rows


@router.get("/eligible-sales-orders", response_model=list[EligibleSalesOrderRead])
def eligible_sales_orders(
    q: str = "",
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
) -> list[dict]:
    return list_eligible_sales_orders(db, q=q, skip=skip, limit=limit)


@router.get("/eligible-for-material-po", response_model=list[EligibleMaterialPoScoRead])
def eligible_for_material_po(
    q: str = "",
    skip: int = 0,
    limit: int = Query(default=40, le=200),
    db: Session = Depends(get_db),
) -> list[dict]:
    return list_eligible_for_material_po(db, q=q, skip=skip, limit=limit)


@router.get(
    "/{sco_number}/unfulfilled-components",
    response_model=list[UnfulfilledScoComponentRead],
)
def get_unfulfilled_components(
    sco_number: str,
    supplier_id: str | None = None,
    exclude_po_number: str | None = None,
    include_fully_covered: bool = False,
    db: Session = Depends(get_db),
) -> list[dict]:
    return unfulfilled_components(
        db,
        sco_number,
        supplier_id=supplier_id or None,
        exclude_po_number=exclude_po_number or None,
        include_fully_covered=include_fully_covered,
    )


@router.get(
    "/sales-order-lines/{sales_order_id}",
    response_model=SalesOrderSubcontractAvailabilityRead,
)
def get_sales_order_subcontract_lines(
    sales_order_id: str, db: Session = Depends(get_db)
) -> dict:
    return sales_order_subcontract_availability(db, sales_order_id)


@router.post("/preview-components", response_model=PreviewComponentsResponse)
def preview_components(
    payload: PreviewComponentsRequest, db: Session = Depends(get_db)
) -> PreviewComponentsResponse:
    warnings: list[dict] = []
    can_create = True
    preview_lines: list[PreviewComponentLine] = []
    flat: list[CalculatedComponentLine] = []

    if payload.sales_order_id:
        try:
            parent_so = assert_linked_sales_order_approved(db, payload.sales_order_id)
            if parent_so is not None and not so_is_eligible(parent_so):
                can_create = False
                warnings.append(
                    {
                        "code": "SO_NOT_ELIGIBLE",
                        "message": (
                            f"Sales order {payload.sales_order_id} is {parent_so.status} "
                            "and cannot be subcontracted"
                        ),
                    }
                )
        except HTTPException as exc:
            can_create = False
            warnings.append(
                {
                    "code": "SO_NOT_APPROVED",
                    "message": exc.detail,
                }
            )

    seen_so_items: set[int] = set()
    for raw in payload.lines:
        if raw.so_item_id is not None:
            if raw.so_item_id in seen_so_items:
                can_create = False
                warnings.append(
                    {
                        "code": "DUPLICATE_SO_LINE",
                        "so_item_id": raw.so_item_id,
                        "message": f"Sales order line {raw.so_item_id} is selected more than once",
                    }
                )
                continue
            seen_so_items.add(raw.so_item_id)
            if payload.sales_order_id:
                try:
                    so_item = assert_so_line_allocatable(
                        db,
                        sales_order_id=payload.sales_order_id,
                        so_item_id=raw.so_item_id,
                        item_id=raw.item_id,
                        quantity=raw.quantity_ordered,
                    )
                    remaining = remaining_qty_for_so_line(db, so_item)
                except HTTPException as exc:
                    can_create = False
                    warnings.append(
                        {
                            "code": "SO_LINE_INVALID",
                            "so_item_id": raw.so_item_id,
                            "message": exc.detail,
                        }
                    )
                    remaining = None
            else:
                remaining = None
        else:
            remaining = None

        try:
            header = resolve_header(db, raw.item_id, raw.bom_header_id)
        except HTTPException as exc:
            can_create = False
            warnings.append(
                {
                    "code": "BOM_NOT_FOUND",
                    "item_id": raw.item_id,
                    "message": exc.detail,
                }
            )
            header = None

        if header is not None and header.status == "obsolete":
            can_create = False
            warnings.append(
                {
                    "code": "OBSOLETE_BOM",
                    "item_id": raw.item_id,
                    "message": f"Cannot use obsolete BOM v{header.version_no} for {raw.item_id}",
                }
            )

        try:
            exploded = explode_assembly_components(
                db,
                raw.item_id,
                raw.quantity_ordered,
                bom_header_id=header.bom_header_id if header else raw.bom_header_id,
            )
        except HTTPException as exc:
            can_create = False
            warnings.append(
                {
                    "code": "NO_ACTIVE_BOM",
                    "item_id": raw.item_id,
                    "message": exc.detail,
                }
            )
            exploded = []

        charge_input = [c.model_dump() for c in raw.charges] if raw.charges else default_cost_sheet()
        sheet = compute_charge_sheet(charge_input, raw.quantity_ordered)
        if raw.unit_price and not raw.charges:
            sheet["unit_price"] = raw.unit_price
            sheet["line_total"] = (raw.unit_price * raw.quantity_ordered).quantize(Decimal("0.01"))

        components = []
        for row in exploded:
            calc = _calculated_line(row)
            if calc.stock_shortfall > 0:
                warnings.append(
                    {
                        "code": "INSUFFICIENT_STOCK",
                        "so_item_id": raw.so_item_id,
                        "component_item_id": calc.component_item_id,
                        "message": (
                            f"{calc.component_item_id} short {calc.stock_shortfall} "
                            f"(need {calc.quantity_required}, ATP {calc.available_to_promise})"
                        ),
                    }
                )
            components.append(calc)
            flat.append(calc)

        preview_lines.append(
            PreviewComponentLine(
                so_item_id=raw.so_item_id,
                item_id=raw.item_id,
                quantity_ordered=raw.quantity_ordered,
                bom_header_id=raw.bom_header_id,
                bom_header_id_resolved=header.bom_header_id if header else None,
                bom_version_no=header.version_no if header else None,
                bom_status=header.status if header else None,
                quantity_remaining_on_so_line=remaining,
                charges=[_charge_read(c) for c in sheet["charges"]],
                unit_price=sheet["unit_price"],
                line_total=sheet["line_total"],
                components=components,
            )
        )

    return PreviewComponentsResponse(
        can_create=can_create,
        warnings=warnings,
        default_charges=[_charge_read(c) for c in default_cost_sheet()],
        lines=preview_lines,
        consolidated_components=_consolidate(flat),
    )


@router.post("", response_model=SubcontractOrderRead, status_code=status.HTTP_201_CREATED)
def create_subcontract_order(
    payload: SubcontractOrderCreate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    if payload.sales_order_id:
        parent_so = assert_linked_sales_order_approved(db, payload.sales_order_id)
        if parent_so is not None and not so_is_eligible(parent_so):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Sales order {payload.sales_order_id} is {parent_so.status} "
                    "and cannot be subcontracted"
                ),
            )

    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=400, detail="Supplier not found")

    lines = _normalize_lines(payload)
    if not lines:
        raise HTTPException(status_code=400, detail="At least one finished-good line is required")

    seen_so_items: set[int] = set()
    prepared: list[dict] = []
    for raw in lines:
        product = db.get(Item, raw.item_id)
        if product is None:
            raise HTTPException(status_code=400, detail=f"Item {raw.item_id} not found")

        so_item = None
        if payload.sales_order_id or raw.so_item_id:
            if not payload.sales_order_id or not raw.so_item_id:
                raise HTTPException(
                    status_code=400,
                    detail="sales_order_id and so_item_id must be provided together",
                )
            if raw.so_item_id in seen_so_items:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sales order line {raw.so_item_id} is selected more than once",
                )
            seen_so_items.add(raw.so_item_id)
            so_item = assert_so_line_allocatable(
                db,
                sales_order_id=payload.sales_order_id,
                so_item_id=raw.so_item_id,
                item_id=raw.item_id,
                quantity=raw.quantity_ordered,
            )

        header = resolve_header(db, raw.item_id, raw.bom_header_id)
        if header is not None and header.status == "obsolete":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot pin obsolete BOM v{header.version_no} for {raw.item_id}",
            )
        bom_lines = material_bom_lines(
            db, raw.item_id, bom_header_id=header.bom_header_id if header else None
        )
        if not bom_lines:
            raise HTTPException(
                status_code=400,
                detail=f"Item {raw.item_id} has no Material Bill of Materials / subcontract kit",
            )

        exploded_qty = {
            line.component_item_id: required_quantity(
                line.quantity_per,
                raw.quantity_ordered,
                getattr(line, "scrap_factor", None),
                getattr(line, "yield_loss_percentage", None),
            )
            for line in bom_lines
        }
        overrides = {c.component_item_id: c for c in (raw.components or [])}
        if overrides:
            missing = set(exploded_qty) - set(overrides)
            extra = set(overrides) - set(exploded_qty)
            if missing or extra:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Component overrides must include every exploded Material SKU "
                        f"and no extras. missing={sorted(missing)} extra={sorted(extra)}"
                    ),
                )

        charge_input = [c.model_dump() for c in raw.charges] if raw.charges else []
        if charge_input:
            sheet = compute_charge_sheet(charge_input, raw.quantity_ordered)
        else:
            sheet = {
                "charges": [],
                "cost_subtotal": Decimal("0"),
                "margin_percent": Decimal("0"),
                "margin_amount": Decimal("0"),
                "unit_price": raw.unit_price or Decimal("0"),
                "line_total": ((raw.unit_price or Decimal("0")) * raw.quantity_ordered).quantize(
                    Decimal("0.01")
                ),
            }

        prepared.append(
            {
                "raw": raw,
                "header": header,
                "exploded_qty": exploded_qty,
                "overrides": overrides,
                "sheet": sheet,
                "so_item": so_item,
            }
        )

    first = prepared[0]
    header_qty = sum(item["raw"].quantity_ordered for item in prepared)
    order_date = payload.order_date or date.today()
    assert_transaction_date_open(db, order_date, document="subcontract order")
    sco = SubcontractOrder(
        sco_number=generate_document_number(db, DOC_SUBCONTRACT_ORDER, order_date),
        supplier_id=payload.supplier_id,
        sales_order_id=payload.sales_order_id,
        item_id=first["raw"].item_id,
        bom_header_id=first["header"].bom_header_id if first["header"] else None,
        quantity_ordered=header_qty,
        unit_price=first["sheet"]["unit_price"],
        status="PLANNED",
        order_date=order_date,
        expected_return_date=payload.expected_return_date,
        notes=payload.notes,
    )
    sco.root_document_id = sco.sco_number

    db.add(sco)
    db.flush()

    for index, item in enumerate(prepared, start=1):
        raw = item["raw"]
        sheet = item["sheet"]
        header = item["header"]
        sco_line = SubcontractOrderItem(
            sco_number=sco.sco_number,
            line_number=index,
            so_item_id=raw.so_item_id,
            item_id=raw.item_id,
            bom_header_id=header.bom_header_id if header else None,
            quantity_ordered=raw.quantity_ordered,
            unit_price=sheet["unit_price"],
            margin_percent=sheet["margin_percent"],
            margin_amount=sheet["margin_amount"],
            cost_subtotal=sheet["cost_subtotal"],
            tax_exempt=raw.tax_exempt,
            tax_amount=raw.tax_amount,
            line_total=sheet["line_total"] + raw.tax_amount,
            notes=raw.notes,
        )
        sco.lines.append(sco_line)
        db.flush()

        for charge in sheet["charges"]:
            sco_line.charges.append(
                SubcontractOrderLineCharge(
                    line_no=charge["line_no"],
                    name=charge["name"],
                    detail_explanation=charge.get("detail_explanation"),
                    labor_minutes=charge.get("labor_minutes"),
                    sf_rate=charge.get("sf_rate"),
                    cost_per_unit=charge.get("cost_per_unit") or Decimal("0"),
                    margin_percent=charge.get("margin_percent"),
                    is_margin=bool(charge.get("is_margin")),
                )
            )

        for component_item_id, bom_qty in item["exploded_qty"].items():
            override = item["overrides"].get(component_item_id)
            qty = override.quantity_required if override else bom_qty
            component = SubcontractOrderComponent(
                sco_number=sco.sco_number,
                sco_line_id=sco_line.sco_line_id,
                component_item_id=component_item_id,
                quantity_required=qty,
                quantity_required_bom=bom_qty,
                quantity_issued=Decimal("0"),
                is_overridden=bool(override and override.quantity_required != bom_qty),
                notes=override.notes if override else None,
            )
            sco.components.append(component)
            sco_line.components.append(component)

    db.commit()
    return _load_sco(db, sco.sco_number)


@router.get("/{sco_number}", response_model=SubcontractOrderRead)
def get_subcontract_order(sco_number: str, db: Session = Depends(get_db)) -> SubcontractOrder:
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return sco


@router.post(
    "/{sco_number}/calculate-components",
    response_model=CalculateComponentsResponse,
)
def calculate_components(
    sco_number: str, db: Session = Depends(get_db)
) -> CalculateComponentsResponse:
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    line_results: list[PreviewComponentLine] = []
    flat: list[CalculatedComponentLine] = []
    source_lines = sco.lines or []
    if not source_lines:
        source_lines = [
            type(
                "LegacyLine",
                (),
                {
                    "sco_line_id": None,
                    "so_item_id": None,
                    "item_id": sco.item_id,
                    "quantity_ordered": sco.quantity_ordered,
                    "bom_header_id": sco.bom_header_id,
                    "bom_version_no": sco.bom_version_no,
                    "components": sco.components,
                    "charges": [],
                    "unit_price": sco.unit_price,
                    "line_total": (sco.unit_price or 0) * (sco.quantity_ordered or 0),
                },
            )()
        ]

    for line in source_lines:
        exploded = explode_assembly_components(
            db, line.item_id, line.quantity_ordered, bom_header_id=line.bom_header_id
        )
        issued_by_component = {
            c.component_item_id: Decimal(str(c.quantity_issued or 0)) for c in (line.components or [])
        }
        notes_by_component = {c.component_item_id: c.notes for c in (line.components or [])}
        overridden = {c.component_item_id: c.is_overridden for c in (line.components or [])}
        stored_qty = {c.component_item_id: c.quantity_required for c in (line.components or [])}
        components: list[CalculatedComponentLine] = []
        for row in exploded:
            issued = issued_by_component.get(row["component_item_id"], Decimal("0"))
            required = Decimal(str(stored_qty.get(row["component_item_id"], row["quantity_required"])))
            calc = _calculated_line(
                {**row, "quantity_required": required, "quantity_issued": issued},
                sco_line_id=getattr(line, "sco_line_id", None),
                notes=notes_by_component.get(row["component_item_id"]),
                is_overridden=overridden.get(row["component_item_id"]),
            )
            calc.quantity_remaining = max(required - issued, Decimal("0"))
            components.append(calc)
            flat.append(calc)
        line_results.append(
            PreviewComponentLine(
                so_item_id=getattr(line, "so_item_id", None),
                item_id=line.item_id,
                quantity_ordered=line.quantity_ordered,
                bom_header_id=line.bom_header_id,
                bom_header_id_resolved=line.bom_header_id,
                bom_version_no=getattr(line, "bom_version_no", None),
                charges=[
                    SubcontractChargeRead.model_validate(c)
                    for c in (getattr(line, "charges", None) or [])
                ],
                unit_price=getattr(line, "unit_price", Decimal("0")) or Decimal("0"),
                line_total=getattr(line, "line_total", Decimal("0")) or Decimal("0"),
                components=components,
            )
        )

    return CalculateComponentsResponse(
        sco_number=sco.sco_number,
        assembly_item_id=sco.item_id,
        quantity_ordered=sco.quantity_ordered,
        bom_header_id=sco.bom_header_id,
        bom_version_no=sco.bom_version_no,
        components=_consolidate(flat),
        lines=line_results,
    )


@router.patch("/{sco_number}", response_model=SubcontractOrderRead)
def update_subcontract_order(
    sco_number: str, payload: SubcontractOrderUpdate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    if sco.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot modify a {sco.status.lower()} subcontract order")
    assert_transaction_date_open(db, sco.order_date, document="subcontract order")

    data = payload.model_dump(exclude_unset=True)
    line_updates = data.pop("lines", None)

    linked_so_id = data["sales_order_id"] if "sales_order_id" in data else sco.sales_order_id
    if linked_so_id:
        parent_so = assert_linked_sales_order_approved(db, linked_so_id)
        if parent_so is not None and not so_is_eligible(parent_so):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Sales order {linked_so_id} is {parent_so.status} "
                    "and cannot be subcontracted"
                ),
            )

    if line_updates is not None:
        approval = (sco.approval_status or "DRAFT").upper()
        if approval not in {"DRAFT", "REJECTED"}:
            raise HTTPException(
                status_code=400,
                detail="Cost sheet can only be edited while approval status is Draft or Rejected",
            )
        by_id = {int(line.sco_line_id): line for line in (sco.lines or [])}
        for row in line_updates:
            line_id = int(row["sco_line_id"])
            line = by_id.get(line_id)
            if line is None:
                if line_id != 0 or sco.lines:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Line {row['sco_line_id']} does not belong to subcontract order '{sco_number}'",
                    )
                line = SubcontractOrderItem(
                    sco_number=sco.sco_number,
                    line_number=1,
                    item_id=sco.item_id,
                    bom_header_id=sco.bom_header_id,
                    quantity_ordered=sco.quantity_ordered,
                    unit_price=sco.unit_price or Decimal("0"),
                    line_total=(Decimal(str(sco.unit_price or 0)) * Decimal(str(sco.quantity_ordered or 0))).quantize(
                        Decimal("0.01")
                    ),
                )
                sco.lines.append(line)
                db.flush()
            apply_line_charge_sheet(line, row.get("charges") or [], db)
        if sco.lines:
            sco.unit_price = sco.lines[0].unit_price

    if "supplier_id" in data and data["supplier_id"] is not None:
        if db.get(Supplier, data["supplier_id"]) is None:
            raise HTTPException(status_code=400, detail="Supplier not found")

    if "quantity_ordered" in data:
        issued = (
            db.query(SubcontractOrderComponent)
            .filter(
                SubcontractOrderComponent.sco_number == sco_number,
                SubcontractOrderComponent.quantity_issued > 0,
            )
            .first()
        )
        if issued is not None:
            raise HTTPException(
                status_code=400,
                detail="Cannot change quantity after materials have been issued",
            )
        if sco.lines and len(sco.lines) == 1:
            sco.lines[0].quantity_ordered = data["quantity_ordered"]
        if sco.sales_order_id and sco.lines:
            for line in sco.lines:
                if line.so_item_id is None:
                    continue
                if len(sco.lines) == 1:
                    assert_so_line_allocatable(
                        db,
                        sales_order_id=sco.sales_order_id,
                        so_item_id=line.so_item_id,
                        item_id=line.item_id,
                        quantity=data["quantity_ordered"],
                        exclude_sco_number=sco.sco_number,
                    )

    for key, value in data.items():
        setattr(sco, key, value)

    if "quantity_ordered" in data:
        resync_sco_bom_quantities(db, sco)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Could not save the cost sheet. Reload the subcontract order and try again.",
        ) from exc
    return _load_sco(db, sco.sco_number)


@router.post("/{sco_number}/revise", response_model=SubcontractOrderRead)
def revise_subcontract_order(
    sco_number: str,
    payload: DocumentReviseRequest | SubcontractOrderAmendRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubcontractOrder:
    approval.revise_document(
        db,
        "SUBCONTRACT_ORDER",
        sco_number,
        user,
        comments=payload.comments if payload else None,
    )
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return sco


@router.post("/{sco_number}/amend", response_model=SubcontractOrderRead)
def amend_subcontract_order(
    sco_number: str,
    payload: SubcontractOrderAmendRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubcontractOrder:
    return revise_subcontract_order(sco_number, payload, db, user)


@router.get("/{sco_number}/revisions", response_model=list[DocumentRevisionRead])
def list_subcontract_order_revisions(sco_number: str, db: Session = Depends(get_db)) -> list:
    if db.get(SubcontractOrder, sco_number) is None:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return list_revisions(db, "SUBCONTRACT_ORDER", sco_number)


@router.get("/{sco_number}/change-logs", response_model=list[DocumentChangeLogRead])
def list_subcontract_order_change_logs(sco_number: str, db: Session = Depends(get_db)) -> list:
    if db.get(SubcontractOrder, sco_number) is None:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return list_change_logs(db, "SUBCONTRACT_ORDER", sco_number)


@router.post("/{sco_number}/close-remaining", response_model=SubcontractOrderRead)
def close_subcontract_remaining(sco_number: str, db: Session = Depends(get_db)) -> SubcontractOrder:
    close_subcontract_order_remaining(db, sco_number)
    db.commit()
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return sco


@router.post(
    "/{sco_number}/issue-materials",
    response_model=SubcontractOrderRead,
    status_code=status.HTTP_201_CREATED,
)
def issue_materials(
    sco_number: str, payload: MaterialIssueCreate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    sco = db.get(SubcontractOrder, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    assert_sco_fulfillment_allowed(sco, "issuing materials")

    if sco.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot issue materials on a {sco.status.lower()} order")

    issue_date = payload.issue_date or date.today()
    issue_id = next_document_number(db, DOC_MATERIAL_ISSUE, issue_date, payload.issue_id)
    if db.get(MaterialIssue, issue_id) is not None:
        issue_id = generate_document_number(db, DOC_MATERIAL_ISSUE, issue_date)

    components = (
        db.query(SubcontractOrderComponent)
        .filter(SubcontractOrderComponent.sco_number == sco_number)
        .all()
    )

    issue = MaterialIssue(issue_id=issue_id, sco_number=sco_number, notes=payload.notes)
    if payload.issue_date is not None:
        issue.issue_date = payload.issue_date
    db.add(issue)
    db.flush()

    for line in payload.lines:
        sco_component = _resolve_issue_component(components, line.component_item_id, line.sco_line_id)
        product = db.get(Item, line.component_item_id)
        if product is None:
            raise HTTPException(status_code=400, detail=f"Component product {line.component_item_id} not found")

        qty_issued = Decimal(str(line.quantity_issued))
        on_hand = Decimal(inventory.available_on_hand(db, line.component_item_id))
        if qty_issued > on_hand:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient on-hand quantity for {line.component_item_id}: "
                    f"available={on_hand}, requested={qty_issued}. "
                    "Receive the material purchase order (or add stock) before issuing the kit."
                ),
            )

        remaining = sco_component.quantity_required - (sco_component.quantity_issued or 0)
        if qty_issued > remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot issue {qty_issued} of {line.component_item_id}; "
                    f"remaining on line={remaining}"
                ),
            )

        if qty_issued != qty_issued.to_integral_value():
            raise HTTPException(
                status_code=400,
                detail=f"Issue quantity for {line.component_item_id} must be a whole number",
            )
        try:
            inventory.issue_stock(
                db,
                item_id=line.component_item_id,
                quantity=int(qty_issued),
                reference=issue.issue_id,
                notes=payload.notes or f"Issued to subcontract order {sco_number}",
            )
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            product.on_hand_quantity = int(on_hand - qty_issued)
        product.wip_quantity = int(Decimal(product.wip_quantity or 0) + qty_issued)
        sco_component.quantity_issued = sco_component.quantity_issued + line.quantity_issued

        db.add(
            MaterialIssueLine(
                issue_id=issue.issue_id,
                sco_line_id=sco_component.sco_line_id,
                component_item_id=line.component_item_id,
                quantity_issued=line.quantity_issued,
            )
        )
        db.add(
            ComponentIssueLog(
                sco_number=sco_number,
                sco_line_id=sco_component.sco_line_id,
                issue_id=issue.issue_id,
                component_item_id=line.component_item_id,
                quantity_issued=line.quantity_issued,
                notes=payload.notes,
            )
        )

    db.flush()
    all_components = (
        db.query(SubcontractOrderComponent)
        .filter(SubcontractOrderComponent.sco_number == sco_number)
        .all()
    )
    if all(c.quantity_issued >= c.quantity_required for c in all_components):
        sco.status = "MATERIALS_ISSUED"
    elif any(c.quantity_issued > 0 for c in all_components):
        sco.status = "PARTIALLY_ISSUED"

    db.commit()
    return _load_sco(db, sco_number)


@router.post(
    "/{sco_number}/receive-goods",
    response_model=SubcontractOrderRead,
    status_code=status.HTTP_201_CREATED,
)
def receive_goods(
    sco_number: str,
    payload: FinishedGoodsReceiptCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubcontractOrder:
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    assert_sco_receive_allowed(sco)

    receipt_date = payload.receipt_date or date.today()
    receipt_id = next_document_number(
        db, DOC_FINISHED_GOODS_RECEIPT, receipt_date, payload.receipt_id
    )
    if db.get(FinishedGoodsReceipt, receipt_id) is not None:
        receipt_id = generate_document_number(db, DOC_FINISHED_GOODS_RECEIPT, receipt_date)

    sco_lines = list(sco.lines or [])
    target_line = None
    if payload.sco_line_id is not None:
        target_line = next((line for line in sco_lines if line.sco_line_id == payload.sco_line_id), None)
        if target_line is None:
            raise HTTPException(status_code=400, detail="Subcontract order line not found")
    elif len(sco_lines) == 1:
        target_line = sco_lines[0]
    elif sco_lines:
        raise HTTPException(
            status_code=400,
            detail="sco_line_id is required when the subcontract order has multiple assemblies",
        )

    item_id = target_line.item_id if target_line else sco.item_id
    ordered_qty = target_line.quantity_ordered if target_line else sco.quantity_ordered
    unit_price = target_line.unit_price if target_line else sco.unit_price

    product = db.get(Item, item_id)
    if product is None:
        raise HTTPException(status_code=400, detail="Finished product not found")

    existing_receipts = [
        r
        for r in (sco.finished_goods_receipts or [])
        if (target_line is None)
        or (r.sco_line_id == target_line.sco_line_id)
        or (r.sco_line_id is None and target_line.line_number == 1)
    ]
    total_received_so_far = sum((r.quantity_received for r in existing_receipts), 0)
    remaining = ordered_qty - total_received_so_far
    if payload.quantity_received > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot receive more than remaining ordered quantity: remaining={remaining}",
        )

    wip = Decimal(product.wip_quantity or 0)
    deduct = min(wip, Decimal(payload.quantity_received))
    product.wip_quantity = int(wip - deduct)

    assert_transaction_date_open(
        db, payload.receipt_date or date.today(), document="finished goods receipt"
    )
    receipt = FinishedGoodsReceipt(
        receipt_id=receipt_id,
        sco_number=sco_number,
        sco_line_id=target_line.sco_line_id if target_line else None,
        quantity_received=payload.quantity_received,
        notes=payload.notes,
    )
    if payload.receipt_date is not None:
        receipt.receipt_date = payload.receipt_date
    db.add(receipt)
    db.flush()

    inventory.receive_stock(
        db,
        item_id=item_id,
        quantity=int(payload.quantity_received),
        reference=receipt_id,
        notes=payload.notes or f"Finished goods from subcontract order {sco_number}",
    )

    from app.services import p2p

    p2p.accrue_subcontract_receipt(
        db,
        sco=sco,
        quantity_received=payload.quantity_received,
        unit_cost=payload.unit_cost if payload.unit_cost is not None else unit_price,
        receipt_date=payload.receipt_date,
        notes=payload.notes,
        external_receipt_id=receipt_id,
        item_id=item_id,
        source_line_id=target_line.sco_line_id if target_line else None,
        received_by_user_id=user.id,
    )

    all_receipts = (
        db.query(FinishedGoodsReceipt)
        .filter(FinishedGoodsReceipt.sco_number == sco_number)
        .all()
    )
    received_by_line: dict[int | None, int] = defaultdict(int)
    for row in all_receipts:
        received_by_line[row.sco_line_id] += row.quantity_received

    if sco_lines:
        complete = True
        any_received = False
        for line in sco_lines:
            got = received_by_line.get(line.sco_line_id, 0)
            if line.line_number == 1:
                got += received_by_line.get(None, 0)
            if got > 0:
                any_received = True
            if got < line.quantity_ordered:
                complete = False
        sco.status = "COMPLETED" if complete else "PARTIALLY_RECEIVED" if any_received else sco.status
    else:
        new_total = sum(received_by_line.values())
        sco.status = "COMPLETED" if new_total >= sco.quantity_ordered else "PARTIALLY_RECEIVED"

    db.commit()
    return _load_sco(db, sco_number)
