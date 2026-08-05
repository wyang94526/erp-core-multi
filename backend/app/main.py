from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    accounts,
    admin_rbac,
    ap_bills,
    approvals,
    ar_invoices,
    audit_logs,
    cash_transactions,
    customer_locations,
    customers,
    health,
    inventory,
    items,
    journal_entries,
    ledger_postings,
    product_bom,
    products,
    purchase_orders,
    sales_orders,
    subcontract_boms,
    subcontract_orders,
    suppliers,
    users,
)



app = FastAPI(
    title="Custom ERP API",
    description="Python FastAPI backend for inventory, CRM, sales, and double-entry accounting.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(users.router, prefix="/api/v1")
app.include_router(customers.router, prefix="/api/v1")
app.include_router(customer_locations.router, prefix="/api/v1") # <-- Added
app.include_router(suppliers.router, prefix="/api/v1")          # <-- Added
app.include_router(products.router, prefix="/api/v1")
app.include_router(items.router, prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(sales_orders.router, prefix="/api/v1")
app.include_router(journal_entries.router, prefix="/api/v1")
app.include_router(ledger_postings.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
app.include_router(product_bom.router, prefix="/api/v1")
app.include_router(subcontract_boms.router, prefix="/api/v1")
app.include_router(subcontract_orders.router, prefix="/api/v1")
app.include_router(purchase_orders.router, prefix="/api/v1")
app.include_router(ar_invoices.router, prefix="/api/v1")
app.include_router(ap_bills.router, prefix="/api/v1")
app.include_router(cash_transactions.router, prefix="/api/v1")
app.include_router(inventory.router, prefix="/api/v1")
app.include_router(approvals.router, prefix="/api/v1")
app.include_router(admin_rbac.router, prefix="/api/v1")




@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Custom ERP API", "docs": "/docs"}
