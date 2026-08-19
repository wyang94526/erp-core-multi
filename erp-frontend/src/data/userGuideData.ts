/**
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
  { id: 'master-data', label: 'Master Data', blurb: 'Customers, vendors, tax IDs, and banking' },
  { id: 'finance', label: 'Finance & Accounting', blurb: 'Invoices, AP, AR, cash, and the general ledger' },
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
      'Use the search box to filter topics, steps, and FAQs instantly.',
      'Browse by module in the left column, then expand Step-by-step, Tips, FAQs, and Common Issues.',
      'On any operational screen, click Help in the top bar (next to AI Assistant) or press Ctrl/⌘ + / to open a drawer of articles tagged for that route.',
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
      'The AI Assistant (top right) can look up orders and inventory using the page you are on as context.',
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
    ],
    troubleshooting: [
      {
        issue: 'A KPI click lands on a page I cannot access',
        fix: 'Your role can see the metric but may lack the list permission. Ask an admin to grant the matching view permission (for example po:view or ar_invoice:view).',
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
      'Click Create (or use Dashboard → Quick Actions → New Sales Order). The form lives at /orders/new.',
      'Select the customer. Bill-To and Ship-To locations load from the customer master; pick the correct sites.',
      'Add item lines (SKU, quantity, price). Confirm UOM and requested dates / delivery schedules.',
      'Save as Draft, then Submit for approval if your workflow requires it.',
      'After approval, open the order and use Fulfill to ship, then Invoice to create a customer sales invoice.',
    ],
    callouts: [
      { kind: 'required', text: 'Customer, at least one ship-to, and at least one order line are required before submit.' },
      { kind: 'important', text: 'Fulfillment and invoicing are separate steps. Shipping does not automatically create the AR invoice.' },
    ],
    tips: [
      'You can print / PDF an order from the detail page for customer confirmation.',
      'Attach supporting documents (POs from the customer, drawings) on the order attachments panel when available.',
    ],
    faqs: [
      {
        question: 'Can I edit an order after approval?',
        answer:
          'Header and line changes may be locked depending on status. If the order is already fulfilling or invoiced, create a change with your manager rather than overwriting shipped quantities.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Customer has no ship-to locations',
        fix: 'Open Master Data → Customers, edit the customer, and add at least one Ship-To (and Bill-To) location before creating the SO.',
      },
      {
        issue: 'Item does not appear when adding a line',
        fix: 'Confirm the SKU exists under Inventory → Items and is active. Subcontract assemblies are managed as items too.',
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
      'Go to Sales & Procurement → Purchase Orders → New.',
      'Select the vendor. Currency, payment terms, and incoterms default from the vendor master when set.',
      'Add item lines (item, quantity, unit price). Save Draft anytime.',
      'Submit for approval. Approvers follow the purchasing workflow (amount bands).',
      'When the PO is Approved, open it and click Receive Goods to post a receipt (GRNI).',
      'Create a Supplier Invoice / Bill against received quantities under Finance → Supplier Invoices.',
    ],
    callouts: [
      { kind: 'required', text: 'Vendor and at least one line item are required to submit (empty lines are allowed only on Draft).' },
      { kind: 'important', text: 'Receiving posts GRNI. Do not invoice the vendor until goods (or a partial receipt) are recorded.' },
    ],
    tips: [
      'Use PDF print for vendor confirmation.',
      'For overseas vendors, confirm Incoterms, named place, and wire details on the vendor master before sending the PO.',
    ],
    faqs: [
      {
        question: 'Where do I see billing status?',
        answer:
          'On the approved PO, billing status appears near the Receive Goods action. Unbilled receipts feed the supplier invoice form.',
      },
    ],
    troubleshooting: [
      {
        issue: 'Submit for approval fails',
        fix: 'Add at least one line, confirm you have po:create / submit permission, and that an approval workflow exists for purchase orders.',
      },
      {
        issue: 'Receive Goods is disabled',
        fix: 'The PO must be Approved (approval_status APPROVED). Draft or pending POs cannot receive.',
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
      'Subcontract orders (SCOs) send an assembly to an outside processor. The order pins a BOM version, issues the component kit, and receives finished goods.',
    screenshots: [
      { src: '/guide-screenshots/sco-form.jpg', caption: 'New subcontract order header' },
      { src: '/guide-screenshots/sco-detail.jpg', caption: 'SCO detail with issue / receive actions' },
    ],
    steps: [
      'Go to Manufacturing → Subcontract Orders → New.',
      'Choose the subcontractor (vendor type subcontractor or both) and the assembly item.',
      'Select the BOM version when prompted (active version is the default). Quantity and dates drive the kit.',
      'Save the SCO. Open the detail page to review required components.',
      'Issue materials to the vendor when the kit is picked.',
      'When finished goods return, record a receipt (Receipt ID + quantity). GRNI is posted for the value received.',
      'Create a supplier invoice against the SCO / receipt from Finance when the processor bills you.',
    ],
    callouts: [
      { kind: 'required', text: 'Assembly item must be flagged as a subcontract assembly (or outside processed) with a BOM.' },
      { kind: 'important', text: 'Status moves with materials issued and goods received. Do not invoice before a finished-goods receipt if you match to GRNI.' },
    ],
    tips: [
      'Use the SCO PDF for the pack-out list sent with the kit.',
      'If BOM lines change, create/activate a new BOM version on the item before opening a new SCO.',
    ],
    faqs: [
      {
        question: 'How do I track status?',
        answer:
          'The SCO list and detail header show status (planned, materials issued, partially received, completed, cancelled). Receipts and material issues are on the same detail page.',
      },
    ],
    troubleshooting: [
      {
        issue: 'No BOM / components on the new SCO',
        fix: 'Open Inventory → Items → the assembly → BOM. Confirm an active version with components, then recreate the SCO.',
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
      'From Items you can create or edit SKUs and maintain vendor mappings.',
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
      'To receive a purchase: open the Approved PO → Receive Goods. That posts GRNI and a Receipt movement.',
      'To inspect history: Inventory → Stock Movements. Filter Type = Receipt, Issue, Adjustment, or Transfer.',
      'Use the product/SKU filter or dashboard “pending receiving” KPI to jump here with Receipt already selected.',
      'Maintain physical structure under Inventory → Warehouses & Bins (warehouse codes and bin locations used by issues and transfers).',
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
        fix: 'Confirm Receive Goods succeeded on the PO, then clear extra filters on Stock Movements (type, SKU, dashboard metric).',
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
      'Open Finance → AR Aging & Collections to see unpaid invoices, overdue buckets, and collections follow-up.',
      'Dashboard finance KPIs (outstanding AR, overdue invoices) deep-link here with filters applied.',
    ],
    callouts: [
      { kind: 'important', text: 'Invoicing is typically after fulfillment so quantities match what shipped.' },
      { kind: 'tip', text: 'Use the sales invoice list to jump to AR aging for a customer.' },
    ],
    faqs: [
      {
        question: 'What is the difference between Sales Invoices and AR Aging?',
        answer:
          'Sales Invoices is the operational invoice register (create/view). AR Aging is collections: open balances by age.',
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
      '/chart-of-accounts',
      '/general-ledger',
    ],
    summary:
      'Supplier invoices / bills match vendor invoices to received PO or SCO quantities. AP Aging & Payments shows what you owe.',
    screenshots: [
      { src: '/guide-screenshots/supplier-invoice-form.jpg', caption: 'New supplier invoice defaulting unbilled receipts' },
      { src: '/guide-screenshots/ap-aging.jpg', caption: 'AP aging' },
    ],
    steps: [
      'Receive goods on the PO or SCO first (GRNI).',
      'Go to Finance → Supplier Invoices / Bills → New.',
      'Select the vendor / source document. Lines default to unbilled received quantities at order prices.',
      'Submit for approval. Posting typically debits GRNI and credits AP.',
      'Use Finance → AP Aging & Payments for due dates, aging, and payment batches.',
      'Cash & Treasury → Cash Management for bank-side movement; Chart of Accounts and General Ledger for setup and posted activity.',
    ],
    callouts: [
      { kind: 'required', text: 'Match bills to receipts. Billing a PO with no receipt breaks GRNI clearing.' },
      { kind: 'tip', text: 'Overseas wire details come from the vendor master — verify SWIFT/IBAN before releasing payment.' },
    ],
    faqs: [
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
      'Company profile in the UI is the top-bar title “Grand-Tek Technology USA”. Legal/tax identity for vendors/customers lives on those masters, not in a separate profile screen.',
      'CSV Import Preview (Administration) dry-runs TIPTOP customer/vendor/item/BOM files before load.',
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
    routeMatch: ['/admin'],
    summary:
      'The workspace is branded as Grand-Tek Technology USA in the top bar. Legal identity, tax IDs, and banking live on customer and vendor masters rather than a separate company-profile form.',
    screenshots: [
      { src: '/guide-screenshots/topbar.jpg', caption: 'Top bar company title and user menu' },
    ],
    steps: [
      'Confirm the company name in the application header (Grand-Tek Technology USA). This is the workspace identity users see on every screen.',
      'Open your user menu (top right) to see your name, assigned roles, and Change password.',
      'Administrators maintain users, roles, permissions, and approval workflows under Administration → Users & Roles.',
      'Customer Tax ID types (EIN, TIN, VAT, SSN) and vendor W-8 / W-9 / SWIFT details are maintained on those master records, not a global profile page.',
      'Use Administration → CSV Import Preview when loading TIPTOP master files.',
    ],
    callouts: [
      { kind: 'important', text: 'There is no separate Company Profile editor. Change legal/tax data on the customer or vendor that owns it.' },
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
        fix: 'Only ROLE-ADMIN with admin:manage can open Users & Roles and CSV Import. Other roles use Help and their operational modules.',
      },
    ],
  },
  {
    id: 'admin-import',
    module: 'admin',
    title: 'CSV Import Preview',
    routeMatch: ['/admin/data-import'],
    summary:
      'Dry-run TIPTOP CSV mapping for customers, suppliers, items, and BOM before loading into the database.',
    screenshots: [
      { src: '/guide-screenshots/admin-import.jpg', caption: 'Data import preview tabs' },
    ],
    steps: [
      'Open Administration → CSV Import Preview.',
      'Choose the Customers, Suppliers, Items, or BOM tab.',
      'Review mapped columns (including customer tax_id_type and vendor is_overseas when present).',
      'Fix source-file issues called out in warnings, then run the loader from the approved operations process.',
    ],
    callouts: [
      { kind: 'important', text: 'This screen is a preview. It does not replace the backend load script / job used to commit rows.' },
    ],
    troubleshooting: [
      {
        issue: 'Vendor shows as domestic after import',
        fix: 'Country was blank or US-like in the file. Edit the vendor and set Country / Overseas, or correct the address in the source CSV.',
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
