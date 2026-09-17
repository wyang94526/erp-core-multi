/**
 * Create a supplier invoice (vendor bill) from a PO/SCO or as a Non-PO voucher.
 * Routes: /supplier-invoices/new?source_type=&source_order_id=&category=non-po
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  chartOfAccountsService,
  paymentTermsService,
  purchaseOrderService,
  subcontractOrderService,
  vendorInvoiceService,
  vendorService,
} from '../api/services'
import { addDaysIso, findPaymentTerm, paymentTermLabel } from '../utils/paymentTerms'

type InvoiceCategory = 'PO' | 'NON_PO'
type NonPoType = 'EXPENSE' | 'LANDED_COST'

type DistRow = {
  key: string
  gl_account_id: string
  department_id: string
  amount: string
  description: string
  goods_receipt_id: string
}

function newDistRow(): DistRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gl_account_id: '',
    department_id: '',
    amount: '',
    description: '',
    goods_receipt_id: '',
  }
}

export function SupplierInvoiceForm() {
  const [searchParams] = useSearchParams()
  const initialSourceType = (searchParams.get('source_type') || 'PURCHASE_ORDER') as
    | 'PURCHASE_ORDER'
    | 'SUBCONTRACT_ORDER'
  const initialSourceOrderId = searchParams.get('source_order_id') || ''
  const categoryParam = (searchParams.get('category') || '').toLowerCase()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [category, setCategory] = useState<InvoiceCategory>(
    initialSourceOrderId && categoryParam !== 'non-po' ? 'PO' : 'NON_PO',
  )
  const [sourceType, setSourceType] = useState<'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER'>(
    initialSourceType === 'SUBCONTRACT_ORDER' ? 'SUBCONTRACT_ORDER' : 'PURCHASE_ORDER',
  )
  const [sourceOrderId, setSourceOrderId] = useState(initialSourceOrderId)
  const [nonPoType, setNonPoType] = useState<NonPoType>('EXPENSE')
  const [vendorId, setVendorId] = useState('')
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [dueDateDirty, setDueDateDirty] = useState(false)
  const [paymentTermId, setPaymentTermId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [taxAmount, setTaxAmount] = useState('')
  const [freightAmount, setFreightAmount] = useState('')
  const [approveAfter, setApproveAfter] = useState(true)
  const [unitPriceOverride, setUnitPriceOverride] = useState('')
  const [distributions, setDistributions] = useState<DistRow[]>([newDistRow()])
  const [submitMode, setSubmitMode] = useState<'draft' | 'submit'>('submit')

  const isNonPo = category === 'NON_PO'

  const poQuery = useQuery({
    queryKey: ['purchaseOrders', sourceOrderId],
    queryFn: () => purchaseOrderService.getPurchaseOrder(sourceOrderId),
    enabled: !isNonPo && sourceType === 'PURCHASE_ORDER' && Boolean(sourceOrderId),
  })

  const scoQuery = useQuery({
    queryKey: ['subcontractOrders', sourceOrderId],
    queryFn: () => subcontractOrderService.getSubcontractOrder(sourceOrderId),
    enabled: !isNonPo && sourceType === 'SUBCONTRACT_ORDER' && Boolean(sourceOrderId),
  })

  const vendorsQuery = useQuery({
    queryKey: ['vendors', 'invoice-form'],
    queryFn: () => vendorService.listVendors(0, 500),
  })

  const paymentTermsQuery = useQuery({
    queryKey: ['paymentTerms'],
    queryFn: () => paymentTermsService.list(),
  })

  const accountsQuery = useQuery({
    queryKey: ['chartOfAccounts', 'invoice-form'],
    queryFn: () => chartOfAccountsService.listAccounts(0, 500),
    enabled: isNonPo,
  })

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'invoice-form'],
    queryFn: () => vendorInvoiceService.listDepartments(),
    enabled: isNonPo,
  })

  const receiptsQuery = useQuery({
    queryKey: ['postedGoodsReceipts', vendorId],
    queryFn: () =>
      vendorInvoiceService.listGoodsReceipts({
        vendor_id: vendorId || undefined,
        limit: 100,
      }),
    enabled: isNonPo && nonPoType === 'LANDED_COST',
  })

  const backPath = isNonPo
    ? '/supplier-invoices'
    : sourceType === 'SUBCONTRACT_ORDER' && sourceOrderId
      ? `/subcontract-orders/${sourceOrderId}`
      : sourceOrderId
        ? `/purchase-orders/${sourceOrderId}`
        : '/supplier-invoices'

  const paymentTerms = paymentTermsQuery.data || []
  const vendors = vendorsQuery.data || []

  useEffect(() => {
    if (isNonPo) {
      const vendor = vendors.find((row) => row.supplier_id === vendorId)
      const matched = findPaymentTerm(paymentTerms, vendor?.payment_term_id, vendor?.payment_terms)
      setPaymentTermId(matched?.id || vendor?.payment_term_id || '')
      setDueDateDirty(false)
      return
    }
    const po = poQuery.data
    if (po) {
      const matched = findPaymentTerm(paymentTerms, po.payment_term_id, po.payment_terms)
      setPaymentTermId(matched?.id || po.payment_term_id || '')
      setDueDateDirty(false)
      return
    }
    const vendorIdFromOrder =
      sourceType === 'SUBCONTRACT_ORDER' ? scoQuery.data?.supplier_id : undefined
    if (vendorIdFromOrder) {
      const vendor = vendors.find((row) => row.supplier_id === vendorIdFromOrder)
      const matched = findPaymentTerm(paymentTerms, vendor?.payment_term_id, vendor?.payment_terms)
      setPaymentTermId(matched?.id || vendor?.payment_term_id || '')
      setDueDateDirty(false)
    }
  }, [
    isNonPo,
    vendorId,
    vendors,
    paymentTerms,
    poQuery.data,
    scoQuery.data,
    sourceType,
  ])

  useEffect(() => {
    if (dueDateDirty || !invoiceDate) return
    const term = findPaymentTerm(paymentTerms, paymentTermId)
    if (!term) return
    setDueDate(addDaysIso(invoiceDate, term.due_days))
  }, [dueDateDirty, invoiceDate, paymentTermId, paymentTerms])

  const distSubtotal = useMemo(
    () =>
      distributions.reduce((sum, row) => {
        const amount = Number(row.amount)
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
      }, 0),
    [distributions],
  )
  const computedTotal =
    distSubtotal + (Number(taxAmount) || 0) + (Number(freightAmount) || 0)

  const poMutation = useMutation({
    mutationFn: async () => {
      const lines =
        sourceType === 'SUBCONTRACT_ORDER' && unitPriceOverride
          ? [
              {
                item_id: scoQuery.data?.item_id,
                quantity_billed: Number(
                  (scoQuery.data?.finished_goods_receipts || []).reduce(
                    (s, r) => s + r.quantity_received,
                    0,
                  ),
                ),
                unit_price: Number(unitPriceOverride),
              },
            ]
          : null

      const created = await vendorInvoiceService.create({
        invoice_type: 'PO_MATCHED',
        source_type: sourceType,
        source_order_id: sourceOrderId,
        vendor_invoice_number: vendorInvoiceNumber || null,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        payment_term_id: paymentTermId || null,
        freight_amount:
          poQuery.data && (poQuery.data.freight_terms || 'PREPAID_ON_PO') !== 'PREPAID_ON_PO'
            ? 0
            : poQuery.data?.shipping_fee ?? null,
        tax_amount: poQuery.data?.total_tax ?? null,
        lines,
      })
      if (approveAfter) {
        return vendorInvoiceService.approve(created.id)
      }
      return created
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
      navigate('/supplier-invoices')
    },
  })

  const nonPoMutation = useMutation({
    mutationFn: async () => {
      const rows = distributions
        .filter((row) => row.gl_account_id && Number(row.amount) > 0)
        .map((row) => {
          const receiptId = row.goods_receipt_id ? Number(row.goods_receipt_id) : null
          const receipt = (receiptsQuery.data || []).find((r) => r.id === receiptId)
          return {
            gl_account_id: row.gl_account_id,
            department_id: row.department_id || null,
            amount: Number(row.amount),
            description: row.description || null,
            goods_receipt_id: receiptId,
            goods_receipt_line_id: receipt?.lines?.[0]?.id ?? null,
          }
        })
      if (!vendorId) {
        throw new Error('Select a vendor')
      }
      if (rows.length === 0) {
        throw new Error('Add at least one GL distribution with a positive amount')
      }
      const created = await vendorInvoiceService.create({
        invoice_type: nonPoType,
        source_type: 'NON_PO',
        source_order_id: sourceOrderId || null,
        vendor_id: vendorId,
        vendor_invoice_number: vendorInvoiceNumber || null,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        payment_term_id: paymentTermId || null,
        tax_amount: taxAmount ? Number(taxAmount) : 0,
        freight_amount: freightAmount ? Number(freightAmount) : 0,
        currency,
        distributions: rows,
      })
      if (submitMode === 'submit') {
        return vendorInvoiceService.submit(created.id)
      }
      return created
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
      navigate(`/supplier-invoices/${encodeURIComponent(created.invoice_number)}`)
    },
  })

  const mutation = isNonPo ? nonPoMutation : poMutation
  const loading = poQuery.isLoading || scoQuery.isLoading
  const orderLabel = sourceType === 'SUBCONTRACT_ORDER' ? 'Subcontract Order' : 'Purchase Order'
  const vendorFromOrder =
    sourceType === 'SUBCONTRACT_ORDER' ? scoQuery.data?.supplier_id : poQuery.data?.supplier_id

  const updateDist = (key: string, patch: Partial<DistRow>) => {
    setDistributions((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>
            {isNonPo ? 'Create Non-PO Invoice' : 'Create Supplier Invoice'}
          </h2>
          <p style={pageSubStyle}>
            {isNonPo
              ? 'Freight, duty, rent, utilities, and other vouchers that are not 3-way matched to a PO'
              : sourceOrderId
                ? `${orderLabel} ${sourceOrderId} · ${vendorFromOrder || '…'}`
                : 'Match a vendor invoice to a purchase or subcontract order'}
          </p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(backPath)}>
          {isNonPo || !sourceOrderId ? 'Back to Invoices' : 'Back to Order'}
        </button>
      </header>

      <div style={cardStyle}>
        <label style={labelStyle}>
          Invoice category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as InvoiceCategory)}
            style={inputStyle}
          >
            <option value="PO">PO-Based</option>
            <option value="NON_PO">Non-PO</option>
          </select>
        </label>

        {isNonPo ? (
          <>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Invoice type
              <select
                value={nonPoType}
                onChange={(e) => setNonPoType(e.target.value as NonPoType)}
                style={inputStyle}
              >
                <option value="EXPENSE">General / Expense (rent, utilities, salaries)</option>
                <option value="LANDED_COST">Landed / Additional cost (freight, customs duty)</option>
              </select>
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Vendor
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select vendor…</option>
                {(vendorsQuery.data || []).map((vendor) => (
                  <option key={vendor.supplier_id} value={vendor.supplier_id}>
                    {vendor.company_name || vendor.supplier_id} ({vendor.supplier_id})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Vendor invoice number
              <input
                value={vendorInvoiceNumber}
                onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                style={inputStyle}
                placeholder="Supplier's invoice #"
              />
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Payment terms
              <select
                value={paymentTermId}
                onChange={(e) => {
                  setPaymentTermId(e.target.value)
                  setDueDateDirty(false)
                }}
                style={inputStyle}
              >
                <option value="">Select payment terms</option>
                {paymentTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {paymentTermLabel(term)}
                  </option>
                ))}
              </select>
            </label>

            <div style={twoColStyle}>
              <label style={labelStyle}>
                Invoice date
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Due date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDateDirty(true)
                    setDueDate(e.target.value)
                  }}
                  style={inputStyle}
                />
              </label>
            </div>

            <div style={twoColStyle}>
              <label style={labelStyle}>
                Currency
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                  style={inputStyle}
                  maxLength={3}
                />
              </label>
              <label style={labelStyle}>
                Related PO / SCO (optional)
                <input
                  value={sourceOrderId}
                  onChange={(e) => setSourceOrderId(e.target.value)}
                  style={inputStyle}
                  placeholder="Optional reference"
                />
              </label>
            </div>

            <div style={twoColStyle}>
              <label style={labelStyle}>
                Tax amount
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Freight amount
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={freightAmount}
                  onChange={(e) => setFreightAmount(e.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>

            <h3 style={sectionTitleStyle}>
              {nonPoType === 'LANDED_COST' ? 'Freight / duty allocation' : 'GL distribution'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 0 }}>
              {nonPoType === 'LANDED_COST'
                ? 'Map each charge to a GL account. Optionally allocate to a posted goods receipt so approval capitalizes inventory.'
                : 'Distribute the expense across GL accounts and optional departments / cost centers.'}
            </p>

            {distributions.map((row, index) => (
              <div key={row.key} style={distRowStyle}>
                <div style={distHeaderStyle}>
                  <strong>Line {index + 1}</strong>
                  {distributions.length > 1 ? (
                    <button
                      type="button"
                      style={linkButtonStyle}
                      onClick={() =>
                        setDistributions((rows) => rows.filter((item) => item.key !== row.key))
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <label style={labelStyle}>
                  GL account
                  <select
                    value={row.gl_account_id}
                    onChange={(e) => updateDist(row.key, { gl_account_id: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">Select account…</option>
                    {(accountsQuery.data || []).map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.account_code} · {account.account_name}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={twoColStyle}>
                  <label style={labelStyle}>
                    Department / cost center
                    <select
                      value={row.department_id}
                      onChange={(e) => updateDist(row.key, { department_id: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">None</option>
                      {(departmentsQuery.data || []).map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Amount
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.amount}
                      onChange={(e) => updateDist(row.key, { amount: e.target.value })}
                      style={inputStyle}
                    />
                  </label>
                </div>
                <label style={labelStyle}>
                  Description
                  <input
                    value={row.description}
                    onChange={(e) => updateDist(row.key, { description: e.target.value })}
                    style={inputStyle}
                    placeholder="Rent, freight inbound, customs duty…"
                  />
                </label>
                {nonPoType === 'LANDED_COST' ? (
                  <label style={labelStyle}>
                    Allocate to goods receipt (optional)
                    <select
                      value={row.goods_receipt_id}
                      onChange={(e) => updateDist(row.key, { goods_receipt_id: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">Expense to GL (no inventory capitalization)</option>
                      {(receiptsQuery.data || []).map((receipt) => (
                        <option key={receipt.id} value={String(receipt.id)}>
                          {receipt.receipt_number} · {receipt.source_order_id} · {receipt.receipt_date}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              style={{ ...secondaryButtonStyle, marginTop: 8 }}
              onClick={() => setDistributions((rows) => [...rows, newDistRow()])}
            >
              Add distribution line
            </button>

            <p style={{ fontSize: 14, fontWeight: 700, marginTop: 16, color: 'var(--text-h)' }}>
              Total amount:{' '}
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(
                computedTotal,
              )}
            </p>

            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="nonPoSaveMode"
                  checked={submitMode === 'draft'}
                  onChange={() => setSubmitMode('draft')}
                />
                Save as draft
              </label>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="nonPoSaveMode"
                  checked={submitMode === 'submit'}
                  onChange={() => setSubmitMode('submit')}
                />
                Submit for approval
              </label>
            </div>
          </>
        ) : !sourceOrderId ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>
              Enter the purchase or subcontract order to 3-way match. For freight, rent, or other
              vouchers without a PO, switch to Non-PO.
            </p>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Source type
              <select
                value={sourceType}
                onChange={(e) =>
                  setSourceType(e.target.value as 'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER')
                }
                style={inputStyle}
              >
                <option value="PURCHASE_ORDER">Purchase Order</option>
                <option value="SUBCONTRACT_ORDER">Subcontract Order</option>
              </select>
            </label>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              {orderLabel} number
              <input
                value={sourceOrderId}
                onChange={(e) => setSourceOrderId(e.target.value.trim())}
                style={inputStyle}
                placeholder={sourceType === 'SUBCONTRACT_ORDER' ? 'SCO-…' : 'PU62-…'}
              />
            </label>
          </>
        ) : loading ? (
          <div>Loading order…</div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>
              Lines default to unbilled received quantities at order prices. Approval posts Debit GRNI /
              Credit Accounts Payable (with PPV for price variances).
            </p>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Vendor invoice number
              <input
                value={vendorInvoiceNumber}
                onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                style={inputStyle}
                placeholder="Supplier's invoice #"
              />
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Invoice date
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Payment terms
              <select
                value={paymentTermId}
                onChange={(e) => {
                  setPaymentTermId(e.target.value)
                  setDueDateDirty(false)
                }}
                style={inputStyle}
              >
                <option value="">Select payment terms</option>
                {paymentTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {paymentTermLabel(term)}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDateDirty(true)
                  setDueDate(e.target.value)
                }}
                style={inputStyle}
              />
            </label>

            {sourceType === 'SUBCONTRACT_ORDER' ? (
              <label style={{ ...labelStyle, marginTop: 16 }}>
                Unit price override (required if SCO unit_price is 0)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPriceOverride}
                  onChange={(e) => setUnitPriceOverride(e.target.value)}
                  style={inputStyle}
                  placeholder={String(scoQuery.data?.unit_price ?? 0)}
                />
              </label>
            ) : null}

            <label style={{ ...labelStyle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={approveAfter}
                onChange={(e) => setApproveAfter(e.target.checked)}
              />
              Approve immediately (post GRNI → AP)
            </label>
          </>
        )}

        {mutation.isError ? (
          <p style={{ color: '#c62828', marginTop: 12 }}>
            {mutation.error instanceof Error ? mutation.error.message : 'Create failed'}
          </p>
        ) : null}

        {isNonPo || sourceOrderId ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? 'Saving…'
                : isNonPo
                  ? submitMode === 'submit'
                    ? 'Create & Submit'
                    : 'Save Draft'
                  : approveAfter
                    ? 'Create & Approve Bill'
                    : 'Create Draft Bill'}
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => navigate(backPath)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 800,
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: React.CSSProperties = {
  marginBottom: 20,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 16,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
}
const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: React.CSSProperties = { margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  boxShadow: 'var(--shadow)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  color: 'var(--text-h)',
  display: 'block',
}
const inputStyle: React.CSSProperties = {
  marginTop: 6,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
}
const twoColStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginTop: 16,
}
const sectionTitleStyle: React.CSSProperties = {
  margin: '24px 0 8px',
  fontSize: 16,
  color: 'var(--text-h)',
}
const distRowStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
  marginTop: 12,
  display: 'grid',
  gap: 12,
}
const distHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}
const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#c62828',
  cursor: 'pointer',
  fontWeight: 700,
  fontFamily: 'inherit',
}
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}
const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

export default SupplierInvoiceForm
