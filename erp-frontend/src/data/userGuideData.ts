/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * In-app User Guide content.
 * Edit this file to add or revise articles, FAQs, and troubleshooting
 * without changing UI components.
 */

export type HelpModule =
  | 'home'
  | 'sales'
  | 'manufacturing'
  | 'inventory'
  | 'master-data'
  | 'finance'
  | 'admin'

export type HelpCalloutKind = 'tip' | 'important' | 'required'

export interface HelpCallout {
  kind: HelpCalloutKind
  text: string
}

export interface HelpFaq {
  question: string
  answer: string
}

export interface HelpIssue {
  issue: string
  fix: string
}

export interface HelpScreenshot {
  src: string
  caption: string
}

export interface HelpArticle {
  id: string
  module: HelpModule
  title: string
  routeMatch?: string[]
  summary: string
  steps: string[]
  tips?: string[]
  faqs?: HelpFaq[]
  callouts?: HelpCallout[]
  troubleshooting?: HelpIssue[]
  screenshots?: HelpScreenshot[]
}

export const HELP_MODULES: Array<{ id: HelpModule; label: string; blurb: string }> = [
  { id: 'home', label: 'Home / Dashboard', blurb: 'KPIs, pending work, and role-based overviews' },
  { id: 'sales', label: 'Sales & Procurement', blurb: 'Sales orders, purchase orders, and overseas buying' },
  { id: 'manufacturing', label: 'Manufacturing', blurb: 'Subcontract / outside processing orders' },
  { id: 'inventory', label: 'Inventory', blurb: 'Stock, movements, warehouses, and receiving' },
  { id: 'master-data', label: 'Master Data', blurb: 'Customers, vendors, payment terms, tax IDs, and banking' },
  { id: 'finance', label: 'Finance & Accounting', blurb: 'Invoices, AP, AR, cash, the general ledger, and financial reports' },
  { id: 'admin', label: 'Administration', blurb: 'Users, roles, permissions, and data import' },
]

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'using-the-guide',
    module: 'home',
    title: 'How to Use This Guide',
    routeMatch: ['/help', '/user-guide'],
    summary:
      'The User Guide is a searchable knowledge base for daily ERP work. Open the full guide from the sidebar, or press Ctrl/⌘ + / for help that matches the page you are on.',
    screenshots: [
      { src: '/guide-screenshots/help-guide.jpg', caption: 'User Guide sidebar and search' },
      { src: '/guide-screenshots/help-drawer.jpg', caption: 'Contextual Help drawer from the header' },
    ],
    steps: [
      'Open Home → User Guide, or the User Guide link at the bottom of the left sidebar.',
      'Use the search box to filter topics, steps, and FAQs instantly. Directory screens (orders, invoices, items, journals, and master data) share the same Search + dropdown + Export CSV bar; the CSV includes every row that matches the current filters, not just the page on screen.',
      'Browse by module in the left column, then expand Step-by-step, Tips, FAQs, and Common Issues.',
      'On any operational screen, click Help in the top bar (next to AI Assistant) or press Ctrl/⌘ + / to open a drawer of articles tagged for that route. Ask the assistant for live P&L, Balance Sheet, or “by month” totals; it can link you to the full report.',
      'Open Process Workflows (/help/workflows) for Order-to-Cash, Subcontract-to-Pay (including fulfilling the customer SO), Procure-to-Pay, and period-close checklists with jump links into each screen.',
      'Callout badges mark Tips, Important notes, and Required Fields. Screenshots show the live screens for each step.',
    ],
    callouts: [
      { kind: 'tip', text: 'Ctrl/⌘ + / toggles contextual help from anywhere, including while you are filling a form.' },
      { kind: 'important', text: 'Articles live in src/data/userGuideData.ts so operations can revise workflows without a UI rewrite.' },
    ],
    faqs: [
      {
        question: 'Why does Help show more than one article?',
        answer:
          'Some screens participate in more than one workflow (for example Purchase Orders and Overseas Vendor Orders). Read the one that matches the task you are doing.',
      },
      {
        question: 'What can I ask the AI Assistant?',
        answer:
          'Live counts, order and AP/AR totals by month, and posted financial statements (Income Statement / P&L, Balance Sheet, Cash Flow, Trial Balance, aging). Example: “Show me the Income Statement for June 2026”. Empty months list other periods that already have posted P&L. Use Open the full report to open Financial Reports.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Help drawer says no article for this route',
        fix: 'Use Open User Guide and search by keyword (invoice, SWIFT, ship-to). Not every utility URL is tagged yet.',
      },
    ],
  },
  {
    id: 'dashboard-overview',
    module: 'home',
    title: 'Using the Dashboard',
    routeMatch: ['/'],
    summary:
      'The Home dashboard is role-aware. After sign-in you see KPIs, urgent work, and Quick Actions matched to your job (sales, purchasing, inventory, finance, or executive).',
    screenshots: [
      { src: '/guide-screenshots/dashboard.jpg', caption: 'Dashboard greeting, KPI cards, and Quick Actions' },
    ],
    steps: [
      'Open Home → Dashboard (or click the company logo area and choose Dashboard).',
      'Read the greeting banner. It names your role and highlights the most urgent items (overdue invoices, low stock, pending approvals).',
      'Scan KPI cards. Click a card to drill into the related list with filters already applied (for example, pending receiving).',
      'Use Quick Actions to jump to frequent tasks such as New Sales Order or New Purchase Order.',
      'If your account has no role yet, you will see a Welcome / onboarding screen instead of KPIs. Ask an administrator to assign a role under Administration → Users & Roles.',
    ],
    callouts: [
      { kind: 'tip', text: 'KPI cards are clickable. They take you to the operational list, not a static report.' },
      { kind: 'important', text: 'What you see depends on your role. A sales representative will not see AP aging the same way a finance approver does.' },
    ],
    tips: [
      'Use the left sidebar accordion: only one top-level module stays open at a time.',
      'The AI Assistant (top right) can count and look up live records, and it can open posted financial statements. Ask “Income Statement for June 2026”, “Show me the revenue for September 2027”, “P&L for September 2026”, or “Balance Sheet as of 2026-09”. Use “Open the full report” to jump to Financial Reports with that period. “Revenue by month” is posted G/L revenue; “sales by month” is sales-order totals.',
    ],
    faqs: [
      {
        question: 'Why is my dashboard empty or showing Welcome instead of KPIs?',
        answer:
          'Unassigned users see onboarding until an admin grants a role. After a role is assigned, sign out and back in if the dashboard does not refresh.',
      },
      {
        question: 'Where do system notifications appear?',
        answer:
          'Urgent work is summarized in the dashboard greeting. Operational “notifications” also show as filtered lists (pending approvals, overdue AR, reorder alerts) when you click a KPI.',
      },
      {
        question: 'Can the AI Assistant show a P&L?',
        answer:
          'Yes. Ask “Income Statement for June 2026”, “Show me the revenue for September 2027”, or “P&L for September 2026”. The assistant uses posted journals (not document RAG). If that month is empty, it lists other months that already have posted P&L. Open the full report opens Financial Reports for that period. “Revenue by month” is G/L revenue; “sales by month” is sales-order totals.',
      },
    ],
    troubleshooting: [
      {
        issue: 'A KPI click lands on a page I cannot access',
        fix: 'Your role can see the metric but may lack the list permission. Ask an admin to grant the matching view permission (for example po:view or ar_invoice:view).',
      },
    ],
  },
  {
    id: 'list-search-export',
    module: 'home',
    title: 'Searching lists and exporting CSV',
    routeMatch: [
      '/sales-orders',
      '/fulfillments',
      '/sales-invoices',
      '/purchase-orders',
      '/goods-receipts',
      '/customers',
      '/vendors',
      '/items',
      '/payment-terms',
      '/subcontract-orders',
      '/inventory',
      '/inventory/movements',
      '/inventory/warehouses',
      '/chart-of-accounts',
      '/posting-rules',
      '/accounts-receivable',
      '/accounts-payable',
      '/supplier-invoices',
      '/cash-management',
      '/bank-accounts',
      '/bank-transfers',
      '/general-ledger',
    ],
    summary:
      'Every directory screen uses the same URL-driven filter bar: a Search box, optional dropdowns, Clear filters, and Export CSV. Export downloads the rows that match the current filters, including rows beyond the current page.',
    steps: [
      'Open any list (Sales Orders, Purchase Orders, Customers, General Ledger, and so on). The filter bar sits above the table.',
      'Type in Search to match IDs, names, references, or status text. The q parameter is stored in the URL so you can bookmark or share the filtered view.',
      'Use the dropdowns (status, approval, type, date, and similar) to narrow the same result set.',
      'Click Export CSV to download every matching row. The file is dated (for example customers-2026-09-30.csv) and includes a UTF-8 BOM so Excel opens it correctly.',
      'Click Clear filters to remove search and dropdowns. Dashboard deep-links keep their from/metric context.',
    ],
    callouts: [
      {
        kind: 'tip',
        text: 'General Ledger uses the same Search + Export CSV pattern, plus extra date, period, source, and posting-rule filters. The CSV includes each journal and its posting lines.',
      },
      {
        kind: 'important',
        text: 'Export is based on current filters, not the page you are viewing. A 10-row table can still export hundreds of matching records.',
      },
    ],
    faqs: [
      {
        question: 'Why is Export CSV disabled?',
        answer:
          'The button is disabled when no rows match the current search and dropdowns. Clear filters or widen the search, then export again.',
      },
    ],
  },
  {
    id: 'sales-orders',
    module: 'sales',
    title: 'Creating & Managing Sales Orders',
    routeMatch: ['/sales-orders', '/orders', '/fulfillments'],
    summary:
      'Sales orders capture customer demand, ship-to locations, lines, and delivery schedules. You can fulfill and invoice from the order once it is approved.',
    screenshots: [
      { src: '/guide-screenshots/sales-orders.jpg', caption: 'Sales order list' },
      { src: '/guide-screenshots/sales-order-form.jpg', caption: 'New sales order header and lines' },
    ],
    steps: [
      'Go to Sales & Procurement → Sales Orders.',
      'Click Create (or use Dashboard → Quick Actions → New Sales Order). The form lives at /orders/new. The sales order ID (PU61-YYMMXXXX) is assigned on save from the order date.',
      'Select the customer. Bill-To and Ship-To locations load from the customer master; pick the correct sites.',
      'Set Freight Terms to the customer Incoterm (FOB, FCA, CIF, DDP, …) and Shipping Method including inland modes (Local Trucking, LTL, Ground).',
      'Enter Customer Revision Date when the customer last updated their PO (this is not the internal order date).',
      'Add item lines by searching the internal part number. Customer P/N fills from the item master and can be overridden.',
      'Save as Draft, then Submit for approval if your workflow requires it.',
      'After approval, open the order and use Fulfill to ship. Enter Shipping Date (defaults to today; change it for late-month or prior-month shipments). Inventory deduction and the later AR invoice post on that shipping date. Then Invoice to create a customer sales invoice. If remaining quantity was cancelled, the invoice uses shipped quantity only (voiding a draft releases that amount so you can recreate it). If a linked subcontract is only partially received, fulfill the received quantity now and ship the remainder after the next finished-goods receipt. A sales order cannot be billed past its remaining billable total.',
      'To change an approved order that is not yet shipped, fulfilled, or fully billed, click Create Revision. The PU61 number stays the same. The approved snapshot is frozen, then you edit and re-submit for approval. Revision history and field-level change logs appear on the detail page after re-approval.',
    ],
    callouts: [
      { kind: 'required', text: 'Customer, at least one ship-to, and at least one order line are required before submit.' },
      { kind: 'important', text: 'Fulfillment and invoicing are separate steps. Shipping does not automatically create the AR invoice. Enter Shipping Date on Fulfill Items — inventory deduction and AR journals post on that date, not today.' },
      { kind: 'important', text: 'Subcontracted sales orders cannot ship more than finished-goods received. Partial receipts create a partial fulfillment; remaining quantity waits for the next receipt.' },
      { kind: 'important', text: 'After a partial shipment, use Cancel remaining to close leftover quantity. The sales order is then fulfilled for what shipped and cannot ship more. The detail page shows shipped / fulfilled quantity and cancelled quantity.' },
      { kind: 'important', text: 'Create Revision is blocked once the sales order is shipped, fulfilled, invoiced, or fully billed. Use a credit memo or a new sales order instead of overwriting billed quantities.' },
    ],
    tips: [
      'You can print / PDF an order from the detail page for customer confirmation.',
      'Attach supporting documents (POs from the customer, drawings) on the order attachments panel when available.',
    ],
    faqs: [
      {
        question: 'Can I edit an order after approval?',
        answer:
          'Not directly. Click Create Revision on the approved sales order (same PU61 number), edit the draft, then submit and approve again. If the order is already shipped, fulfilled, invoiced, or fully billed (for example PU61-26080001), Create Revision stays hidden — use a credit memo or a new sales order.',
      },
      {
        question: 'Can I ship part of a sales order when the subcontract is only partially received?',
        answer:
          'Yes. Fulfill defaults to finished-goods received so far. Ship that quantity now; the sales order stays partially fulfilled until the remaining quantity is received and shipped. If the rest will not ship, click Cancel remaining.',
      },
      {
        question: 'How do I cancel leftover quantity after a partial shipment?',
        answer:
          'On a sales order, click Cancel remaining after a partial shipment. The order then shows shipped / fulfilled quantity and cancelled quantity. On a purchase order or subcontract order, first create the supplier invoice for the received quantity, then click Cancel remaining. That closes leftover quantity so the document is no longer open for the rest.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Customer has no ship-to locations',
        fix: 'Open Master Data → Customers, edit the customer, and add at least one Ship-To (and Bill-To) location before creating the SO.',
      },
      {
        issue: 'Item does not appear when adding a line',
        fix: 'Type the internal part number in the line lookup (it searches item ID, customer P/N, and description). Confirm the item exists under Inventory → Items.',
      },
      {
        issue: 'Create Revision is missing on an approved sales order',
        fix: 'Check status and billing. Shipped, fulfilled, invoiced, or fully billed orders cannot be revised. You also need sales_order:submit.',
      },
    ],
  },
  {
    id: 'purchase-orders',
    module: 'sales',
    title: 'Creating & Managing Purchase Orders',
    routeMatch: ['/purchase-orders'],
    summary:
      'Purchase orders buy material or services from vendors. Draft → submit for approval → receive goods (GRNI) → supplier invoice.',
    screenshots: [
      { src: '/guide-screenshots/purchase-order-form.jpg', caption: 'Purchase order form with vendor and lines' },
      { src: '/guide-screenshots/purchase-order-receive.jpg', caption: 'Receive Goods action after approval' },
    ],
    steps: [
      'Go to Sales & Procurement → Purchase Orders → New. The PO number (PU62-YYMMXXXX) is assigned on save from the order date.',
      'Choose PO Type: Material PO, or Subcontract / outside processing (外發加工單).',
      'Select the vendor. Currency, payment terms, and incoterms default from the vendor master when set.',
      'For a Material PO buying kit parts, check Purchase for Subcontract Order, link the 外發加工單, then Import Subcontract Components. Remaining qty subtracts other open Material POs (including drafts).',
      'For a subcontract PO, optionally link an existing Subcontract Order so the PO is tied to that BOM / work order. Material issue still happens on the subcontract order.',
      'Set Freight Payment Terms. Prepaid shipping is added to the vendor Grand Total. 3rd-party / collect freight is estimated landed cost only and excluded from the vendor invoice total.',
      'Search and add item lines by internal part number (type to search the catalog). Save Draft anytime.',
      'Submit for approval. Approvers follow the purchasing workflow (amount bands).',
      'When the PO is Approved, open it and click Receive Goods. Enter the quantity arriving now. A short shipment is a partial receipt; if the rest will not arrive, bill the received quantity and click Cancel remaining. The system rejects over-receipt. If a received quantity was entered incorrectly, open the PU67- receipt and click Adjust quantities. Each receipt posts GRNI.',
      'Create a Supplier Invoice / Bill against received quantities under Finance → Supplier Invoices. If the vendor will not ship the rest, click Cancel remaining only after that received quantity has been billed.',
      'To change an approved or in-approval PO before any posted receipt or supplier invoice, click Create Revision. The PU62 number stays the same. The last approved snapshot is frozen, the PO returns to Draft, and Receive Goods / Create Bill stay blocked until it is approved again. Revision history and field changes appear on the PO after re-approval.',
    ],
    callouts: [
      { kind: 'required', text: 'Vendor and at least one line item are required to submit (empty lines are allowed only on Draft).' },
      { kind: 'important', text: '3rd-party freight must not appear on the goods vendor bill. Confirm Freight Payment Terms before submit; carrier account is required when freight is collect or routing.' },
      { kind: 'important', text: 'Create Revision is blocked once posted goods receipts or supplier invoices exist. Do not overwrite received or billed quantities on the same PO.' },
      { kind: 'important', text: 'Cancel remaining is blocked until the received quantity has a supplier invoice. Create the bill first, then close leftover quantity. Over-receipt is rejected with an error.' },
      { kind: 'important', text: 'Delete is only for draft / rejected POs with no posted receipts or supplier invoices. A posted PU67- receipt and its UG11- journal stay in Goods Receipts and the General Ledger.' },
    ],
    tips: [
      'Use PDF print for vendor confirmation.',
      'The Purchase Orders list can filter by type, order date (this month / last quarter / YTD), expected delivery (overdue, this week, this month, next 30 days), status, and approval. Export CSV uses the same filters.',
      'For overseas vendors, confirm Incoterms, named place, and wire details on the vendor master before sending the PO.',
    ],
    faqs: [
      {
        question: 'Where do I see billing status?',
        answer:
          'On the approved PO, billing status appears near the Receive Goods action. Unbilled receipts feed the supplier invoice form.',
      },
      {
        question: 'How do I change an approved purchase order?',
        answer:
          'Click Create Revision (same PU62 number), edit lines or header, then submit for approval again. Recall / Amend still work; they now run this same revision path. You need po:submit_for_approval or po:approve.',
      },
      {
        question: 'What if the vendor ships short or tries to ship more than ordered?',
        answer:
          'A short receipt is allowed. Bill the quantity received, then click Cancel remaining to close leftover quantity. Over-receipt is not allowed — the system raises an error if the quantity is greater than remaining receivable.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Submit for approval fails',
        fix: 'Add at least one line, confirm you have po:create / submit permission, and that an approval workflow exists for purchase orders.',
      },
      {
        issue: 'Receive Goods is disabled',
        fix: 'The PO must be Approved (approval_status APPROVED). Draft, pending, or revised-but-not-reapproved POs cannot receive.',
      },
      {
        issue: 'Receive Goods says over-receipt is not allowed',
        fix: 'Enter no more than remaining receivable. A short receipt is allowed; if the rest will not arrive, bill the received quantity and click Cancel remaining.',
      },
      {
        issue: 'Create Revision is disabled',
        fix: 'Posted goods receipts or supplier invoices lock the PO. Voided POs cannot be revised. After a revision is opened, receive and bill stay blocked until the PO is approved again.',
      },
      {
        issue: 'Delete is disabled or returns 409',
        fix: 'The PO has posted goods receipts or supplier invoices, or it is not a draft. Open Sales & Procurement → Goods Receipts to find the PU67- receipt. Its GRNI journal remains on the General Ledger.',
      },
    ],
  },
  {
    id: 'goods-receipts',
    module: 'sales',
    title: 'Finding Goods Receipts',
    routeMatch: ['/goods-receipts'],
    summary:
      'Goods Receipts lists every posted PO / SCO receipt (PU67- / UP72-) and opens the GRNI journal. Receipts stay here even if the source purchase order is later removed.',
    steps: [
      'Go to Sales & Procurement → Goods Receipts.',
      'Search by receipt number (PU67-), source PO (PU62-), or vendor.',
      'Open a receipt to see lines, warehouse, and the posted journal (UG11-). Use View Source Document on that journal to return here. Adjust quantities if a received qty was entered incorrectly (PO receipts only).',
      'Receive new quantity from the approved purchase order (Receive Goods). Partial receipts are allowed; remaining quantity can be received later.',
    ],
    callouts: [
      {
        kind: 'important',
        text: 'A goods receipt is an accounting document. Deleting the purchase order does not delete the receipt or reverse its journal.',
      },
    ],
    faqs: [
      {
        question: 'How do I correct a mistaken goods receipt quantity?',
        answer:
          'Open Sales & Procurement → Goods Receipts → the PU67- document, then Adjust quantities. You cannot exceed the PO ordered quantity or reduce below quantity already billed. Stock and the GRNI journal are updated.',
      },
      {
        question: 'The purchase order is gone. How do I open the receipt?',
        answer:
          'Use Sales & Procurement → Goods Receipts and search the PU67- number or the original PU62- number. The General Ledger journal for that receipt also links to the same receipt page.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Cannot find PU67- after the PO was deleted',
        fix: 'Open Goods Receipts (not the Purchase Orders list). Search the receipt number. The journal stays in General Ledger and still links to the receipt.',
      },
    ],
  },
  {
    id: 'overseas-vendor-orders',
    module: 'sales',
    title: 'Overseas Vendor Orders (Incoterms, Tax, Wire)',
    routeMatch: ['/purchase-orders', '/vendors'],
    summary:
      'Foreign buys need extra commercial and remittance data: Incoterms + named place, lead time, foreign tax documents, and SWIFT/IBAN for wire payments.',
    screenshots: [
      { src: '/guide-screenshots/vendor-banking.jpg', caption: 'Vendor International Banking & Remittance card' },
      { src: '/guide-screenshots/purchase-order-form.jpg', caption: 'PO Incoterms from vendor defaults' },
    ],
    steps: [
      'Open Master Data → Vendors and edit (or create) the supplier.',
      'Set Country. If it is not the United States, Overseas / Foreign Vendor turns on automatically (you can override).',
      'Enter Foreign Tax ID / VAT / FTIN and choose Tax Document Type (W-8BEN-E, W-8BEN, Certificate of Foreign Status, or Other). Domestic vendors use EIN/SSN formatting instead.',
      'On Commercial & Payment Terms set Payment Method to Wire when remitting internationally, plus Incoterms and Named Port / Place of Destination (for example FOB Kaohsiung Port).',
      'Fill International Banking & Remittance: beneficiary bank, SWIFT/BIC (8 or 11 characters), IBAN/account, and bank address. Add an intermediary bank if your treasury team uses a correspondent.',
      'Set Default Country of Origin (COO) and Lead Time (days) so buyers plan transit correctly.',
      'Create the Purchase Order. Confirm incoterms and dates on the PO, then submit, receive, and invoice as usual.',
    ],
    callouts: [
      { kind: 'required', text: 'Wire payments require beneficiary bank name and IBAN/account. Overseas wires also require SWIFT/BIC.' },
      { kind: 'important', text: 'Tax document type is for compliance (W-8 vs W-9). It does not replace the Tax ID / FTIN value itself.' },
      { kind: 'tip', text: 'Keep Incoterms on the vendor as the default; override on a single PO only when that shipment differs.' },
    ],
    tips: [
      'SWIFT/BIC is normalized to uppercase. Use 8 characters (bank) or 11 (with branch).',
      'Intermediary ABA, if used, must be 9 digits.',
    ],
    faqs: [
      {
        question: 'The vendor is overseas but the checkbox stayed off',
        answer:
          'Country values like USA, US, or United States are treated as home country. Fix the Country field, or check Overseas / Foreign Vendor manually for a foreign entity with a US mailing address.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Cannot save SWIFT code',
        fix: 'Use 8 or 11 letters/numbers only (no spaces). Example: TPBKTWTP or TPBKTWTPXXX.',
      },
    ],
  },
  {
    id: 'subcontract-orders',
    module: 'manufacturing',
    title: 'Creating Subcontract / Outside-Processing Orders',
    routeMatch: ['/subcontract-orders'],
    summary:
      'Subcontract orders (SCOs) send an assembly to an outside processor. The order pins a Material BOM, is approved, issues the component kit, then receives finished goods.',
    screenshots: [
      { src: '/guide-screenshots/sco-form.jpg', caption: 'New subcontract order header' },
      { src: '/guide-screenshots/sco-detail.jpg', caption: 'SCO detail with issue / receive actions' },
    ],
    steps: [
      'Go to Manufacturing → Subcontract Orders → New. The SCO number (UP23-YYMMXXXX) is assigned on save from the order date.',
      'Choose the subcontractor (vendor type subcontractor or both) and the assembly item.',
      'The item must have an active Material BOM. The active version is the default and quantity drives the kit.',
      'Save the SCO. Open the detail page to review required components.',
      'Submit and approve the SCO while it is still Draft. Materials cannot be issued until the order is approved.',
      'After approval, issue kit components to the subcontractor. A partial issue is allowed; quantity cannot exceed remaining required. Then receive finished goods. Print the shipping document from an issue when the kit is sent.',
      'When finished goods return, record a receipt (quantity cannot exceed remaining ordered). A short receipt is allowed; if the processor will not return the rest, bill the received quantity and click Cancel remaining. Over-receipt is rejected. GRNI is posted for the value received. The parent sales order can then fulfill only the quantity received so far.',
      'Create a supplier invoice against the SCO / receipt from Finance when the processor bills you. If the processor will not return the rest, click Cancel remaining only after that received quantity has been billed.',
      'To change vendor charges or finished-good quantity after approval, open the SCO and click Create Revision. Edit the sheet, then submit for approval again. The SCO number stays the same. Linked purchase orders stay on the same SCO.',
    ],
    callouts: [
      { kind: 'required', text: 'Approve the subcontract order first. Materials can be issued only after approval, and finished goods can be received only after the kit is issued.' },
      { kind: 'required', text: 'A linked Sales Order must already be approved. Draft sales orders cannot be selected or saved on the SCO.' },
      { kind: 'important', text: 'Status moves with materials issued and goods received. Do not invoice before a finished-goods receipt if you match to GRNI.' },
      { kind: 'important', text: 'After approval, use Create Revision to change vendor charges or quantity. Do not cancel and recreate the SCO if a Material PO is already linked.' },
    ],
    tips: [
      'Use Print shipping document on each material issue as the packing list for the subcontractor. The SCO PDF is the order/cost attachment.',
      'If BOM lines change, create/activate a new BOM version on the item before opening a new SCO.',
    ],
    faqs: [
      {
        question: 'How do I change the cost sheet after the SCO is approved?',
        answer:
          'Do not cancel the SCO. Click Create Revision, update the charges or quantity, and submit for approval again. Linked purchase orders stay. Issue and receive stay locked until the revision is approved. Wait for re-approval before creating a new subcontractor bill.',
      },
      {
        question: 'How do I track status?',
        answer:
          'The SCO list and detail header show status (planned, materials issued, partially received, completed, cancelled). Receipts and material issues are on the same detail page.',
      },
      {
        question: 'What if the processor returns short or tries to return more than ordered?',
        answer:
          'A short receipt is allowed. Bill the quantity received, then click Cancel remaining. Over-receipt is not allowed — the system raises an error if the quantity is greater than remaining receivable. The same rule applies to kit issue: a partial issue is allowed, and over-issue is rejected.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Cannot edit the cost sheet on an approved SCO',
        fix: 'Use Create Revision (not Cancel). That freezes the approved snapshot and reopens Draft on the same SCO. Linked POs stay. Re-submit after you save the charges.',
      },
    ],
  },
  {
    id: 'inventory-stock',
    module: 'inventory',
    title: 'Stock Lookups (On-Hand & ATP)',
    routeMatch: ['/inventory', '/items'],
    summary:
      'Stock On-Hand & ATP shows quantity on hand, allocated, and available to promise. Item master holds the SKU, costing flags, and BOM.',
    screenshots: [
      { src: '/guide-screenshots/inventory.jpg', caption: 'Inventory overview with status filters' },
      { src: '/guide-screenshots/item-detail.jpg', caption: 'Item detail with on-hand quantities' },
    ],
    steps: [
      'Go to Inventory → Stock On-Hand & ATP for a cross-SKU view.',
      'Filter by status (In Stock, Low Stock, Out of Stock) or view reorder alerts / pending shipment.',
      'Click an item to open the item record for description, UOM, flags (purchase item, raw material, subcontract assembly), and on-hand / WIP.',
      'From Items you can create or edit SKUs, set Item Type (Inventory / Non-Inventory / Service), and maintain vendor mappings.',
    ],
    callouts: [
      { kind: 'tip', text: 'ATP is on-hand minus allocated. Low stock uses the item’s planning signals on the overview.' },
    ],
    tips: ['Use list sort headers to find the tightest SKUs quickly.'],
    faqs: [
      {
        question: 'On-hand does not match the warehouse I expected',
        answer:
          'Check Inventory → Warehouses & Bins for the location structure, then Stock Movements filtered by that SKU to see receipts, issues, transfers, and adjustments.',
      },
    ],
    troubleshooting: [
      {
        issue: 'New item does not show in inventory',
        fix: 'Create the item first, then post a Receipt movement (or receive a PO). Zero-quantity SKUs may still list depending on filters.',
      },
    ],
  },
  {
    id: 'inventory-movements',
    module: 'inventory',
    title: 'Adjustments, Transfers, and Receiving',
    routeMatch: ['/inventory/movements', '/inventory/warehouses'],
    summary:
      'Stock Movements records Receipt, Issue, Adjustment, and Transfer history. Receiving against a PO is done on the approved purchase order (Receive Goods), which then appears here as a Receipt.',
    screenshots: [
      { src: '/guide-screenshots/stock-movements.jpg', caption: 'Stock movements filtered by Receipt' },
      { src: '/guide-screenshots/warehouses.jpg', caption: 'Warehouses & bins setup' },
    ],
    steps: [
      'To receive a purchase: open the Approved PO → Receive Goods. That posts GRNI and a Receipt movement into Main Warehouse (created automatically if none exist).',
      'To inspect history: Inventory → Stock Movements. Filter Type = Receipt, Issue, Adjustment, or Transfer.',
      'Use the product/SKU filter or dashboard “pending receiving” KPI to jump here with Receipt already selected.',
      'Maintain physical structure under Inventory → Warehouses & Bins. Use Add warehouse (creates a RECEIVING bin automatically) and Add bin for extra aisles or racks.',
    ],
    callouts: [
      { kind: 'important', text: 'PO receiving is not a free-form movement on this page — start from the purchase order so GRNI and billing stay in sync.' },
      { kind: 'tip', text: 'Subcontract finished goods are received on the SCO detail page, not on the PO.' },
    ],
    faqs: [
      {
        question: 'How do I correct a wrong quantity?',
        answer:
          'Post an Adjustment movement (or a reversing Issue/Receipt per your warehouse SOP). Do not silently edit an old receipt if it already billed.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Receipt from PO not listed',
        fix: 'Confirm Receive Goods succeeded on the PO. Open Sales & Procurement → Goods Receipts for the PU67- document, then clear extra filters on Stock Movements (type, SKU, dashboard metric).',
      },
    ],
  },
  {
    id: 'customers-master',
    module: 'master-data',
    title: 'Setting Up Customers',
    routeMatch: ['/customers'],
    summary:
      'The customer master stores commercial data, Tax ID type/value, Bill-To and Ship-To sites, and certifications used by sales orders.',
    screenshots: [
      { src: '/guide-screenshots/customer-form.jpg', caption: 'Customer General & Commercial Info with Tax ID Type' },
      { src: '/guide-screenshots/customer-shipto.jpg', caption: 'Bill-To / Ship-To tabs' },
    ],
    steps: [
      'Go to Master Data → Customers → Create New Customer (or edit an existing ID).',
      'On General & Commercial Info enter Customer ID, Company Name, currency, credit limit, payment terms, and incoterms.',
      'Set Tax ID Type (EIN, TIN, VAT, SSN, or Other) and Tax ID. EIN uses XX-XXXXXXX; SSN uses XXX-XX-XXXX.',
      'Add at least one Bill-To and one Ship-To location (address, city, postal code, country). Mark defaults.',
      'Optionally add certifications (ISO 9001, IATF 16949, and so on).',
      'Save. The customer can now be selected on sales orders.',
    ],
    callouts: [
      { kind: 'required', text: 'Customer ID, company name, one Bill-To, and one Ship-To are required.' },
      { kind: 'tip', text: 'Use Copy from Primary Bill-To on the Ship-To tab when sites share an address.' },
    ],
    tips: [
      'Tax ID Type is stored separately from Tax ID so reports can distinguish EIN vs VAT vs SSN.',
      'Customer Number Ext holds the customer’s own account number for your company (for example a Denso supplier number).',
    ],
    faqs: [
      {
        question: 'Can I change Customer ID later?',
        answer: 'No. ID is the primary key and is locked in edit mode. Create a new customer if the ID was issued incorrectly.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Save blocked on locations',
        fix: 'Every filled location needs name, address line 1, city, postal code, and country. Add at least one bill-to and one ship-to.',
      },
    ],
  },
  {
    id: 'vendors-master',
    module: 'master-data',
    title: 'Setting Up Vendors (Domestic vs Overseas)',
    routeMatch: ['/vendors'],
    summary:
      'Vendors (suppliers) drive purchasing and subcontracting. Mark overseas vendors for foreign tax documents and SWIFT/IBAN remittance; domestic vendors use EIN/SSN tax IDs.',
    screenshots: [
      { src: '/guide-screenshots/vendor-form.jpg', caption: 'Vendor Basic Info with Overseas checkbox' },
      { src: '/guide-screenshots/vendor-banking.jpg', caption: 'International Banking & Remittance card' },
    ],
    steps: [
      'Go to Master Data → Vendors → Create New Vendor.',
      'Enter Vendor ID, company name, and Vendor Type (material, subcontractor, both, or service).',
      'Fill Contact & Address, including Country. Non-US countries default Overseas / Foreign Vendor to on.',
      'Domestic: enter Tax ID / VAT in EIN or SSN format. Overseas: enter Foreign Tax ID / VAT / FTIN and Tax Document Type (W-8BEN-E, W-8BEN, Certificate of Foreign Status, Other). W-9 is the domestic US equivalent stored when applicable.',
      'Set payment terms, payment method (Wire, ACH, Check, Credit card), currency, AP account, Incoterms, named place, COO, and lead time.',
      'If overseas or payment method is Wire, complete International Banking & Remittance (bank, SWIFT, IBAN, address, optional intermediary).',
      'For subcontractors, fill Work Center, consignment location, scrap rate, and ISO certified as needed.',
      'Save. The vendor is available on POs and subcontract orders.',
    ],
    callouts: [
      { kind: 'required', text: 'Vendor ID and company name are required. Wire + overseas requires SWIFT.' },
      { kind: 'important', text: 'QC Status (Approved / Probation / Blocked) should stay Approved for vendors you still buy from.' },
    ],
    tips: [
      'Vendor Number Ext stores the vendor’s account number for your company.',
      'Keep SWIFT and intermediary details in the master so AP does not re-key them on every invoice.',
    ],
    faqs: [
      {
        question: 'When does the banking card appear?',
        answer: 'When Overseas / Foreign Vendor is checked, or when Payment Method is Wire.',
      },
      {
        question: 'W-8BEN vs W-8BEN-E vs W-9?',
        answer:
          'W-9 is US persons. W-8BEN is foreign individuals; W-8BEN-E is foreign entities. Certificate of Foreign Status covers other foreign-status letters. Pick Other if the document is not in the list.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Domestic EIN rejected',
        fix: 'Use XX-XXXXXXX (nine digits with a hyphen after the second). For SSN type three digits then a hyphen to switch to XXX-XX-XXXX.',
      },
    ],
  },
  {
    id: 'payment-terms-master',
    module: 'master-data',
    title: 'Payment Terms Master',
    routeMatch: ['/payment-terms'],
    summary:
      'Payment terms are a global master (NET30, P02, Due on Receipt). Vendors and customers store a default; purchase orders and AP/AR invoices inherit it and can override. Due date is invoice date plus due days.',
    steps: [
      'Go to Master Data → Payment Terms (also listed under Finance → General Ledger & Setup).',
      'Review the seeded terms (Net 15/30/60/90, Due on Receipt, P02, P10, Advance) or create a new code, description, and due days.',
      'Optional: enter discount days and discount percentage for early-pay discounts.',
      'Deactivate a term to hide it from new dropdowns without deleting history on existing documents.',
      'Assign a default term on Master Data → Vendors and Customers. New POs and AP invoices copy the vendor term; you can override on the document.',
      'On an AP invoice, due date recalculates as invoice date + due days when you change the term.',
    ],
    callouts: [
      { kind: 'required', text: 'Code must be unique. Due days is the number of days added to the invoice date.' },
      { kind: 'tip', text: 'P02/P10 are stored as 32/40 net days so due dates stay invoice_date + due_days.' },
    ],
    faqs: [
      {
        question: 'What happened to free-text Net 30 / P02 on vendors?',
        answer:
          'Existing strings were linked to the master list. Vendors still show a code (for example NET30 or P02) in the list, and the dropdown is driven by the master.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Vendor dropdown is empty',
        fix: 'Create at least one active term under Master Data → Payment Terms, then refresh the vendor form.',
      },
    ],
  },
  {
    id: 'finance-invoicing',
    module: 'finance',
    title: 'Customer Invoicing & Accounts Receivable',
    routeMatch: ['/sales-invoices', '/accounts-receivable'],
    summary:
      'Sales invoices bill the customer after fulfillment. AR Aging & Collections tracks unpaid and overdue balances.',
    screenshots: [
      { src: '/guide-screenshots/sales-invoices.jpg', caption: 'Sales invoice list' },
      { src: '/guide-screenshots/ar-aging.jpg', caption: 'AR aging workspace' },
    ],
    steps: [
      'From an approved, shipped sales order, choose Invoice (or Finance → Sales Invoices).',
      'Confirm bill-to, lines, tax, and dates, then save / post per your workflow.',
      'Open Finance → Sales Invoices and click an Invoice # (US55-YYMMXXXX) to open the invoice detail page: header, line items, payment history, PDF, and credit memo when eligible.',
      'The same Invoice ID on AR Aging & Collections also opens that detail page.',
      'Dashboard finance KPIs (outstanding AR, overdue invoices) deep-link here with filters applied.',
    ],
    callouts: [
      { kind: 'important', text: 'Invoicing is typically after fulfillment so quantities match what shipped.' },
      { kind: 'tip', text: 'Use the sales invoice list to jump to AR aging for a customer.' },
      {
        kind: 'tip',
        text: 'Sales Invoices can filter by issue date (this month / last quarter / YTD), due date (overdue, this week, this month, next 30 days), and status. Overdue skips paid and void invoices. Export CSV uses the same filters.',
      },
    ],
    faqs: [
      {
        question: 'What is the difference between Sales Invoices and AR Aging?',
        answer:
          'Sales Invoices is the operational invoice register (create/view). AR Aging is collections: open balances by age.',
      },
      {
        question: 'How do I see which payment cleared an invoice?',
        answer:
          'Click the Invoice ID in AR Aging or the Invoice # in Sales Invoices. Payment & transaction history lists Check Deposit cash references and amounts applied.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Cannot invoice an order',
        fix: 'Confirm fulfillments exist, you have sales_order / invoice permission, and the order is not already fully invoiced.',
      },
    ],
  },
  {
    id: 'finance-ap',
    module: 'finance',
    title: 'Supplier Bills & Accounts Payable',
    routeMatch: [
      '/supplier-invoices',
      '/accounts-payable',
      '/cash-management',
      '/bank-accounts',
    ],
    summary:
      'Supplier invoices include PO/SCO 3-way match bills and Non-PO vouchers (freight, duty, rent, utilities). AP Aging & Payments shows what you owe.',
    screenshots: [
      { src: '/guide-screenshots/supplier-invoice-form.jpg', caption: 'New supplier invoice defaulting unbilled receipts' },
      { src: '/guide-screenshots/ap-aging.jpg', caption: 'AP aging' },
    ],
    steps: [
      'Receive goods on the PO or SCO first (GRNI) for PO-matched bills.',
      'Go to Finance → Supplier Invoices / Bills. Use Create Bill from an approved PO/SCO, or Create Non-PO Invoice for freight, customs duty, rent, utilities, or salaries.',
      'For Non-PO invoices, choose Expense (GL distribution) or Landed Cost (optional goods-receipt allocation). No purchase order is required.',
      'Select the vendor / source document. Bill # (UX13-YYMMXXXX) is the internal GTT number assigned on save from the Posting Date (defaults to today). Enter Invoice Date as the vendor invoice date — late invoices can keep the original invoice date even if that month is already closed. Enter the Supplier Invoice Number from the vendor invoice separately — it appears on the bill View after save and approval. PO-matched lines default to unbilled received quantities at order prices.',
      'Save as draft or submit for approval. A Non-PO draft, returned, or pending bill can be opened and edited from the list or bill page. After Submit, the reviewer can Return it or Edit the voucher before approving. PO-matched posting typically debits GRNI and credits AP on the invoice Posting Date. Expense invoices debit the chosen GL accounts; landed cost allocated to a receipt debits Inventory.',
      'Open Finance → Supplier Invoices and click a Bill # (UX13-YYMMXXXX) to open the bill detail page: header, line items, payment history, PDF, and Pay when eligible. Pay can be recorded more than once — enter each amount and payment date until the outstanding balance is zero.',
      'The same Bill ID on AP Aging & Payments also opens that detail page.',
      'Cash & Treasury → Cash Management for bank-side movement. Bank Account, Type (for example ACH - Ref #99381), and Payee/Payer support daily reconciliation. Receive Payment / Make Payment asks for bank account, payment method, instrument/reference number, and payment date (Operating is the default bank). Add or edit company banks under Cash & Treasury → Bank Accounts. Open a bank with View to see the detail page, or Edit to change the mapped G/L account. Click a Transaction ID for bank and instrument detail, or a Reference ID to open the related invoice or bill.',
    ],
    callouts: [
      { kind: 'required', text: 'Match PO bills to receipts. Billing a PO-matched invoice with no receipt breaks GRNI clearing. Non-PO expense invoices do not require a PO or receipt.' },
      { kind: 'tip', text: 'Overseas wire details come from the vendor master — verify SWIFT/IBAN before releasing payment.' },
      {
        kind: 'tip',
        text: 'Supplier Invoices can filter by bill date (this month / last quarter / YTD), due date (overdue, this week, this month, next 30 days), status, and source (PO / SCO / Non-PO). Overdue skips paid and cancelled bills. Export CSV uses the same filters.',
      },
    ],
    faqs: [
      {
        question: 'What is the difference between Supplier Invoices and AP Aging?',
        answer:
          'Supplier Invoices is the operational bill register (create/view). AP Aging is payments: open balances by due date.',
      },
      {
        question: 'How do I see which payment cleared a bill?',
        answer:
          'Click the Bill ID in AP Aging or the Bill # in Supplier Invoices. Payment & transaction history lists Check Issue cash references and amounts applied.',
      },
      {
        question: 'Can I pay a supplier invoice in more than one payment?',
        answer:
          'Yes. Use Pay on the bill and enter the amount and date for each disbursement. The bill stays Partial until the remaining balance is cleared.',
      },
      {
        question: 'How do I enter freight or rent without a purchase order?',
        answer:
          'Use Create Non-PO Invoice. Choose Landed Cost for freight/duty: search the goods PO, then pick that PO’s receipt (allocation stores the receipt ID). Or choose Expense for rent, utilities, and salaries and distribute amounts to GL accounts.',
      },
      {
        question: 'Can I edit a Non-PO bill after I save it as draft?',
        answer:
          'Yes. Open the bill and click Edit while it is Draft, Returned, or Pending. After Submit, the reviewer can Return it or Edit it before approving. After Approve, use Rescind on an unpaid Non-PO bill to reverse the AP posting, then Edit and resubmit. Paid bills cannot be rescinded.',
      },
      {
        question: 'Where is the Chart of Accounts?',
        answer: 'Finance & Accounting → General Ledger & Setup → Chart of Accounts. AP account on the vendor should point to a liability account.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Invoice lines are zero',
        fix: 'Nothing unbilled remains. Receive goods on the PO/SCO, or check billing_status on the PO.',
      },
    ],
  },
  {
    id: 'finance-bank-transfers',
    module: 'finance',
    title: 'Bank Transfers',
    routeMatch: ['/bank-transfers'],
    summary:
      'Move cash between company bank accounts. The transfer stays Draft until it is approved; approval posts the journal using each bank’s mapped G/L account (not a posting-rule pair).',
    steps: [
      'Go to Finance & Accounting → Cash & Treasury Management → Bank Transfers → New.',
      'Choose the from bank, to bank, amount, currency, and transfer date. Both banks must already exist under Bank Accounts with a G/L account mapped.',
      'Save as Draft, then Submit for approval (same cash-submit / cash-approve permissions as other cash documents).',
      'When the transfer is fully approved, the system posts a journal: debit the destination bank G/L, credit the source bank G/L.',
      'Open the transfer detail to see status and the linked journal. Cash Management and Bank Account Detail then show the movement.',
    ],
    callouts: [
      { kind: 'required', text: 'From bank and to bank must be different, and each needs a mapped G/L account before you can post.' },
      { kind: 'important', text: 'Bank-transfer journals do not update posting rules. The accounts come from the Bank Account master.' },
    ],
    faqs: [
      {
        question: 'Why is the transfer still Draft after I generate it?',
        answer:
          'Like close journals, bank transfers go through approval. The cash movement and journal post only when approval_status is APPROVED.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Cannot submit a transfer',
        fix: 'Confirm both bank accounts exist, amounts are greater than zero, and you have cash:submit. If approval fails, check cash:approve and the bank-transfer workflow.',
      },
    ],
  },
  {
    id: 'finance-journals',
    module: 'finance',
    title: 'Manual Journal Entry',
    routeMatch: ['/general-ledger', '/general-ledger/journals'],
    summary:
      'Manual journals record accruals, corrections, and other GL adjustments. Auto-generated journals (bank transfer, close, GRNI, invoices) also appear in the ledger after they are approved.',
    steps: [
      'Go to Finance & Accounting → General Ledger & Setup → Manual Journal Entry (or open General Ledger and create a journal).',
      'Enter the journal date, reference, and balanced debit/credit lines against Chart of Accounts codes.',
      'Save as Draft, then Submit for approval. The journal posts only when it is approved (posting_status Posted). Use View on a submitted journal to read the lines; use Return to Draft to send it back for editing, then Submit again.',
      'Use General Ledger filters to search by journal text, source, posted date, period, posting rule, posting status, or approval. The Journal Entries tab lists headers with a total count at the bottom. Open Posting Detail to review debit/credit lines and their totals for the same filters. The list and Export CSV default to Posted journals so the file can be summed to Trial Balance. Switch Posting to All to include drafts. System-generated journals show a System chip and link back to the source document and posting rule.',
      'Do not rewrite posting rules when an auto-generated journal is created. Year-end close reads YEC_CLOSE (P&L → 3350) and YEC_NI_CLEAR (reverse 3353 / 3354); month-end parks NI with MEC_PARK_NI; bank transfers use each bank’s G/L.',
    ],
    callouts: [
      { kind: 'required', text: 'Debits must equal credits before submit.' },
      { kind: 'important', text: 'Draft journals do not affect trial balance, P&L, or financial reports. Approve them first.' },
    ],
    faqs: [
      {
        question: 'Can I edit a journal after it was submitted or returned?',
        answer:
          'Yes, for manual journals. Open View on a pending journal, then Return to Draft (with a reason). The journal becomes Draft so you can Edit the lines and Submit again. Auto-generated journals stay read-only — reverse them from the source document so the audit trail stays intact.',
      },
      {
        question: 'Should I change a posting rule when a journal is auto-generated?',
        answer:
          'No. Posting rules hold the account pairs users maintain. Generated journals read those rules (or the bank G/L / close targets) at post time. Edit Posting Rules only when the default accounts themselves should change.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Journal will not post',
        fix: 'Confirm lines balance, you have journal:submit / journal:approve, and a journal-entry workflow exists. Close and transfer journals must be approved like any other journal.',
      },
    ],
  },
  {
    id: 'finance-posting-rules',
    module: 'finance',
    title: 'Posting Rules',
    routeMatch: ['/posting-rules', '/chart-of-accounts'],
    summary:
      'Posting rules tell the engine which Chart of Accounts pair to use for operational events (sales invoice, GRNI, AP, cash, month-end close, and year-end close). Users maintain the accounts; the engine only reads them.',
    steps: [
      'Go to Finance & Accounting → General Ledger & Setup → Posting Rules.',
      'Review each event (for example sales invoice revenue, PO goods receipt, supplier bill, month-end close, YEC_CLOSE).',
      'Set or change the debit and credit G/L accounts. Month-end parks current-period NI (3354 / 3353). Year-end close stores the P&L-to-retained-earnings target (4110001 / 3350) and the reverse monthly NI pair (3353 / 3354).',
      'Keep Chart of Accounts codes active before you point a rule at them (Finance → Chart of Accounts).',
      'After you change a rule, new postings use the new pair. Already-posted journals are not rewritten.',
    ],
    callouts: [
      { kind: 'important', text: 'Bank transfers do not use a posting-rule pair. They post to the G/L accounts mapped on the from/to Bank Account records.' },
      { kind: 'tip', text: 'If a generated journal looks wrong, fix the posting rule (or bank G/L) first, then post the next document. Do not edit the rule “because a journal was generated.”' },
    ],
    faqs: [
      {
        question: 'Where is the Chart of Accounts?',
        answer:
          'Finance & Accounting → General Ledger & Setup → Chart of Accounts. Vendor AP account and bank G/L mappings should point at accounts that exist here.',
      },
    ],
    troubleshooting: [
      {
        issue: 'A posting fails with a missing account pair',
        fix: 'Open Posting Rules, find the event, and set both debit and credit accounts. Confirm those codes exist and are active on the Chart of Accounts.',
      },
    ],
  },
  {
    id: 'finance-close',
    module: 'finance',
    title: 'Month-End and Year-End Close',
    routeMatch: [
      '/general-ledger/month-end-close',
      '/general-ledger/year-end-close',
      '/general-ledger/period-management',
    ],
    summary:
      'Month-End Close parks current-period net income to temporary accounts 3354 (IS) and 3353 (BS). Revenue and expense stay open. Year-End Close zeros full-year P&L into 3350 and reverses the monthly NI park.',
    steps: [
      'Use Period Management to Soft Close the month after operational AP/AR documents are complete. Soft Close still allows adjusting journals and Month-End / Year-End Close.',
      'Each month, including December, open General Ledger → Month-End Close and select the period.',
      'Generate the MEC park journal (Debit 3354 / Credit 3353 for net income; reverse on a loss). Do not close P&L.',
      'Hard Close the period on Period Management when adjustments are done. Only an Admin can reopen a hard close, and a justification is required.',
      'Operational journals post when they are approved; they are not batch-posted here.',
      'When the fiscal year is ready, open Year-End Close. Approve remaining operational and monthly park journals first.',
      'Generate the YEC-YYYY journal (close P&L to 3350, then reverse 3353 / 3354), then submit it for approval.',
    ],
    callouts: [
      {
        kind: 'important',
        text: 'Year-End Close does not post immediately. The auto-generated journal must go through the journal approval workflow.',
      },
      {
        kind: 'tip',
        text: 'You can generate the year-end journal before December 31; it stays Draft until approved.',
      },
    ],
    faqs: [
      {
        question: 'Can I use Month-End Close instead of Year-End Close in December?',
        answer:
          'No. Month-End Close parks monthly NI to 3353/3354 and leaves revenue and expense intact. Year-End Close is required to transfer full-year P&L into retained earnings (3350) and reverse the parked current-period NI.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Generate Closing Journal is disabled on Year-End Close',
        fix: 'Approve remaining operational journals so they post, confirm posted P&L exists for the year, and delete any existing YEC-YYYY draft if you need to regenerate.',
      },
    ],
  },
  {
    id: 'finance-reports',
    module: 'finance',
    title: 'Financial Reports',
    routeMatch: ['/financial-reports'],
    summary:
      'Finance & Accounting → Reports & Analytics → Financial Reports produces statements and sub-ledger reports from posted journals, open AR/AP, and cash clearing.',
    steps: [
      'Open Finance & Accounting → Reports & Analytics. Click the group name (or a category such as Primary Financial Statements) to land on the Financial Reports hub. Nested report names open that statement’s generator; Generate Report / View on a card does the same.',
      'On the hub, reports are grouped as Primary Financial Statements, Operational & Sub-Ledger, and Managerial & Cash. Each card shows parameters (As Of Date, Currency, and so on) and Generate Report or View.',
      'Set As Of Date, Date Range, Period / Fiscal Year, and Currency. Branch is company-wide until a branch dimension is added.',
      'Click Generate Report. Amounts are right-aligned; section totals use a single underline and net values use a double underline.',
      'Export as PDF (print), CSV, or Excel. Aging rows link back to AR/AP workspaces; bank rows open Bank Account Detail.',
      'From the AI Assistant you can ask for the same statements (“Income Statement for June 2026”, “P&L for September 2026”). Use Open the full report to land here with the period already set.',
    ],
    callouts: [
      { kind: 'important', text: 'Statements include posted journal entries only. Draft journals do not affect trial balance or P&L. Income Statement shows period Debit / Credit / Net plus YTD Debit / YTD Credit / YTD Net from January 1 through Date to (credit − debit for sales such as 4110001). Trial Balance Period Net uses the same operating activity as the period columns.' },
      { kind: 'tip', text: 'Budget vs. Actual uses the budget book when rows exist; otherwise it compares to the same dates in the prior year.' },
    ],
    faqs: [
      {
        question: 'Who can see financial statements?',
        answer:
          'Users with report:view (Finance Approver, Manager, and Admin). Other roles will not see the Reports & Analytics menu.',
      },
      {
        question: 'Why is the Balance Sheet missing net income in equity?',
        answer:
          'Current-year net income is shown as a plug under Equity (3353) after month-end park journals post. Year-End Close then zeros P&L into retained earnings (3350) and reverses 3353 / 3354.',
      },
      {
        question: 'Can the AI Assistant open these reports?',
        answer:
          'Yes. Ask for Income Statement / P&L, Balance Sheet, Cash Flow, or Trial Balance with a period (for example June 2026). The answer includes a live table and Open the full report, which opens this generator with ?period=YYYY-MM.',
      },
    ],
    troubleshooting: [
      {
        issue: 'A report is empty',
        fix: 'Confirm journals are Posted (not Draft), widen the date range, and check Currency matches ledger postings (usually USD).',
      },
    ],
  },
  {
    id: 'admin-rbac',
    module: 'admin',
    title: 'Users, Roles & Permissions',
    routeMatch: ['/admin/rbac'],
    summary:
      'Administrators assign roles, permissions, and approval workflows. This controls which sidebar modules and actions each user sees.',
    screenshots: [
      { src: '/guide-screenshots/admin-rbac.jpg', caption: 'Users & Roles tabs' },
      { src: '/guide-screenshots/admin-workflows.jpg', caption: 'Workflow tree by module' },
    ],
    steps: [
      'Go to Administration → Users & Roles (permission admin:manage).',
      'Users tab: find the person, assign one or more roles (Sales Rep, Purchasing Agent, SCO Supervisor, Finance Approver, Manager, Admin).',
      'Roles tab: review which permission codes belong to a role (sales_order:view, po:view, subcontract:view, and so on).',
      'Permissions tab: add codes only if you are extending the security model.',
      'Workflows tab: maintain approval steps and amount bands for sales orders, POs, and bills.',
      'Ask the user to sign out and back in so the sidebar and dashboard refresh.',
    ],
    callouts: [
      { kind: 'important', text: 'Admin always sees every category. Other roles are gated by both role membership and permission codes on each link.' },
      { kind: 'required', text: 'New employees stuck on Welcome need a role assigned here.' },
    ],
    tips: [
      'Company letterhead (logo, contact, bill-to / ship-to) is under Administration → Company Profile and prints on order PDFs.',
      'CSV Import (Administration) maps TIPTOP customer/vendor/item/BOM files, plus optional chartOfAccount.csv and 試算表 trial-balance files, then upserts them into the database.',
    ],
    faqs: [
      {
        question: 'A user has a role but still cannot open Purchase Orders',
        answer:
          'The role may be missing po:view. Edit the role’s permission codes, or assign an additional role that includes purchasing.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Sidebar empty except Home',
        fix: 'The account is unassigned or lacks module roles. Assign ROLE-SALES-REP, ROLE-PURCH-AGENT, etc., matching their job.',
      },
    ],
  },
  {
    id: 'admin-company-profile',
    module: 'admin',
    title: 'Company Profile & Workspace Settings',
    routeMatch: ['/admin', '/admin/company-profile'],
    summary:
      'Administrators maintain the company letterhead under Administration → Company Profile. The logo, contact, email, and bill-to / ship-to locations print on Sales Order, Purchase Order, and Subcontract Order PDFs.',
    screenshots: [
      { src: '/guide-screenshots/topbar.jpg', caption: 'Top bar company title and user menu' },
    ],
    steps: [
      'Open Administration → Company Profile (permission admin:manage).',
      'Upload a PNG or JPEG logo. The file is stored in the system and attached to each order PDF header.',
      'Enter the company contact, email, and phone printed next to the logo.',
      'Enter Bill To and Ship To locations. Purchase Order and Subcontract Order PDFs use these company addresses. Sales Order PDFs use the customer bill-to / ship-to, including location contact and email.',
      'Save the profile, then open an order and click PDF to confirm the letterhead.',
      'Customer Tax ID types and vendor W-8 / W-9 / SWIFT details stay on those master records.',
    ],
    callouts: [
      { kind: 'important', text: 'Upload the logo on Company Profile once. Every new Sales, Purchase, and Subcontract order PDF uses that image.' },
      { kind: 'tip', text: 'Need a new role or sidebar module? That is an Administration change, not a personal setting.' },
    ],
    faqs: [
      {
        question: 'Where do I set the company EIN or bank account?',
        answer:
          'Customer EIN/TIN/VAT/SSN is on the customer master. Vendor EIN or foreign tax ID, W-8/W-9 type, and SWIFT/IBAN are on the vendor master. AP cash movement is under Finance → Cash Management.',
      },
    ],
    troubleshooting: [
      {
        issue: 'I cannot open Administration',
        fix: 'Only ROLE-ADMIN with admin:manage can open Company Profile, Users & Roles, and CSV Import. Other roles use Help and their operational modules.',
      },
    ],
  },
  {
    id: 'admin-import',
    module: 'admin',
    title: 'CSV Import',
    routeMatch: ['/admin/data-import'],
    summary:
      'Upload TIPTOP CSVs, preview mapped masters, then incrementally upsert. Optionally load a 試算表 trial balance after choosing the ending period. Truncate & reload is only for a first-time rebuild.',
    screenshots: [
      { src: '/guide-screenshots/admin-import.jpg', caption: 'Data import preview tabs' },
    ],
    steps: [
      'Open Administration → CSV Import.',
      'Upload the TIPTOP CSVs (or a zip) onto this server. Windows: C:\\erp\\erp-project\\imports. OCI: /data/imports. No laptop path is required.',
      'Choose the Customers, Suppliers, Items, BOM, Chart of Accounts, or Trial Balance tab and review mapped columns.',
      'Fix source-file issues called out in warnings.',
      'Click Incremental upsert to insert new IDs and update existing masters (customers, vendors, items, BOM, accounts) without deleting orders.',
      'To load ending balances, upload a 試算表 CSV, enter the ending period (YYYY-MM), and click Load trial balance. The file usually has no period column, so the month you enter is required.',
      'Use Truncate & reload only for a first-time or rebuild load. That wipes those masters and related transactional rows, then reloads from the CSVs.',
    ],
    callouts: [
      { kind: 'important', text: 'After go-live, use Incremental upsert only. Truncate & reload deletes customers, vendors, items, BOM, chart of accounts, and related orders/inventory/invoices.' },
    ],
    troubleshooting: [
      {
        issue: 'Vendor shows as domestic after import',
        fix: 'Country was blank or US-like in the file. Edit the vendor and set Country / Overseas, or correct the address in the source CSV.',
      },
      {
        issue: 'Chart of account type looks wrong after import',
        fix: 'Type is inferred from the account name, then the 1xxx–9xxx code range. Open Finance → Chart of Accounts and edit account_type, or correct the name in chartOfAccount.csv and re-run with --upsert.',
      },
      {
        issue: 'Trial balance load is disabled or fails',
        fix: 'Enter the ending period as YYYY-MM. Accounts in the CSV must already exist in Chart of Accounts. Re-upload the 試算表 file if the import folder does not list it.',
      },
    ],
  },
]

