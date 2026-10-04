# Finance

Finance documents are live records. Use tools, not this file, for counts.

## Accounts receivable
- **Sales invoices** — customer invoicing from fulfillments (`DRAFT`, `POSTED`, etc.). Numbers are `USS5-{YY}{MM}{XXXX}` from the issue date.
- **AR invoices** — collections / aging (`Unpaid`, `Partial`, `Paid`) plus approval_status

Ask: "How many unpaid AR invoices?" · "show me unpaid invoices" · "show me invoice status" · "show me invoice status for the period 09/2026" · "show me invoices due in October 2026" · "show me invoices billed in October 2026" · "show me invoices billed in October 2026 for vendor Accelerate Global Solution" · "show me purchase orders in October 2026 for vendor Accelerate Global Solution" · "List sales invoices" · "current closing period"

## Accounts payable
- **Supplier invoices** — vendor bills (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PAID`, `CANCELLED`)
  - `PO_MATCHED` — 3-way match to a PO or SCO (`source_order_id` required)
  - `LANDED_COST` — Non-PO freight/duty; optional goods-receipt allocation capitalizes inventory
  - `EXPENSE` — Non-PO rent/utilities/salaries with GL distributions (`gl_account_id`, optional `department_id`)
- **AP bills** — payables aging (`Unpaid`, `Partial`, `Paid`) created when a supplier invoice is approved

Create Non-PO bills at Finance → Supplier Invoices → Create Non-PO Invoice. Payload may omit `po_id` / `source_order_id`.

## Cash & GL
Cash transactions: `Check Issue` (AP) and `Check Deposit` (AR).
Journal entries have `posting_status` Draft/Posted and approval workflow.
Ask: "journals for September 2026" for the same documents as Finance → General Ledger (UG11 number, or short id when older rows have none). The table shows Created and Posting date.
Chart of accounts: Asset, Liability, Equity, Revenue, Expense.

Permissions: `ar_invoice:view`, `ap_bill:view`, `cash:view`, `journal:view`, `report:view`.

## Financial reports
Finance → Reports & Analytics → Financial Reports (`/financial-reports`).
Statements (Balance Sheet, P&L, Cash Flow), AR/AP aging, trial balance, fixed-asset schedule, cash forecast, budget vs actual, and bank reconciliation. Permission `report:view`.

Period Management (`/general-ledger/period-management`) stores Soft Close and Hard Close dates.
Ask: "current closing period" for the live lock dates (same as Finance → Period Management).
Ask: "Posting rule for Month End Close" for the live MEC_PARK_NI debit/credit accounts.

Ask live numbers with `get_financial_report`, not this file:
- "Show me the Income Statement for the month June 2026"
- "Show me the revenue for September 2027"
- "Balance sheet as of June 2026"
- "Trial balance for 2026-06"
