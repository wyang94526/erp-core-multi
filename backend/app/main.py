from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    accounts,
    audit_logs,
    customer_locations,  # <-- Added
    customers,
    health,
    journal_entries,
    ledger_postings,
    product_bom,          # <-- Added
    products,
    sales_orders,
    subcontract_orders,   # <-- Added
    suppliers,           # <-- Added
    users,
)

app = FastAPI(
    title="Custom ERP API",
    description="Python FastAPI backend for inventory, CRM, sales, and double-entry accounting.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(sales_orders.router, prefix="/api/v1")
app.include_router(journal_entries.router, prefix="/api/v1")
app.include_router(ledger_postings.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
app.include_router(product_bom.router, prefix="/api/v1")
app.include_router(subcontract_orders.router, prefix="/api/v1")


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Custom ERP API", "docs": "/docs"}