export function searchHelpArticles(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase()
  if (!q) return HELP_ARTICLES
  return HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.title,
      article.summary,
      article.module,
      ...(article.steps || []),
      ...(article.tips || []),
      ...(article.callouts || []).map((c) => c.text),
      ...(article.faqs || []).flatMap((f) => [f.question, f.answer]),
      ...(article.troubleshooting || []).flatMap((t) => [t.issue, t.fix]),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${escaped}/?$`)
}

export function pathMatches(pathname: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => {
    if (pathname === pattern) return true
    if (patternToRegex(pattern).test(pathname)) return true
    const skipPrefix = pattern === '/' || pattern === '/help' || pattern === '/user-guide'
    if (!skipPrefix && !pattern.includes(':') && pathname.startsWith(`${pattern}/`)) {
      return true
    }
    return false
  })
}

export function getArticlesForPath(pathname: string): HelpArticle[] {
  if (pathname === '/help' || pathname.startsWith('/help/') || pathname.startsWith('/user-guide')) {
    return HELP_ARTICLES.filter((article) => article.id === 'using-the-guide')
  }
  const scored = HELP_ARTICLES.flatMap((article) => {
    const patterns = article.routeMatch || []
    if (!pathMatches(pathname, patterns)) return []
    const specificity = Math.max(
      0,
      ...patterns
        .filter((pattern) => pathMatches(pathname, [pattern]))
        .map((pattern) => pattern.replace(/:[^/]+/g, '*').length),
    )
    return [{ article, specificity }]
  })
  scored.sort((a, b) => b.specificity - a.specificity)
  if (scored.length > 0) return scored.map((row) => row.article)
  if (pathname === '/' || pathname === '') {
    return HELP_ARTICLES.filter((a) => a.module === 'home')
  }
  return []
}

export function getArticleById(id: string | undefined): HelpArticle | undefined {
  if (!id) return undefined
  return HELP_ARTICLES.find((article) => article.id === id)
}

export function articlesByModule(module: HelpModule): HelpArticle[] {
  return HELP_ARTICLES.filter((article) => article.module === module)
}
