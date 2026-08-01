"""
Seed script for the Subcontracting / Outside Processing (BOM + SCO) demo.

Creates:
  - A finished-goods product ("PROD-ASSY-100") plus 2 raw-material component
    products ("PROD-RAWMAT-A", "PROD-RAWMAT-B") with some on-hand inventory.
  - A Bill of Materials linking the components to the finished product.
  - A supplier used to perform the outside processing / subcontract work.
  - A sample Subcontract Order (SCO) for the finished product, with a
    partial material issue recorded against it so the workflow can be
    explored immediately (issue more materials / receive goods from the
    Subcontract Order Detail page in the UI).

Run with the backend server already running (see backend/app/main.py),
e.g.:
    cd backend && uvicorn app.main:app --reload
then in another terminal:
    python backend/seed_subcontract_demo.py
"""

import requests

BASE_URL = "http://127.0.0.1:8000/api/v1"


def _post(path: str, json: dict, ok_codes=(200, 201)):
    r = requests.post(f"{BASE_URL}{path}", json=json)
    label = json.get("product_id") or json.get("supplier_id") or json.get("sco_number") or json.get("issue_id") or path
    if r.status_code in ok_codes:
        print(f"✅ {path} -> {label} ({r.status_code})")
    else:
        print(f"⚠️  {path} -> {label} ({r.status_code}): {r.text}")
    return r


def seed():
    print("🌱 Seeding Subcontracting / BOM demo data...")

    # 1. Raw material component products (with on-hand stock so they can be issued)
    _post(
        "/products",
        {
            "product_id": "PROD-RAWMAT-A",
            "customer_part_number": "RM-A-001",
            "description": "Raw Material A - Aluminum Sheet",
            "uom": "PCS",
            "unit_price": 4.25,
            "on_hand_quantity": 1000,
            "wip_quantity": 0,
        },
    )
    _post(
        "/products",
        {
            "product_id": "PROD-RAWMAT-B",
            "customer_part_number": "RM-B-002",
            "description": "Raw Material B - Fastener Kit",
            "uom": "PCS",
            "unit_price": 0.75,
            "on_hand_quantity": 5000,
            "wip_quantity": 0,
        },
    )

    # 2. Finished/assembled product built from the raw materials above
    _post(
        "/products",
        {
            "product_id": "PROD-ASSY-100",
            "customer_part_number": "ASSY-100",
            "description": "Assembled Bracket Unit (Outside Processed)",
            "uom": "PCS",
            "unit_price": 22.00,
            "on_hand_quantity": 0,
            "wip_quantity": 0,
        },
    )

    # 3. Bill of Materials: 1 unit of ASSY-100 requires 2x RAWMAT-A and 4x RAWMAT-B
    _post(
        "/products/PROD-ASSY-100/bom",
        {"component_product_id": "PROD-RAWMAT-A", "quantity_per": 2},
    )
    _post(
        "/products/PROD-ASSY-100/bom",
        {"component_product_id": "PROD-RAWMAT-B", "quantity_per": 4},
    )

    # 4. Supplier who will perform the outside processing / subcontract work
    _post(
        "/suppliers/",
        {
            "supplier_id": "SUP-SUBCON-01",
            "company_name": "Precision Outside Processing Co.",
            "contact_name": "Alan Chen",
            "contact_email": "alan.chen@precisionop.example.com",
            "phone_number": "+886-2-5555-1234",
            "city": "Taipei",
            "country": "Taiwan",
            "payment_terms": "Net 30",
            "status": "Active",
        },
    )

    # 5. Subcontract Order: send out enough raw material to build 100 units.
    #    Requires: 200x RAWMAT-A, 400x RAWMAT-B (auto-populated from the BOM above)
    r_sco = _post(
        "/subcontract-orders",
        {
            "sco_number": "SCO-2026-0001",
            "supplier_id": "SUP-SUBCON-01",
            "product_id": "PROD-ASSY-100",
            "quantity_ordered": 100,
            "order_date": "2026-07-01",
            "expected_return_date": "2026-07-15",
            "notes": "Initial outside-processing run for Assembled Bracket Unit.",
        },
    )

    # 6. Issue an initial (partial) shipment of raw materials to the subcontractor
    if r_sco.status_code in (200, 201):
        _post(
            "/subcontract-orders/SCO-2026-0001/issue-materials",
            {
                "issue_id": "ISSUE-2026-0001",
                "issue_date": "2026-07-02",
                "notes": "First shipment of raw materials to subcontractor.",
                "lines": [
                    {"component_product_id": "PROD-RAWMAT-A", "quantity_issued": 100},
                    {"component_product_id": "PROD-RAWMAT-B", "quantity_issued": 200},
                ],
            },
        )

    print("🌱 Done. Visit the Subcontract Orders page to view SCO-2026-0001 "
          "and continue issuing materials / receiving finished goods.")


if __name__ == "__main__":
    seed()
