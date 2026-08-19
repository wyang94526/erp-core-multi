#!/usr/bin/env python3
"""Load GTT TIPTOP basic-data CSVs into this ERP.

Source files (Aug 17 2026 export):
  GTTUSA基本資料-客戶.csv          occ_file  → customers + customerlocations
  GTTUSA基本資料-供應商.csv        pmc_file  → suppliers
  GTTUSA基本資料-料件基本資料.csv  ima_file  → items + vendoritemmappings
  GTTUSA基本資料-BOM.csv           bma/bmb   → itembomcomponents

Load order (FK-safe):
  1. customers / locations
  2. suppliers
  3. items
  4. vendor mappings (item.ima54 → supplier)
  5. BOM lines (parent + component items must exist)

Usage (venv active, Postgres reachable via .env):
  python backend/scripts/load_gtt_master_data.py --dry-run
  python backend/scripts/load_gtt_master_data.py --upsert
  python backend/scripts/load_gtt_master_data.py --only items,bom --upsert

Field mapping (TIPTOP → ERP)
------------------------------
Customer
  occ01            customer_id
  occ02            customer_number_ext (short name)
  occ18 / occ02    company_name
  occ11            tax_id
  occ29 / occ28    primary_contact_name
  occ261           primary_phone
  occ42            currency
  occ63            credit_limit
  occ45            payment_terms  (T010→NET30, T020→NET60, T000→Due on Receipt)
  occ44            preferred_incoterms
  occacti          status  (Y→ACTIVE, P→ON_HOLD, N→INACTIVE)
  occ231–233       BILL_TO address (or BOTH if same as ship-to)
  occ241–243       SHIP_TO address

Supplier
  pmc01            supplier_id
  pmc081 / pmc03   company_name
  pmc10            phone_number
  pmc091–095       address lines / city / state / postal / country (parsed)
  pmc22            currency
  pmc24            tax_id
  pmc17            payment_terms (TIPTOP payment-method code)
  pmcacti          status  (Y→Active)
  pmc58            lead_time_days
  pmc903           related-party flag (stored in notes)
  ima54 of a BOM parent → vendor_type=subcontractor, else material

Item
  ima01            item_id and customer_part_number
  ima02 + ima021   description
  ima25            uom
  ima32 / ima33    unit_price (standard, else last selling)
  ima08            source: P=purchase, M=manufactured, Z=other
  BOM parent       is_subcontract_assembly + is_outside_processed
  ima54            primary vendor mapping
  ima91 / ima53    vendor unit_cost
  ima46            minimum_order_qty

BOM
  bmb01            parent_item_id
  bmb03            component_item_id
  bmb06 / bmb07    quantity_per = qty / base
  bmb08            scrap_factor (TIPTOP % → ERP fraction if > 1)
  bmb05            skip if expired
  (no TIPTOP revision)  imported as itembomheaders version 1 (active)
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def default_data_dir() -> Path:
    env = (os.environ.get("GTT_DATA_DIR") or "").strip()
    if env:
        return Path(env).expanduser()
    return ROOT / "backend" / "data" / "imports"


DEFAULT_DATA_DIR = default_data_dir()

PAYMENT_TERMS_MAP = {
    "T000": "Due on Receipt",
    "T010": "NET30",
    "T020": "NET60",
    "T030": "NET90",
    "M020": "NET30",
}

OCC_STATUS_MAP = {"Y": "ACTIVE", "P": "ON_HOLD", "N": "INACTIVE"}

FILE_GLOBS = {
    "customers": ["customers.csv", "*客戶.csv"],
    "suppliers": ["suppliers.csv", "*供應商.csv"],
    "items": ["items.csv", "*料件*.csv"],
    "bom": ["bom.csv", "*BOM.csv"],
}


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def tip_key(header: str) -> str:
    return header.split("(", 1)[0].strip()


def read_tip_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        return []
    keys = {src: tip_key(src) for src in rows[0].keys()}
    cleaned: list[dict[str, str]] = []
    for row in rows:
        cleaned.append({keys[src]: (val or "").strip() for src, val in row.items() if src in keys})
    return cleaned


def find_file(data_dir: Path, glob_pat: str | list[str]) -> Path:
    patterns = [glob_pat] if isinstance(glob_pat, str) else glob_pat
    matches: list[Path] = []
    for pattern in patterns:
        exact = data_dir / pattern
        if "*" not in pattern and exact.is_file():
            return exact
        matches.extend(data_dir.glob(pattern))
    unique = sorted({path.resolve() for path in matches if path.is_file()})
    if not unique:
        raise FileNotFoundError(f"No file matching {patterns!r} in {data_dir}")
    return unique[0]


def blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clip(value: str | None, max_len: int) -> str | None:
    text = blank(value)
    if text is None:
        return None
    return text[:max_len]


def is_us_country(value: str | None) -> bool:
    if not value:
        return False
    key = value.strip().lower().replace(".", "")
    return key in {"us", "usa", "united states", "united states of america"}


def to_decimal(value: str | None, default: Decimal | None = None) -> Decimal | None:
    text = blank(value)
    if text is None:
        return default
    try:
        return Decimal(text)
    except InvalidOperation:
        return default


def to_int(value: str | None, default: int = 0) -> int:
    number = to_decimal(value)
    if number is None:
        return default
    return int(number)


def parse_date(value: str | None) -> date | None:
    text = blank(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def join_lines(*parts: str | None) -> str:
    chunks = [p.strip() for p in parts if p and p.strip()]
    return ", ".join(chunks)


# ---------------------------------------------------------------------------
# Address parsing (TIPTOP stores a single free-text line in occ231 / pmc091)
# ---------------------------------------------------------------------------

_US_TAIL = re.compile(
    r"^(?P<line>.+),\s*(?P<city>[A-Za-z0-9][A-Za-z0-9 .'-]*),\s*(?P<state>[A-Z]{2})\s+"
    r"(?P<postal>\d{5}(?:-\d{4})?)$"
)
_CA_TAIL = re.compile(
    r"^(?P<line>.+),\s*(?P<city>[A-Za-z0-9][A-Za-z0-9 .'-]*),\s*(?P<state>[A-Z]{2})\s+"
    r"(?P<postal>[A-Z]\d[A-Z]\s?\d[A-Z]\d)$"
)
_TW_TAIL = re.compile(
    r"^(?P<line>.+),\s*(?P<city>New Taipei City|Taipei City|Taichung City|Kaohsiung City|"
    r"Tainan City|Taoyuan City)\s+(?P<postal>\d{3,5})$",
    re.IGNORECASE,
)
_CN_POSTAL = re.compile(
    r"^(?P<line>.+?),\s*(?P<city>[A-Za-z ]+?)\s+City,.*?(?P<postal>\d{6})\b",
    re.IGNORECASE,
)
_SUITE_CITY = re.compile(
    r"^(?P<suite>(?:Suite|Ste\.?|Apt\.?|#)\s*\S+)\s+(?P<city>.+)$",
    re.IGNORECASE,
)
_TRAILING_COUNTRY = re.compile(
    r"(?:,\s*)?(?:USA|U\.S\.A\.?|United States|Canada|Taiwan(?:\s*\(R\.O\.C\.\))?|"
    r"China|P\.R\.C\.?)\s*$",
    re.IGNORECASE,
)

COUNTRY_ALIASES = {
    "USA": "USA",
    "U.S.A.": "USA",
    "U.S.A": "USA",
    "UNITED STATES": "USA",
    "CANADA": "Canada",
    "TAIWAN": "Taiwan",
    "TAIWAN (R.O.C.)": "Taiwan",
    "R.O.C.": "Taiwan",
    "CHINA": "China",
    "P.R.C.": "China",
    "P.R.C": "China",
}


@dataclass
class ParsedAddress:
    address_line1: str
    address_line2: str | None = None
    city: str = "Unknown"
    state: str | None = None
    postal_code: str = "00000"
    country: str = "USA"
    parsed: bool = False


def _split_suite_city(line1: str, city: str) -> tuple[str, str | None, str]:
    suite = _SUITE_CITY.match(city.strip())
    if not suite:
        return line1, None, city.strip()
    extra = suite.group("suite").strip()
    return f"{line1}, {extra}", extra, suite.group("city").strip()


def parse_address(*parts: str | None, default_country: str = "USA") -> ParsedAddress | None:
    raw = join_lines(*parts)
    if not raw:
        return None
    compact = re.sub(r"\s+", " ", raw).strip(" ,")
    guessed_country = default_country
    upper = compact.upper()
    for alias, name in COUNTRY_ALIASES.items():
        if upper.endswith(alias) or f", {alias}" in upper:
            guessed_country = name
            break
    stripped = _TRAILING_COUNTRY.sub("", compact).strip(" ,")

    matchers: list[tuple[re.Pattern[str], str]] = [
        (_US_TAIL, "USA"),
        (_CA_TAIL, "Canada"),
        (_TW_TAIL, "Taiwan"),
        (_CN_POSTAL, "China"),
    ]
    for pattern, country in matchers:
        match = pattern.match(stripped)
        if not match:
            continue
        line1 = match.group("line").strip(" ,")
        city = match.group("city").strip()
        line1, line2, city = _split_suite_city(line1, city)
        state = match.groupdict().get("state")
        postal = match.group("postal").upper()
        if country == "Canada" and " " not in postal and len(postal) == 6:
            postal = f"{postal[:3]} {postal[3:]}"
        return ParsedAddress(
            address_line1=clip(line1, 255) or line1,
            address_line2=clip(line2, 255) if line2 else None,
            city=clip(city, 100) or city,
            state=clip(state, 100) if state else None,
            postal_code=clip(postal, 32) or "00000",
            country=guessed_country if guessed_country != default_country else country,
            parsed=True,
        )

    return ParsedAddress(
        address_line1=clip(compact, 255) or compact[:255],
        city="Unknown",
        postal_code="00000",
        country=clip(guessed_country, 50) or "USA",
        parsed=False,
    )


# ---------------------------------------------------------------------------
# Mapped records
# ---------------------------------------------------------------------------

@dataclass
class MappedCustomer:
    customer_id: str
    payload: dict[str, Any]
    locations: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class MappedSupplier:
    supplier_id: str
    payload: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


@dataclass
class MappedItem:
    item_id: str
    payload: dict[str, Any]
    vendor_id: str | None = None
    vendor_cost: Decimal | None = None
    min_qty: Decimal = Decimal("1")
    lead_time_days: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class MappedBom:
    parent_item_id: str
    component_item_id: str
    quantity_per: Decimal
    scrap_factor: Decimal
    item_type: str = "Material"
    yield_loss_percentage: Decimal = Decimal("0")
    component_code: str | None = None
    version_no: int = 1
    status: str = "active"
    warnings: list[str] = field(default_factory=list)


@dataclass
class LoadPlan:
    customers: list[MappedCustomer] = field(default_factory=list)
    suppliers: list[MappedSupplier] = field(default_factory=list)
    items: list[MappedItem] = field(default_factory=list)
    bom: list[MappedBom] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def print_summary(self) -> None:
        print("\n=== Load plan ===")
        print(f"  customers : {len(self.customers)}")
        print(f"  suppliers : {len(self.suppliers)}")
        print(f"  items     : {len(self.items)}")
        print(f"  bom lines : {len(self.bom)}")
        if self.skipped:
            print(f"  skipped   : {len(self.skipped)}")
            for line in self.skipped:
                print(f"    - {line}")
        warnings = [
            *[(f"customer {c.customer_id}", w) for c in self.customers for w in c.warnings],
            *[(f"supplier {s.supplier_id}", w) for s in self.suppliers for w in s.warnings],
            *[(f"item {i.item_id}", w) for i in self.items for w in i.warnings],
            *[(f"bom {b.parent_item_id}/{b.component_item_id}", w) for b in self.bom for w in b.warnings],
        ]
        if warnings:
            print(f"  warnings  : {len(warnings)}")
            for label, msg in warnings:
                print(f"    - {label}: {msg}")


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: _jsonable(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


def _address_display(parts: dict[str, Any]) -> str | None:
    line1 = blank(parts.get("address_line1"))
    if not line1:
        return None
    city_line = " ".join(
        str(bit) for bit in (parts.get("city"), parts.get("state"), parts.get("postal_code")) if bit
    )
    chunks = [line1, blank(parts.get("address_line2")), city_line or None, blank(parts.get("country"))]
    return ", ".join(chunk for chunk in chunks if chunk)


def collect_warnings(plan: LoadPlan) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for customer in plan.customers:
        for msg in customer.warnings:
            rows.append({"entity": "customer", "id": customer.customer_id, "message": msg})
    for supplier in plan.suppliers:
        for msg in supplier.warnings:
            rows.append({"entity": "supplier", "id": supplier.supplier_id, "message": msg})
    for item in plan.items:
        for msg in item.warnings:
            rows.append({"entity": "item", "id": item.item_id, "message": msg})
    for line in plan.bom:
        for msg in line.warnings:
            rows.append(
                {
                    "entity": "bom",
                    "id": f"{line.parent_item_id}/{line.component_item_id}",
                    "message": msg,
                }
            )
    for skipped in plan.skipped:
        rows.append({"entity": "skipped", "id": "", "message": skipped})
    return rows


def plan_to_preview(plan: LoadPlan, data_dir: Path) -> dict[str, Any]:
    """JSON payload for the Admin dry-run viewer. Does not touch the database."""
    item_desc = {item.item_id: item.payload.get("description") for item in plan.items}
    customers = []
    for customer in plan.customers:
        locations = []
        for loc in customer.locations:
            locations.append(
                {
                    **_jsonable(loc),
                    "address_display": _address_display(loc),
                }
            )
        customers.append(
            {
                **_jsonable(customer.payload),
                "has_address": bool(locations),
                "address_display": locations[0]["address_display"] if locations else None,
                "locations": locations,
                "warnings": customer.warnings,
            }
        )
    suppliers = []
    for supplier in plan.suppliers:
        address = _address_display(supplier.payload)
        suppliers.append(
            {
                **_jsonable(supplier.payload),
                "has_address": bool(address),
                "address_display": address,
                "warnings": supplier.warnings,
            }
        )
    items = []
    vendor_mappings = []
    for item in plan.items:
        flags: list[str] = []
        if item.payload.get("is_subcontract_assembly"):
            flags.append("SCO-ASM")
        if item.payload.get("is_raw_material"):
            flags.append("RAW")
        if item.payload.get("is_purchase_item"):
            flags.append("BUY")
        mapping = None
        if item.vendor_id:
            mapping = {
                "mapping_id": None,
                "supplier_id": item.vendor_id,
                "item_id": item.item_id,
                "vendor_sku": item.item_id,
                "unit_cost": _jsonable(item.vendor_cost),
                "minimum_order_qty": _jsonable(item.min_qty if item.min_qty > 0 else Decimal("1")),
                "lead_time_days": item.lead_time_days,
                "is_primary_vendor": True,
                "created_at": None,
            }
            vendor_mappings.append(mapping)
        items.append(
            {
                **_jsonable(item.payload),
                "flags": flags,
                "vendor_id": item.vendor_id,
                "vendor_cost": _jsonable(item.vendor_cost),
                "vendor_mappings": [mapping] if mapping else [],
                "warnings": item.warnings,
            }
        )
    bom = [
        {
            "bom_id": None,
            "bom_header_id": None,
            "parent_item_id": line.parent_item_id,
            "component_item_id": line.component_item_id,
            "component_code": line.component_code,
            "quantity_per": _jsonable(line.quantity_per),
            "item_type": line.item_type,
            "scrap_factor": _jsonable(line.scrap_factor),
            "yield_loss_percentage": _jsonable(line.yield_loss_percentage),
            "version_no": line.version_no,
            "status": line.status,
            "created_at": None,
            "parent_description": item_desc.get(line.parent_item_id),
            "component_description": item_desc.get(line.component_item_id),
        }
        for line in plan.bom
    ]
    source_files: dict[str, str] = {}
    for key, glob_pat in FILE_GLOBS.items():
        try:
            source_files[key] = find_file(data_dir, glob_pat).name
        except FileNotFoundError:
            source_files[key] = ""
    return {
        "dry_run": True,
        "data_dir": str(data_dir),
        "source_files": source_files,
        "counts": {
            "customers": len(customers),
            "suppliers": len(suppliers),
            "items": len(items),
            "bom": len(bom),
            "customers_with_address": sum(1 for row in customers if row["has_address"]),
            "suppliers_with_address": sum(1 for row in suppliers if row["has_address"]),
            "warnings": len(collect_warnings(plan)),
        },
        "warnings": collect_warnings(plan),
        "customers": customers,
        "suppliers": suppliers,
        "items": items,
        "vendor_mappings": vendor_mappings,
        "bom": bom,
    }


def preview_from_dir(data_dir: Path) -> dict[str, Any]:
    plan = build_plan(data_dir, {"customers", "suppliers", "items", "bom"})
    return plan_to_preview(plan, data_dir)


def map_payment_terms(code: str | None) -> str | None:
    text = blank(code)
    if not text:
        return None
    return PAYMENT_TERMS_MAP.get(text.upper(), text)


def map_customer(row: dict[str, str]) -> MappedCustomer | None:
    customer_id = clip(row.get("occ01"), 50)
    if not customer_id:
        return None
    name = blank(row.get("occ18")) or blank(row.get("occ02")) or customer_id
    name = name.rstrip(" ,")
    warnings: list[str] = []
    contact = blank(row.get("occ29")) or blank(row.get("occ28"))
    status = OCC_STATUS_MAP.get((row.get("occacti") or "Y").upper(), "ACTIVE")
    incoterms = clip(row.get("occ44"), 10)
    if incoterms:
        incoterms = incoterms.upper()

    payload = {
        "customer_id": customer_id,
        "customer_number_ext": clip(row.get("occ02"), 50),
        "company_name": clip(name, 255) or customer_id,
        "tax_id": clip(row.get("occ11"), 64),
        "industry_type": None,
        "facility_type": None,
        "website": None,
        "primary_contact_name": clip(contact, 255),
        "primary_email": None,
        "primary_phone": clip(row.get("occ261"), 50),
        "currency": (blank(row.get("occ42")) or "USD").upper()[:3],
        "credit_limit": to_decimal(row.get("occ63"), Decimal("0.00")) or Decimal("0.00"),
        "payment_terms": clip(map_payment_terms(row.get("occ45")), 50),
        "preferred_incoterms": incoterms,
        "tax_exempt": False,
        "tax_exempt_certificate_id": None,
        "status": status,
    }

    bill = parse_address(row.get("occ231"), row.get("occ232"), row.get("occ233"), row.get("occ234"))
    ship = parse_address(row.get("occ241"), row.get("occ242"), row.get("occ243"), row.get("occ244"))
    locations: list[dict[str, Any]] = []

    def loc_dict(loc_id: str, loc_type: str, addr: ParsedAddress, name_suffix: str) -> dict[str, Any]:
        if not addr.parsed:
            warnings.append(f"{loc_type} address stored unparsed: {addr.address_line1[:80]}")
        return {
            "location_id": loc_id,
            "location_type": loc_type,
            "location_code": loc_type,
            "location_name": clip(f"{payload['company_name']} {name_suffix}", 150),
            "address_line1": addr.address_line1,
            "address_line2": addr.address_line2,
            "city": addr.city,
            "state": addr.state,
            "postal_code": addr.postal_code,
            "country": addr.country,
            "contact_person": clip(contact, 150),
            "contact_phone": clip(row.get("occ261"), 50),
            "is_default": True,
            "tax_id": clip(row.get("occ11"), 64),
        }

    if bill and ship and bill.address_line1 == ship.address_line1:
        locations.append(loc_dict(f"{customer_id}-BOTH", "BOTH", bill, "HQ"))
    else:
        if bill:
            locations.append(loc_dict(f"{customer_id}-BILL", "BILL_TO", bill, "Bill-To"))
        if ship:
            locations.append(loc_dict(f"{customer_id}-SHIP", "SHIP_TO", ship, "Ship-To"))
    if not locations:
        warnings.append("no Bill-To/Ship-To address in TIPTOP export")

    return MappedCustomer(customer_id=customer_id, payload=payload, locations=locations, warnings=warnings)


def map_supplier(row: dict[str, str], subcontract_ids: set[str]) -> MappedSupplier | None:
    supplier_id = clip(row.get("pmc01"), 50)
    if not supplier_id:
        return None
    name = blank(row.get("pmc081")) or blank(row.get("pmc03")) or supplier_id
    warnings: list[str] = []
    addr = parse_address(
        row.get("pmc091"),
        row.get("pmc092"),
        row.get("pmc093"),
        row.get("pmc094"),
        row.get("pmc095"),
    )
    related = (row.get("pmc903") or "").upper() == "Y"
    notes_bits = [f"TIPTOP pmc17={row.get('pmc17') or '-'}", f"price_terms={row.get('pmc49') or '-'}"]
    if related:
        notes_bits.append("related_party=Y")
    if blank(row.get("pmc03")):
        notes_bits.append(f"short_name={row.get('pmc03')}")

    vendor_type = "subcontractor" if supplier_id in subcontract_ids else "material"
    payload: dict[str, Any] = {
        "supplier_id": supplier_id,
        "company_name": clip(name, 255) or supplier_id,
        "contact_name": clip(row.get("pmc1916"), 100),
        "contact_email": None,
        "phone_number": clip(row.get("pmc10"), 50),
        "address_line1": None,
        "city": None,
        "state": None,
        "postal_code": None,
        "country": None,
        "vendor_number_ext": clip(row.get("pmc03"), 50),
        "payment_terms": clip(row.get("pmc17") or "Net 30", 50),
        "status": "Active" if (row.get("pmcacti") or "Y").upper() == "Y" else "Inactive",
        "vendor_type": vendor_type,
        "tax_id": clip(row.get("pmc24"), 50),
        "currency": (blank(row.get("pmc22")) or "USD").upper()[:3],
        "ap_account_id": None,
        "payment_method": None,
        "incoterms": None,
        "lead_time_days": to_int(row.get("pmc58"), 0),
        "work_center_id": None,
        "consignment_stock_loc_id": None,
        "standard_scrap_rate": Decimal("0.00"),
        "iso_certified": False,
        "qc_status": "approved",
        "notes": "; ".join(notes_bits),
        "address_line2": None,
    }
    if addr:
        if not addr.parsed:
            warnings.append(f"address stored unparsed: {addr.address_line1[:80]}")
        payload.update(
            {
                "address_line1": addr.address_line1,
                "address_line2": addr.address_line2,
                "city": clip(addr.city, 100),
                "state": clip(addr.state, 50),
                "postal_code": clip(addr.postal_code, 20),
                "country": clip(addr.country, 50),
            }
        )
    else:
        warnings.append("no address in TIPTOP export")
    payload["is_overseas"] = bool(payload.get("country")) and not is_us_country(payload.get("country"))
    return MappedSupplier(supplier_id=supplier_id, payload=payload, warnings=warnings)


def map_item(row: dict[str, str], bom_parents: set[str]) -> MappedItem | None:
    item_id = clip(row.get("ima01"), 50)
    if not item_id:
        return None
    desc = join_lines(row.get("ima02"), row.get("ima021")) or item_id
    source = (row.get("ima08") or "").upper()
    is_bom_parent = item_id in bom_parents
    is_purchase = source in {"P", "Z"} or (source == "M" and not is_bom_parent)
    is_raw = source == "M" and not is_bom_parent
    unit_price = to_decimal(row.get("ima32"))
    if not unit_price or unit_price == 0:
        unit_price = to_decimal(row.get("ima33"))
    if unit_price == 0:
        unit_price = None
    vendor_cost = to_decimal(row.get("ima91")) or to_decimal(row.get("ima53")) or to_decimal(row.get("ima531"))
    if vendor_cost == 0:
        vendor_cost = None
    vendor_id = blank(row.get("ima54"))
    warnings: list[str] = []
    if is_bom_parent and source != "M":
        warnings.append(f"BOM parent has ima08={source!r} (expected M)")
    return MappedItem(
        item_id=item_id,
        payload={
            "item_id": item_id,
            "customer_part_number": item_id,
            "description": desc,
            "uom": clip(row.get("ima25") or "PCS", 20) or "PCS",
            "unit_price": unit_price.quantize(Decimal("0.01")) if unit_price is not None else None,
            "on_hand_quantity": 0,
            "wip_quantity": 0,
            "is_outside_processed": is_bom_parent,
            "is_purchase_item": is_purchase and not is_bom_parent,
            "is_subcontract_assembly": is_bom_parent,
            "is_raw_material": is_raw,
        },
        vendor_id=vendor_id,
        vendor_cost=vendor_cost.quantize(Decimal("0.0001")) if vendor_cost is not None else None,
        min_qty=to_decimal(row.get("ima46"), Decimal("1")) or Decimal("1"),
        lead_time_days=to_int(row.get("ima49"), 0),
        warnings=warnings,
    )


def map_bom_line(row: dict[str, str], today: date) -> MappedBom | None:
    if (row.get("bmaacti") or "Y").upper() != "Y":
        return None
    parent = clip(row.get("bmb01") or row.get("bma01"), 50)
    component = clip(row.get("bmb03"), 50)
    if not parent or not component or parent == component:
        return None
    expires = parse_date(row.get("bmb05"))
    if expires and expires < today:
        return None
    qty = to_decimal(row.get("bmb06"), Decimal("0")) or Decimal("0")
    base = to_decimal(row.get("bmb07"), Decimal("1")) or Decimal("1")
    if base == 0 or qty <= 0:
        return None
    quantity_per = (qty / base).quantize(Decimal("0.0001"))
    scrap = to_decimal(row.get("bmb08"), Decimal("0")) or Decimal("0")
    if scrap > 1:
        scrap = (scrap / Decimal("100")).quantize(Decimal("0.0001"))
    return MappedBom(
        parent_item_id=parent,
        component_item_id=component,
        quantity_per=quantity_per,
        scrap_factor=scrap,
    )


def build_plan(data_dir: Path, include: set[str]) -> LoadPlan:
    plan = LoadPlan()
    today = date.today()

    bom_rows: list[dict[str, str]] = []
    if include & {"bom", "items", "suppliers"}:
        bom_path = find_file(data_dir, FILE_GLOBS["bom"])
        bom_rows = read_tip_csv(bom_path)
        print(f"Read {len(bom_rows):>3} rows  {bom_path.name}")

    bom_parents = {
        parent
        for parent in (clip(r.get("bmb01") or r.get("bma01"), 50) for r in bom_rows)
        if parent
    }

    mapped_bom: list[MappedBom] = []
    if include & {"bom", "items"}:
        for row in bom_rows:
            line = map_bom_line(row, today)
            if line:
                mapped_bom.append(line)
        if include & {"bom"}:
            plan.bom = mapped_bom

    subcontract_ids: set[str] = set()
    item_rows: list[dict[str, str]] = []
    if include & {"items", "suppliers", "bom"}:
        item_path = find_file(data_dir, FILE_GLOBS["items"])
        item_rows = read_tip_csv(item_path)
        print(f"Read {len(item_rows):>3} rows  {item_path.name}")
        for row in item_rows:
            item_id = clip(row.get("ima01"), 50)
            vendor_id = blank(row.get("ima54"))
            if item_id in bom_parents and vendor_id:
                subcontract_ids.add(vendor_id)

    if "customers" in include:
        path = find_file(data_dir, FILE_GLOBS["customers"])
        rows = read_tip_csv(path)
        print(f"Read {len(rows):>3} rows  {path.name}")
        for row in rows:
            mapped = map_customer(row)
            if mapped:
                plan.customers.append(mapped)

    if "suppliers" in include:
        path = find_file(data_dir, FILE_GLOBS["suppliers"])
        rows = read_tip_csv(path)
        print(f"Read {len(rows):>3} rows  {path.name}")
        for row in rows:
            mapped = map_supplier(row, subcontract_ids)
            if mapped:
                plan.suppliers.append(mapped)

    if "items" in include:
        item_ids: set[str] = set()
        for row in item_rows:
            mapped = map_item(row, bom_parents)
            if mapped:
                plan.items.append(mapped)
                item_ids.add(mapped.item_id)
        for line in mapped_bom:
            if line.parent_item_id not in item_ids:
                plan.skipped.append(f"BOM parent {line.parent_item_id} missing from item master")
            if line.component_item_id not in item_ids:
                plan.skipped.append(f"BOM component {line.component_item_id} missing from item master")

    if "bom" in include:
        keep = []
        item_ids = {item.item_id for item in plan.items} or {
            clip(r.get("ima01"), 50) for r in item_rows if clip(r.get("ima01"), 50)
        }
        for line in plan.bom:
            if line.parent_item_id in item_ids and line.component_item_id in item_ids:
                keep.append(line)
        plan.bom = keep

    return plan


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

def _apply_fields(obj: Any, payload: dict[str, Any], skip: Iterable[str] = ()) -> None:
    skip_set = set(skip)
    for key, value in payload.items():
        if key in skip_set:
            continue
        setattr(obj, key, value)


def load_customers(db: Any, rows: list[MappedCustomer], upsert: bool) -> Counter:
    from app.models import Customer, CustomerLocation
    from app.services.customers import CUSTOMER_COLUMNS, LOCATION_COLUMNS

    stats: Counter[str] = Counter()
    for mapped in rows:
        existing = db.get(Customer, mapped.customer_id)
        header = {k: v for k, v in mapped.payload.items() if k in CUSTOMER_COLUMNS}
        if existing is None:
            customer = Customer(customer_id=mapped.customer_id, **header)
            db.add(customer)
            db.flush()
            stats["customers_created"] += 1
        elif upsert:
            _apply_fields(existing, header)
            customer = existing
            stats["customers_updated"] += 1
        else:
            stats["customers_skipped"] += 1
            continue

        for loc in mapped.locations:
            loc_id = loc["location_id"]
            loc_row = db.get(CustomerLocation, loc_id)
            fields = {k: loc.get(k) for k in LOCATION_COLUMNS}
            if loc_row is None:
                db.add(CustomerLocation(location_id=loc_id, customer_id=mapped.customer_id, **fields))
                stats["locations_created"] += 1
            elif upsert:
                if loc_row.customer_id != mapped.customer_id:
                    mapped.warnings.append(f"location {loc_id} belongs to {loc_row.customer_id}")
                    continue
                _apply_fields(loc_row, fields)
                stats["locations_updated"] += 1
            else:
                stats["locations_skipped"] += 1
    return stats


def load_suppliers(db: Any, rows: list[MappedSupplier], upsert: bool) -> Counter:
    from app.models import Supplier

    stats: Counter[str] = Counter()
    for mapped in rows:
        existing = db.get(Supplier, mapped.supplier_id)
        payload = {k: v for k, v in mapped.payload.items() if k != "supplier_id"}
        if existing is None:
            db.add(Supplier(supplier_id=mapped.supplier_id, **payload))
            stats["suppliers_created"] += 1
        elif upsert:
            _apply_fields(existing, payload)
            stats["suppliers_updated"] += 1
        else:
            stats["suppliers_skipped"] += 1
    return stats


def load_items(db: Any, rows: list[MappedItem], upsert: bool) -> Counter:
    from app.models import Item, Supplier, VendorItemMapping

    stats: Counter[str] = Counter()
    for mapped in rows:
        existing = db.get(Item, mapped.item_id)
        payload = {k: v for k, v in mapped.payload.items() if k != "item_id"}
        if existing is None:
            db.add(Item(item_id=mapped.item_id, **payload))
            stats["items_created"] += 1
        elif upsert:
            _apply_fields(existing, payload)
            stats["items_updated"] += 1
        else:
            stats["items_skipped"] += 1
            continue

        if not mapped.vendor_id:
            continue
        if db.get(Supplier, mapped.vendor_id) is None:
            mapped.warnings.append(f"primary vendor {mapped.vendor_id} not in suppliers CSV/DB")
            continue
        mapping = (
            db.query(VendorItemMapping)
            .filter(
                VendorItemMapping.supplier_id == mapped.vendor_id,
                VendorItemMapping.item_id == mapped.item_id,
            )
            .first()
        )
        fields = {
            "vendor_sku": mapped.item_id,
            "unit_cost": mapped.vendor_cost,
            "minimum_order_qty": mapped.min_qty if mapped.min_qty > 0 else Decimal("1"),
            "lead_time_days": mapped.lead_time_days,
            "is_primary_vendor": True,
        }
        if mapping is None:
            db.add(VendorItemMapping(supplier_id=mapped.vendor_id, item_id=mapped.item_id, **fields))
            stats["vendor_maps_created"] += 1
        elif upsert:
            _apply_fields(mapping, fields)
            stats["vendor_maps_updated"] += 1
        else:
            stats["vendor_maps_skipped"] += 1
    return stats


def load_bom(db: Any, rows: list[MappedBom], upsert: bool) -> Counter:
    from app.models import Item, ItemBOMComponent
    from app.services.bom_versions import ensure_writable_header

    stats: Counter[str] = Counter()
    headers: dict[str, Any] = {}
    for mapped in rows:
        parent = db.get(Item, mapped.parent_item_id)
        component = db.get(Item, mapped.component_item_id)
        if parent is None or component is None:
            stats["bom_skipped"] += 1
            continue
        if not parent.is_subcontract_assembly and not parent.is_outside_processed:
            parent.is_subcontract_assembly = True
            parent.is_outside_processed = True
        header = headers.get(mapped.parent_item_id)
        if header is None:
            header = ensure_writable_header(db, mapped.parent_item_id)
            headers[mapped.parent_item_id] = header
        existing = (
            db.query(ItemBOMComponent)
            .filter(
                ItemBOMComponent.bom_header_id == header.bom_header_id,
                ItemBOMComponent.component_item_id == mapped.component_item_id,
                ItemBOMComponent.component_code.is_(None),
            )
            .first()
        )
        fields = {
            "quantity_per": mapped.quantity_per,
            "item_type": mapped.item_type,
            "scrap_factor": mapped.scrap_factor,
            "yield_loss_percentage": mapped.yield_loss_percentage,
        }
        if existing is None:
            db.add(
                ItemBOMComponent(
                    bom_header_id=header.bom_header_id,
                    parent_item_id=mapped.parent_item_id,
                    component_item_id=mapped.component_item_id,
                    component_code=mapped.component_code,
                    **fields,
                )
            )
            stats["bom_created"] += 1
        elif upsert:
            _apply_fields(existing, fields)
            stats["bom_updated"] += 1
        else:
            stats["bom_skipped"] += 1
    return stats


def apply_plan(plan: LoadPlan, upsert: bool) -> Counter:
    from app.database import SessionLocal

    db = SessionLocal()
    stats: Counter[str] = Counter()
    try:
        if plan.customers:
            stats.update(load_customers(db, plan.customers, upsert))
        if plan.suppliers:
            stats.update(load_suppliers(db, plan.suppliers, upsert))
        if plan.items:
            stats.update(load_items(db, plan.items, upsert))
        if plan.bom:
            stats.update(load_bom(db, plan.bom, upsert))
        db.commit()
        stats["committed"] = 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return stats


def parse_only(raw: str | None) -> set[str]:
    allowed = {"customers", "suppliers", "items", "bom"}
    if not raw:
        return allowed
    parts = {p.strip().lower() for p in raw.split(",") if p.strip()}
    unknown = parts - allowed
    if unknown:
        raise SystemExit(f"Unknown --only values: {sorted(unknown)}. Use {sorted(allowed)}")
    return parts


def main() -> None:
    parser = argparse.ArgumentParser(description="Load GTT TIPTOP customer/supplier/item/BOM CSVs")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Folder with the four CSVs (default: $GTT_DATA_DIR or backend/data/imports)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Map and print; do not write the database")
    parser.add_argument(
        "--upsert",
        action="store_true",
        help="Update existing records (default is insert-only; existing IDs are skipped)",
    )
    parser.add_argument(
        "--only",
        help="Comma-separated subset: customers,suppliers,items,bom",
    )
    args = parser.parse_args()

    data_dir = args.data_dir.expanduser().resolve()
    if not data_dir.is_dir():
        raise SystemExit(f"Data directory not found: {data_dir}")

    include = parse_only(args.only)
    print(f"Data dir : {data_dir}")
    print(f"Entities : {', '.join(sorted(include))}")
    print(f"Mode     : {'DRY-RUN' if args.dry_run else ('UPSERT' if args.upsert else 'INSERT')}")

    plan = build_plan(data_dir, include)
    plan.print_summary()

    print("\n--- Customers ---")
    for customer in plan.customers:
        loc_bits = []
        for loc in customer.locations:
            loc_bits.append(
                f"{loc['location_type']} {loc['city']}, {loc.get('state') or ''} {loc['postal_code']} {loc['country']}".replace("  ", " ")
            )
        loc_types = "; ".join(loc_bits) or "no-location"
        print(
            f"  {customer.customer_id:10} {customer.payload['status']:8} "
            f"{customer.payload['company_name'][:36]:36} {loc_types}"
        )
    print("\n--- Suppliers ---")
    for supplier in plan.suppliers:
        city = supplier.payload.get("city") or "-"
        country = supplier.payload.get("country") or "-"
        print(
            f"  {supplier.supplier_id:10} {supplier.payload['vendor_type']:14} "
            f"{supplier.payload['company_name'][:36]:36} {city}, {country}"
        )
    print("\n--- Items ---")
    for item in plan.items:
        flags = []
        if item.payload["is_subcontract_assembly"]:
            flags.append("SCO-ASM")
        if item.payload["is_raw_material"]:
            flags.append("RAW")
        if item.payload["is_purchase_item"]:
            flags.append("BUY")
        print(
            f"  {item.item_id:22} {item.payload['uom']:4} "
            f"{'/'.join(flags) or '-':12} {(item.payload['description'] or '')[:50]}"
        )
    print("\n--- BOM ---")
    for line in plan.bom:
        print(
            f"  {line.parent_item_id} ← {line.component_item_id:22} "
            f"qty={line.quantity_per} scrap={line.scrap_factor}"
        )

    if args.dry_run:
        print("\nDry run complete. Re-run with --upsert to write Postgres.")
        return

    stats = apply_plan(plan, upsert=args.upsert)
    print("\n=== Database result ===")
    for key, value in sorted(stats.items()):
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
