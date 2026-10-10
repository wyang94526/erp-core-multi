# @author: Wendy Yang
# @date: 2026-09-19

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.services.bootstrap_admin import ensure_bootstrap_admin, password_change_required
from app.routers import (
    accounts,
    admin_rbac,
    ai_chat,
    ap_bills,
    approvals,
    ar_invoices,
    audit_logs,
    auth,
    cash_transactions,
    company_profile,
    bank_accounts,
    bank_transfers,
    financial_reports,
    customer_locations,
    customers,
    fulfillments,
    goods_receipts,
    health,
    inventory,
    items,
    journal_entries,
    ledger_postings,
    product_bom,
    products,
    purchase_orders,
    sales_invoices,
    sales_orders,
    subcontract_boms,
    subcontract_orders,
    suppliers,
    users,
    vendor_invoices,
    attachments,
    work_centers,
    data_import,
    payment_terms,
    posting_rules,
    finance_settings,
)



settings = get_settings()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    ensure_bootstrap_admin()
    yield


app = FastAPI(
    title="Custom ERP API",
    description="Python FastAPI backend for inventory, CRM, sales, and double-entry accounting.",
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_password_change(request: Request, call_next):
    if password_change_required(request.url.path, request.headers.get("authorization")):
        return JSONResponse(
            status_code=403,
            content={"detail": "Change the initial password before using the system"},
        )
    return await call_next(request)

app.include_router(health.router)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(ai_chat.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(customers.router, prefix="/api/v1")
app.include_router(customer_locations.router, prefix="/api/v1") # <-- Added
app.include_router(suppliers.router, prefix="/api/v1")          # <-- Added
app.include_router(work_centers.router, prefix="/api/v1")
app.include_router(products.router, prefix="/api/v1")
app.include_router(items.router, prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(payment_terms.router, prefix="/api/v1")
app.include_router(posting_rules.router, prefix="/api/v1")
app.include_router(finance_settings.router, prefix="/api/v1")
app.include_router(company_profile.router, prefix="/api/v1")
app.include_router(sales_orders.router, prefix="/api/v1")
app.include_router(fulfillments.router, prefix="/api/v1")
app.include_router(sales_invoices.router, prefix="/api/v1")
app.include_router(journal_entries.router, prefix="/api/v1")
app.include_router(ledger_postings.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
app.include_router(product_bom.router, prefix="/api/v1")
app.include_router(subcontract_boms.router, prefix="/api/v1")
app.include_router(subcontract_orders.router, prefix="/api/v1")
app.include_router(purchase_orders.router, prefix="/api/v1")
app.include_router(goods_receipts.router, prefix="/api/v1")
app.include_router(ar_invoices.router, prefix="/api/v1")
app.include_router(ap_bills.router, prefix="/api/v1")
app.include_router(vendor_invoices.router, prefix="/api/v1")
app.include_router(attachments.router, prefix="/api/v1")
app.include_router(cash_transactions.router, prefix="/api/v1")
app.include_router(bank_accounts.router, prefix="/api/v1")
app.include_router(bank_transfers.router, prefix="/api/v1")
app.include_router(financial_reports.router, prefix="/api/v1")
app.include_router(inventory.router, prefix="/api/v1")
app.include_router(approvals.router, prefix="/api/v1")
app.include_router(admin_rbac.router, prefix="/api/v1")
app.include_router(data_import.router, prefix="/api/v1")




@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Custom ERP API", "docs": "/docs"}
