import requests
from datetime import date

# Adjust this if your routers have a prefix like "/api/v1"
BASE_URL = "http://127.0.0.1:8000/api/v1"

def seed_data():
    print("🌱 Starting database seed...")

    # 1. Create a User (e.g., Internal Sales Rep)
    user_data = {
        "email": "wendy.yang@grand-tek.com",
        "full_name": "Wendy Yang"
    }
    r_user = requests.post(f"{BASE_URL}/users", json=user_data) # Adjust endpoint name if needed
    print(f"User Response: {r_user.status_code}")

    # 2. Create the Customer (GTT USA)
    customer_data = {
        "customer_id": "CUST-GTT-USA",
        "company_name": "GTT USA, Inc.",
        "currency": "USD"
    }
    r_cust = requests.post(f"{BASE_URL}/customers", json=customer_data)
    print(f"Customer Response: {r_cust.status_code}")
    if r_cust.status_code == 422:
        print(f"Customer Error details: {r_cust.json()}")

   # 3. Create Customer Locations (Bill-To & Ship-To)
    bill_to = {
        "location_id": "LOC-GTT-BILL-01",
        "customer_id": "CUST-GTT-USA",
        "address_line1": "358 Fairview Way",
        "city": "Milpitas",
        "state": "CA",
        "postal_code": "95035",
        "country": "USA",
        "location_type": "BILL_TO"
    }
    ship_to = {
        "location_id": "LOC-GTT-SHIP-01",
        "customer_id": "CUST-GTT-USA",
        "address_line1": "41300 Boyce Road",
        "city": "FREMONT",
        "state": "CA",
        "postal_code": "94538",
        "country": "USA",
        "location_type": "SHIP_TO"
    }
    
    r_bill = requests.post(f"{BASE_URL}/customer-locations", json=bill_to)
    print(f"Bill-To Response: {r_bill.status_code}")
    if r_bill.status_code not in (200, 201):
        print(f"Bill-To Error: {r_bill.text}")

    r_ship = requests.post(f"{BASE_URL}/customer-locations", json=ship_to)
    print(f"Ship-To Response: {r_ship.status_code}")
    if r_ship.status_code not in (200, 201):
        print(f"Ship-To Error: {r_ship.text}")
    print("Locations Created")

    # 4. Create Supplier (Just for testing supplier routes, even though they aren't on this SO)
    supplier_data = {
        "supplier_id": "SUP-MEMBRANE-01",
        "name": "Membrane Tech Supplier Co.",
        "currency": "TWD"
    }
    requests.post(f"{BASE_URL}/suppliers", json=supplier_data)
    print("Supplier Created")

    # 5. Create Products (Taking the first 3 items from the PO)
    products = [
        {
            "product_id": "PROD-1001G",
            "customer_part_number": "1001G00001710",
            "description": "Enclosure, Bottom Cover, RSU-5941 For NEX",
            "uom": "PCS",
            "unit_price": 37.5294
        },
        {
            "product_id": "PROD-1010G",
            "customer_part_number": "1010G00001180",
            "description": "Metal Adapter Board, GLB M-Smart M25x4 For NEX",
            "uom": "PCS",
            "unit_price": 10.5186
        },
        {
            "product_id": "PROD-1020G",
            "customer_part_number": "1020G00000520",
            "description": "Assy KIT,M-SMART,LED 3 in 1_Reset For NEX",
            "uom": "PCS",
            "unit_price": 25.5047
        }
    ]
    for p in products:
        requests.post(f"{BASE_URL}/products", json=p)
    print("Products Created")

    # 6. Create the Sales Order (Tying it all together!)
    sales_order_data = {
        "sales_order_id": "SO-26060004",
        "customer_id": "CUST-GTT-USA",
        "bill_to_location_id": "LOC-GTT-BILL-01",
        "ship_to_location_id": "LOC-GTT-SHIP-01",
        "customer_po_number": "PU62-26060004",
        "po_revision_number": 0,
        "order_date": "2026-06-26",
        "payment_terms": "Net 150 days(End of Month)",
        "freight_terms": "FCA TW",
        "currency": "USD",
        "status": "RECEIVED",
        "total_amount": 37511.88, # Sum of first 3 items
        "items": [
            {
                "line_number": 1,
                "product_id": "PROD-1001G",
                "quantity_ordered": 510,
                "unit_price": 37.5294,
                "total_amount": 19139.99
            },
            {
                "line_number": 2,
                "product_id": "PROD-1010G",
                "quantity_ordered": 510,
                "unit_price": 10.5186,
                "total_amount": 5364.49
            },
            {
                "line_number": 3,
                "product_id": "PROD-1020G",
                "quantity_ordered": 510,
                "unit_price": 25.5047,
                "total_amount": 13007.40
            }
        ]
    }
    
    r_so = requests.post(f"{BASE_URL}/sales-orders", json=sales_order_data)
    print(f"Sales Order Response: {r_so.status_code}")
    if r_so.status_code not in (200, 201):
        print(f"Error details: {r_so.text}")
    else:
        print("✅ Database successfully seeded with PO PU62-26060004!")

if __name__ == "__main__":
    seed_data()
