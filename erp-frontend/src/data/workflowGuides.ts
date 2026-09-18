/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Interactive process-workflow content for /help/workflows.
 * Edit steps, nav labels, and deep links here without changing the page layout.
 */

export type WorkflowId = 'o2c' | 'sco' | 'p2p' | 'close'

export type WorkflowStepLink = {
  label: string
  to: string
}

export type WorkflowStep = {
  id: string
  title: string
  navPath: string
  body: string
  links: WorkflowStepLink[]
}

export type WorkflowGuide = {
  id: WorkflowId
  title: string
  badge: string
  summary: string
  steps: WorkflowStep[]
}

export const WORKFLOW_GUIDES: WorkflowGuide[] = [
  {
    id: 'o2c',
    title: 'Order to Cash Lifecycle',
    badge: 'Sales & Fulfillment',
    summary:
      'Take a customer order from entry through available-to-promise, shipment, invoicing, and cash application.',
    steps: [
      {
        id: 'o2c-entry',
        title: 'Order Entry & Validation',
        navPath: 'Sales & Procurement ▸ Sales Orders',
        body: 'Select the customer, verify credit terms, add line items, and confirm requested ship dates before submit. Bill-To and Ship-To load from the customer master.',
        links: [
          { label: 'Go to Sales Orders', to: '/sales-orders' },
          { label: 'New Sales Order', to: '/orders/new' },
        ],
      },
      {
        id: 'o2c-atp',
        title: 'Inventory Commitment & ATP Check',
        navPath: 'Inventory ▸ Stock On-Hand & ATP',
        body: 'Confirm available-to-promise (on-hand minus allocated). Allocate stock on the order, or trigger a purchase / subcontract order / backorder when ATP is short on a subcontract assembly.',
        links: [
          { label: 'Check ATP', to: '/inventory' },
          { label: 'Open Items', to: '/items' },
          { label: 'New Subcontract Order', to: '/subcontract-orders/new' },
        ],
      },
      {
        id: 'o2c-fulfill',
        title: 'Fulfillment & Shipping',
        navPath: 'Sales & Procurement ▸ Item Fulfillments',
        body: 'From an approved order, generate the pick list and packing slip, confirm dispatch, and record tracking. Fulfillment is a separate step from invoicing.',
        links: [
          { label: 'Go to Fulfillments', to: '/fulfillments' },
        ],
      },
      {
        id: 'o2c-invoice',
        title: 'Customer Invoicing',
        navPath: 'Finance & Accounting ▸ Accounts Receivable',
        body: 'Generate the sales invoice matched to fulfilled quantities. Use Sales Invoices for posting and AR Aging & Collections for open balances.',
        links: [
          { label: 'Sales Invoices', to: '/sales-invoices' },
          { label: 'AR Aging', to: '/accounts-receivable' },
        ],
      },
      {
        id: 'o2c-cash',
        title: 'Payment Receipt & Cash Reconciliation',
        navPath: 'Finance & Accounting ▸ Cash & Treasury Management',
        body: 'Record customer remittance against open AR invoices and apply cash to the bank ledger so AR, cash, and the general ledger stay in sync.',
        links: [
          { label: 'Cash Management', to: '/cash-management' },
          { label: 'Bank Accounts', to: '/bank-accounts' },
          { label: 'General Ledger', to: '/general-ledger' },
        ],
      },
    ],
  },
  {
    id: 'sco',
    title: 'Subcontract to Pay & Sales Fulfillment',
    badge: 'Manufacturing & Outside Processing',
    summary:
      'When a customer sales order needs a subcontract assembly, create the SCO, issue the kit, receive finished goods, pay the processor, then fulfill and invoice the original SO.',
    steps: [
      {
        id: 'sco-demand',
        title: 'Customer Demand & ATP Shortfall',
        navPath: 'Sales & Procurement ▸ Sales Orders  ·  Inventory ▸ Stock On-Hand & ATP',
        body: 'Start from the customer sales order. If the line is a subcontract assembly and ATP cannot cover the ship date, keep the SO open and plan an outside-processing order for the shortage (do not fulfill until finished goods are received).',
        links: [
          { label: 'Go to Sales Orders', to: '/sales-orders' },
          { label: 'Check ATP', to: '/inventory' },
        ],
      },
      {
        id: 'sco-create',
        title: 'Create the Subcontract Order',
        navPath: 'Manufacturing ▸ Subcontract Orders',
        body: 'Choose the subcontractor (vendor type subcontractor or both) and the assembly item. Pin the active BOM version and quantity so the component kit matches what the processor needs.',
        links: [
          { label: 'Go to Subcontract Orders', to: '/subcontract-orders' },
          { label: 'New Subcontract Order', to: '/subcontract-orders/new' },
          { label: 'Item / BOM', to: '/items' },
        ],
      },
      {
        id: 'sco-issue',
        title: 'Issue the Component Kit',
        navPath: 'Manufacturing ▸ Subcontract Orders (detail)',
        body: 'On the SCO detail page, issue materials to the vendor when the kit is picked. Status moves to materials issued. Use the SCO PDF as the pack-out list sent with the kit.',
        links: [
          { label: 'Open Subcontract Orders', to: '/subcontract-orders' },
        ],
      },
      {
        id: 'sco-receive',
        title: 'Receive Finished Goods',
        navPath: 'Manufacturing ▸ Subcontract Orders (detail)',
        body: 'When the assembly returns, record the finished-goods receipt (Receipt ID + quantity). Stock on-hand / ATP for the assembly increases and GRNI is posted for the value received. Confirm the Receipt on Stock Movements.',
        links: [
          { label: 'Open Subcontract Orders', to: '/subcontract-orders' },
          { label: 'Stock Movements', to: '/inventory/movements' },
          { label: 'Check ATP', to: '/inventory' },
        ],
      },
      {
        id: 'sco-pay',
        title: 'Processor Bill & Payment (SCO to Pay)',
        navPath: 'Finance & Accounting ▸ Accounts Payable',
        body: 'Create the supplier invoice against the SCO / unbilled finished-goods receipt (not the customer SO). Match quantity and price, then disburse by Check, ACH, or Wire — including SWIFT/IBAN when the processor is overseas.',
        links: [
          { label: 'New Supplier Invoice', to: '/supplier-invoices/new' },
          { label: 'Supplier Invoices', to: '/supplier-invoices' },
          { label: 'AP Aging & Payments', to: '/accounts-payable' },
          { label: 'Vendor Master', to: '/vendors' },
        ],
      },
      {
        id: 'sco-fulfill-so',
        title: 'Fulfill & Invoice the Customer Sales Order',
        navPath: 'Sales & Procurement ▸ Item Fulfillments  ·  Finance ▸ Sales Invoices',
        body: 'With finished goods on-hand, return to the original sales order: pick, pack, and ship. Then generate the customer invoice for fulfilled quantities and collect cash on the Order-to-Cash path.',
        links: [
          { label: 'Go to Sales Orders', to: '/sales-orders' },
          { label: 'Go to Fulfillments', to: '/fulfillments' },
          { label: 'Sales Invoices', to: '/sales-invoices' },
        ],
      },
    ],
  },
  {
    id: 'p2p',
    title: 'Procure to Pay Lifecycle',
    badge: 'Procurement & AP',
    summary:
      'Buy material or services, receive against the PO, three-way match the vendor bill, and disburse (including overseas wire).',
    steps: [
      {
        id: 'p2p-po',
        title: 'Purchase Requisition & PO Creation',
        navPath: 'Sales & Procurement ▸ Purchase Orders',
        body: 'Select the vendor and confirm domestic vs overseas attributes: Incoterms, named place, currency, tax ID / W-8, and SWIFT/IBAN when paying by wire.',
        links: [
          { label: 'Go to Purchase Orders', to: '/purchase-orders' },
          { label: 'New Purchase Order', to: '/purchase-orders/new' },
          { label: 'Vendor Master', to: '/vendors' },
        ],
      },
      {
        id: 'p2p-approve',
        title: 'PO Approval & Dispatch',
        navPath: 'Sales & Procurement ▸ Purchase Orders',
        body: 'Submit the PO through the purchasing approval workflow (amount bands). After approval, transmit / PDF the order to the supplier.',
        links: [
          { label: 'Open Purchase Orders', to: '/purchase-orders' },
        ],
      },
      {
        id: 'p2p-receipt',
        title: 'Goods Receipt & Quality Inspection',
        navPath: 'Inventory ▸ Stock Movements',
        body: 'Receive against the approved PO (Receive Goods) so GRNI posts. Inspect quality, then confirm the receipt appears as a Receipt movement in the target warehouse / bin.',
        links: [
          { label: 'Go to Stock Movements', to: '/inventory/movements' },
          { label: 'Warehouses & Bins', to: '/inventory/warehouses' },
        ],
      },
      {
        id: 'p2p-match',
        title: 'Vendor Bill & 3-Way Matching',
        navPath: 'Finance & Accounting ▸ Accounts Payable',
        body: 'Create the supplier invoice from unbilled receipts so the bill matches PO quantity/price and the goods receipt (GRNI). Approval posts Debit GRNI / Credit AP.',
        links: [
          { label: 'Supplier Invoices', to: '/supplier-invoices' },
          { label: 'AP Aging', to: '/accounts-payable' },
        ],
      },
      {
        id: 'p2p-pay',
        title: 'Payment Execution',
        navPath: 'Finance & Accounting ▸ Cash & Treasury Management',
        body: 'Process disbursement by Check, ACH, or Wire. Overseas wires require beneficiary bank, SWIFT/BIC, and IBAN from the vendor remittance card.',
        links: [
          { label: 'AP Aging & Payments', to: '/accounts-payable' },
          { label: 'Cash Management', to: '/cash-management' },
          { label: 'Bank Accounts', to: '/bank-accounts' },
        ],
      },
    ],
  },
  {
    id: 'close',
    title: 'Financial Reporting & Period Close',
    badge: 'Finance & General Ledger',
    summary:
      'Reconcile sub-ledgers, post adjusting entries, and produce the trial balance and financial statements.',
    steps: [
      {
        id: 'close-recon',
        title: 'Sub-ledger Reconciliation',
        navPath: 'Finance & Accounting ▸ AR / AP / Inventory',
        body: 'Reconcile Accounts Receivable, Accounts Payable, and Inventory against open invoices, physical stock, and bank activity before you close the period.',
        links: [
          { label: 'AR Aging', to: '/accounts-receivable' },
          { label: 'AP Aging', to: '/accounts-payable' },
          { label: 'Stock On-Hand', to: '/inventory' },
          { label: 'Cash Management', to: '/cash-management' },
          { label: 'Bank Accounts', to: '/bank-accounts' },
        ],
      },
      {
        id: 'close-journals',
        title: 'Post Adjusting Journal Entries',
        navPath: 'Finance & Accounting ▸ General Ledger',
        body: 'Record accruals, prepaids, depreciation, and foreign-exchange gain/loss. Confirm account mapping on the Chart of Accounts before posting.',
        links: [
          { label: 'General Ledger', to: '/general-ledger' },
          { label: 'Chart of Accounts', to: '/chart-of-accounts' },
        ],
      },
      {
        id: 'close-statements',
        title: 'Financial Statement Generation',
        navPath: 'Finance & Accounting ▸ General Ledger',
        body: 'Review the trial balance, then generate the Income Statement (P&L), Balance Sheet, and Cash Flow statement from posted GL activity.',
        links: [
          { label: 'Financial Reports', to: '/financial-reports' },
          { label: 'General Ledger', to: '/general-ledger' },
          { label: 'Dashboard KPIs', to: '/' },
        ],
      },
    ],
  },
]

export const WORKFLOW_STORAGE_KEY = 'gtt-workflow-step-checks'

/** Short node labels for the high-level swimlane diagram (same visual language for every flow). */
export const WORKFLOW_FLOW_LANES: Array<{
  id: WorkflowId
  label: string
  nodes: string[]
}> = [
  {
    id: 'o2c',
    label: 'Order to Cash',
    nodes: ['Order Entry', 'ATP Check', 'Fulfillment', 'Customer Invoice', 'Cash Receipt'],
  },
  {
    id: 'sco',
    label: 'Subcontract',
    nodes: ['Customer SO', 'Create SCO', 'Issue Kit', 'Receive FG', 'Pay Processor', 'Fulfill SO'],
  },
  {
    id: 'p2p',
    label: 'Procure to Pay',
    nodes: ['Purchase Order', 'Approval', 'Goods Receipt', '3-Way Match', 'Vendor Payment'],
  },
  {
    id: 'close',
    label: 'Period Close',
    nodes: ['Reconcile Sub-ledgers', 'Adjusting Entries', 'Financial Statements'],
  },
]
