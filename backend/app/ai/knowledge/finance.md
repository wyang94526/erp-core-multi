# Finance

Finance documents are live records. Use tools, not this file, for counts.

## Accounts receivable
- **Sales invoices** — customer invoicing from fulfillments (`DRAFT`, `POSTED`, etc.). Numbers are `PU65-{YY}{MM}{XXXX}` from the issue date.
- **AR invoices** — collections / aging (`Unpaid`, `Partial`, `Paid`) plus approval_status

Ask: "How many unpaid AR invoices?" · "List sales invoices"

## Accounts payable
- **Supplier invoices** — vendor bills from PO/SCO (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PAID`, `CANCELLED`)
- **AP bills** — payables aging (`Unpaid`, `Partial`, `Paid`)

## Cash & GL
Cash transactions: `Check Issue` (AP) and `Check Deposit` (AR).
Journal entries have `posting_status` Draft/Posted and approval workflow.
Chart of accounts: Asset, Liability, Equity, Revenue, Expense.

Permissions: `ar_invoice:view`, `ap_bill:view`, `cash:view`, `journal:view`.
