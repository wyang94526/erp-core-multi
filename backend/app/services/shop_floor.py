# @author: Wendy Yang
# @date: 2026-10-11

"""Shop-floor execution for a production-order routing step.

Completing a step records labor, good/scrap/rework, in-process checks, downtime,
and machine readings. Component stock is backflushed for the good and scrap
quantity that has not already been consumed on this order. Rework does not
consume additional material. Finished goods still go through production receipt.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    Item,
    ProductionMaterialBackflush,
    ProductionOrder,
    ProductionOrderRouting,
    ProductionStepDowntime,
    ProductionStepLaborLog,
    ProductionStepParameter,
    ProductionStepQuality,
    ProductionStepScrap,
)
from app.services.item_types import skip_inventory_movement
from app.services.production import _consume_component, _order_for_company

SCRAP_REASONS = {
    "OPERATOR_ERROR": "Operator error",
    "MACHINE_MALFUNCTION": "Machine malfunction",
    "RAW_MATERIAL_DEFECT": "Raw material defect",
    "TOOLING": "Tooling",
    "OTHER": "Other",
}
DEFECT_CLASSES = {
    "DIMENSIONAL": "Dimensional",
    "COSMETIC": "Cosmetic",
    "FUNCTIONAL": "Functional",
    "MATERIAL": "Material",
    "OTHER": "Other",
}
DOWNTIME_REASONS = {
    "MAINTENANCE": "Maintenance",
    "TOOL_CHANGE": "Tool change",
    "WAITING_MATERIAL": "Waiting for material",
    "NO_OPERATOR": "Waiting for operator",
    "OTHER": "Other",
}


def consuming_units(good: int, scrap: int) -> int:
    """Units that pull components. Rework is excluded."""
    return int(good) + int(scrap)


def backflush_delta_units(reported: int, already: int) -> int:
    """Parent units still to backflush after an earlier step consumed some of the order."""
    return max(int(reported) - int(already), 0)


def proportional_issue_qty(quantity_required, qty_ordered: int, units: int) -> int:
    """Whole component quantity for `units` of a parent whose BOM requirement is for the full order."""
    if int(qty_ordered) <= 0 or int(units) <= 0:
        return 0
    raw = Decimal(str(quantity_required or 0)) * Decimal(int(units)) / Decimal(int(qty_ordered))
    return int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def time_variance(setup_standard, run_per_unit, units: int, setup_actual, run_actual) -> dict:
    """Actual setup + run minutes compared with the standard copied onto the step."""
    standard = Decimal(str(setup_standard or 0)) + Decimal(str(run_per_unit or 0)) * Decimal(int(units))
    actual = Decimal(str(setup_actual or 0)) + Decimal(str(run_actual or 0))
    return {
        "standard_minutes": standard.quantize(Decimal("0.01")),
        "actual_minutes": actual.quantize(Decimal("0.01")),
        "variance_minutes": (actual - standard).quantize(Decimal("0.01")),
    }


def labor_hours_between(started_at: datetime, stopped_at: datetime) -> Decimal:
    seconds = (stopped_at - started_at).total_seconds()
    if seconds < 0:
        raise HTTPException(status_code=400, detail="Labor stop time is before the start time")
    return (Decimal(str(seconds)) / Decimal("3600")).quantize(Decimal("0.0001"))


def _code(value: str | None, catalog: dict[str, str], label: str) -> str:
    code = (value or "").strip().upper()
    if code not in catalog:
        raise HTTPException(status_code=400, detail=f"{label} must be one of {', '.join(catalog)}")
    return code


def _step(order: ProductionOrder, step_id: int) -> ProductionOrderRouting:
    step = next((row for row in order.operations if row.id == step_id), None)
    if step is None:
        raise HTTPException(status_code=404, detail="Routing step not found")
    return step


def _require_open_order(order: ProductionOrder) -> None:
    if order.status not in {"released", "in_process"}:
        raise HTTPException(status_code=400, detail="Shop-floor reporting starts after the order is released")


def _earlier_step_open(order: ProductionOrder, step: ProductionOrderRouting) -> ProductionOrderRouting | None:
    earlier = [
        row
        for row in order.operations
        if row.operation_sequence < step.operation_sequence and row.status != "completed"
    ]
    if not earlier:
        return None
    return min(earlier, key=lambda row: row.operation_sequence)


def start_step(db: Session, company, order_id: str, step_id: int, operator_id) -> ProductionOrderRouting:
    order = _order_for_company(db, company, order_id)
    _require_open_order(order)
    step = _step(order, step_id)
    if step.status == "completed":
        raise HTTPException(status_code=400, detail="This routing step is already completed")
    if step.status == "running":
        return step
    blocked = _earlier_step_open(order, step)
    if blocked is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Complete sequence {blocked.operation_sequence} before starting sequence {step.operation_sequence}",
        )
    now = datetime.now(timezone.utc)
    step.status = "running"
    step.started_at = step.started_at or now
    step.operator_user_id = operator_id
    if order.status == "released":
        order.status = "in_process"
    db.add(
        ProductionStepLaborLog(
            company_id=order.company_id,
            routing_step_id=step.id,
            production_order_id=order.production_order_id,
            operator_user_id=operator_id,
            started_at=now,
            labor_hours=Decimal("0"),
        )
    )
    db.commit()
    db.refresh(step)
    return step


def _close_open_labor(step: ProductionOrderRouting, stopped_at: datetime) -> Decimal:
    total = Decimal(step.labor_hours or 0)
    for log in step.labor_logs:
        if log.stopped_at is not None:
            continue
        log.stopped_at = stopped_at
        log.labor_hours = labor_hours_between(log.started_at, stopped_at)
        total += Decimal(log.labor_hours or 0)
    step.labor_hours = total.quantize(Decimal("0.0001"))
    return step.labor_hours


def _record_details(order: ProductionOrder, step: ProductionOrderRouting, payload) -> None:
    for check in payload.quality_checks:
        defect = _code(check.defect_class, DEFECT_CLASSES, "Defect class") if check.defect_class else None
        db_row = ProductionStepQuality(
            company_id=order.company_id,
            routing_step_id=step.id,
            characteristic=check.characteristic.strip(),
            specification=(check.specification or "").strip() or None,
            measured_value=(check.measured_value or "").strip() or None,
            passed=bool(check.passed),
            defect_class=defect,
        )
        step.quality_checks.append(db_row)
    for stop in payload.downtime:
        step.downtime_logs.append(
            ProductionStepDowntime(
                company_id=order.company_id,
                routing_step_id=step.id,
                reason_code=_code(stop.reason_code, DOWNTIME_REASONS, "Downtime reason"),
                minutes=Decimal(str(stop.minutes)),
                notes=(stop.notes or "").strip() or None,
            )
        )
    for reading in payload.parameters:
        name = reading.name.strip()
        value = reading.value.strip()
        if not name or not value:
            raise HTTPException(status_code=400, detail="A machine reading needs both a name and a value")
        step.parameters.append(
            ProductionStepParameter(
                company_id=order.company_id,
                routing_step_id=step.id,
                name=name,
                value=value,
                unit=(reading.unit or "").strip() or None,
            )
        )


def _failed_quality(step: ProductionOrderRouting) -> bool:
    return any(not row.passed for row in step.quality_checks)


def validate_step_output(good: int, scrap: int, rework: int, qty_ordered: int, scrap_reason: str | None, failed_quality: bool) -> str | None:
    """Return the scrap reason when the reported quantities can complete a step."""
    if good + scrap + rework <= 0:
        raise HTTPException(status_code=400, detail="Enter a good, scrap, or rework quantity")
    if good + scrap > int(qty_ordered):
        raise HTTPException(status_code=400, detail="Good and scrap quantity cannot exceed the order quantity")
    if rework > good + scrap:
        raise HTTPException(status_code=400, detail="Rework quantity cannot exceed the units processed at this step")
    reason = None
    if scrap > 0:
        reason = _code(scrap_reason, SCRAP_REASONS, "Scrap reason")
    if failed_quality and scrap + rework <= 0:
        raise HTTPException(
            status_code=400,
            detail="A failed in-process check needs scrap or rework before the step can be completed",
        )
    return reason


def apply_backflush(
    db: Session,
    order: ProductionOrder,
    step: ProductionOrderRouting,
    reported_units: int,
    lot_number: str | None,
    serial_number: str | None,
) -> list[ProductionMaterialBackflush]:
    """Deduct the still-open component requirement for newly reported parent units."""
    delta = backflush_delta_units(reported_units, int(order.backflushed_units or 0))
    created: list[ProductionMaterialBackflush] = []
    if delta <= 0:
        return created
    for material in order.materials:
        remaining = Decimal(material.quantity_required or 0) - Decimal(material.quantity_issued or 0)
        if remaining <= 0 or not material.component_item_id:
            continue
        wanted = proportional_issue_qty(material.quantity_required, int(order.qty_ordered), delta)
        qty = min(Decimal(wanted), remaining)
        if qty <= 0:
            continue
        issue_qty = int(qty.to_integral_value())
        if issue_qty <= 0:
            continue
        component = db.get(Item, material.component_item_id)
        if component is None:
            raise HTTPException(status_code=400, detail=f"Component item {material.component_item_id} not found")
        if not skip_inventory_movement(component):
            _consume_component(
                db,
                component,
                issue_qty,
                order.production_order_id,
                f"Backflush at sequence {step.operation_sequence} on {order.production_order_id}",
                order.warehouse_id,
            )
        material.quantity_issued = Decimal(material.quantity_issued or 0) + Decimal(issue_qty)
        row = ProductionMaterialBackflush(
            company_id=order.company_id,
            production_order_id=order.production_order_id,
            routing_step_id=step.id,
            material_id=material.id,
            component_item_id=component.item_id,
            quantity=Decimal(issue_qty),
            lot_number=lot_number,
            serial_number=serial_number,
        )
        db.add(row)
        created.append(row)
    order.backflushed_units = int(order.backflushed_units or 0) + delta
    return created


def complete_step(db: Session, company, order_id: str, step_id: int, payload) -> ProductionOrderRouting:
    order = _order_for_company(db, company, order_id)
    _require_open_order(order)
    step = _step(order, step_id)
    if step.status != "running":
        raise HTTPException(status_code=400, detail="Start the routing step before completing it")
    good = int(payload.good_quantity)
    scrap = int(payload.scrap_quantity)
    rework = int(payload.rework_quantity)
    defect = _code(payload.defect_class, DEFECT_CLASSES, "Defect class") if payload.defect_class else None
    _record_details(order, step, payload)
    reason = validate_step_output(
        good,
        scrap,
        rework,
        int(order.qty_ordered),
        payload.scrap_reason_code,
        _failed_quality(step),
    )
    now = datetime.now(timezone.utc)
    _close_open_labor(step, now)
    step.good_quantity = good
    step.scrap_quantity = scrap
    step.rework_quantity = rework
    step.scrap_reason_code = reason
    step.setup_minutes_actual = Decimal(str(payload.setup_minutes_actual or 0))
    step.run_minutes_actual = Decimal(str(payload.run_minutes_actual or 0))
    if step.setup_minutes_actual == 0 and step.run_minutes_actual == 0 and Decimal(step.labor_hours or 0) > 0:
        step.run_minutes_actual = (Decimal(step.labor_hours) * Decimal("60")).quantize(Decimal("0.01"))
    if scrap > 0:
        step.scrap_entries.append(
            ProductionStepScrap(
                company_id=order.company_id,
                routing_step_id=step.id,
                quantity=scrap,
                reason_code=reason,
                defect_class=defect,
            )
        )
    lot = (payload.lot_number or "").strip() or None
    serial = (payload.serial_number or "").strip() or None
    apply_backflush(db, order, step, consuming_units(good, scrap), lot, serial)
    step.status = "completed"
    step.completed_at = now
    order.scrapped_qty = sum(int(row.scrap_quantity or 0) for row in order.operations)
    db.commit()
    db.refresh(step)
    return step
