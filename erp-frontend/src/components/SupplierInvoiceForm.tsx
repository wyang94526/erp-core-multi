/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Create or edit a supplier invoice (vendor bill) from goods receipts or as a Non-PO voucher.
 * Routes: /supplier-invoices/new?source_type=&source_order_id=&receipt_id=&category=non-po
 *         /supplier-invoices/:invoiceId/edit
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  apBillService,
  chartOfAccountsService,
  goodsReceiptService,
  paymentTermsService,
  purchaseOrderService,
  subcontractOrderService,
  vendorInvoiceService,
  vendorService,
} from '../api/services'
import type { GoodsReceipt, GoodsReceiptLine } from '../types'
import { addDaysIso, findPaymentTerm, paymentTermLabel } from '../utils/paymentTerms'
import { formatReceiptMoney, formatReceiptQty } from '../utils/goodsReceipts'
import AccountLookup from './AccountLookup'
import GoodsReceiptLookup from './GoodsReceiptLookup'

type InvoiceCategory = 'PO' | 'NON_PO'
type NonPoType = 'EXPENSE' | 'LANDED_COST'

function normalizeCategoryParam(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/_/g, '-')
}

function isLockedNonPoCategory(value: string | null | undefined): boolean {
  const raw = normalizeCategoryParam(value)
  return raw === 'non-po' || raw === 'nonpo'
}

function invoiceCategoryFromSearch(categoryParam: string | null | undefined): InvoiceCategory {
  if (isLockedNonPoCategory(categoryParam)) return 'NON_PO'
  return 'PO'
}

type DistRow = {
  key: string
  gl_account_id: string
  department_id: string
  amount: string
  description: string
  source_order_id: string
  goods_receipt_id: string
  goods_receipt_number: string
}

function SupplierInvoiceNumberField({
  value,
  loading,
  hint,
}: {
  value: string
  loading?: boolean
  hint?: string
}) {
  return (
    <label style={{ ...labelStyle, marginTop: 16 }}>
      Supplier Invoice Number
      <input
        value={loading && !value ? 'Assigning…' : value}
        readOnly
        disabled
        style={{ ...inputStyle, ...disabledInputStyle }}
        title="Assigned automatically as UX13-YYMMXXXX from the invoice date"
      />
      {hint ? <span style={fieldHintStyle}>{hint}</span> : null}
    </label>
  )
}

function newDistRow(): DistRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gl_account_id: '',
    department_id: '',
    amount: '',
    description: '',
    source_order_id: '',
    goods_receipt_id: '',
    goods_receipt_number: '',
  }
}

function receiptLineUnbilled(line: GoodsReceiptLine): number {
  const explicit = Number(line.quantity_unbilled)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const received = Number(line.quantity_received || 0)
  const invoiced = Number(line.quantity_invoiced || 0)
  return Math.max(0, received - invoiced)
}

function receiptUnitCost(receipt: GoodsReceipt, line?: GoodsReceiptLine): number {
  if (line) {
    return Number(line.receipt_unit_cost ?? line.unit_cost ?? 0)
  }
  return Number(receipt.receipt_unit_cost ?? 0)
}

function receiptReceivedQty(receipt: GoodsReceipt): number {
  const header = Number(receipt.quantity_received)
  if (Number.isFinite(header) && header > 0) return header
  return (receipt.lines || []).reduce((sum, line) => sum + Number(line.quantity_received || 0), 0)
}

function formatReceiptDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

export function SupplierInvoiceForm() {
  const [searchParams] = useSearchParams()
  const { invoiceId: rawEditId } = useParams<{ invoiceId: string }>()
  const editBillId = rawEditId ? decodeURIComponent(rawEditId).trim() : ''
  const isEdit = Boolean(editBillId)
  const initialSourceType = (searchParams.get('source_type') || 'PURCHASE_ORDER') as
    | 'PURCHASE_ORDER'
    | 'SUBCONTRACT_ORDER'
  const initialSourceOrderId = searchParams.get('source_order_id') || ''
  const initialReceiptKeys = useMemo(() => {
    const fromList = (searchParams.get('receipt_ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const single = (searchParams.get('receipt_id') || '').trim()
    return [...new Set(single ? [single, ...fromList] : fromList)]
  }, [searchParams])
  const categoryParam = searchParams.get('category')
  const lockedNonPo = isLockedNonPoCategory(categoryParam) || isEdit
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const skipVendorTermSync = useRef(isEdit)

  const [category, setCategory] = useState<InvoiceCategory>(() =>
    invoiceCategoryFromSearch(categoryParam),
  )
  const [sourceType, setSourceType] = useState<'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER'>(
    initialSourceType === 'SUBCONTRACT_ORDER' ? 'SUBCONTRACT_ORDER' : 'PURCHASE_ORDER',
  )
  const [sourceOrderId, setSourceOrderId] = useState(initialSourceOrderId)
  const [selectedReceipts, setSelectedReceipts] = useState<GoodsReceipt[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [receiptSearch, setReceiptSearch] = useState('')
  const [qtyByLineId, setQtyByLineId] = useState<Record<number, string>>({})
  const [referencePoNumber, setReferencePoNumber] = useState('')
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

  const editQuery = useQuery({
    queryKey: ['supplierInvoiceEdit', editBillId],
    queryFn: async () => {
      const bill = await apBillService.getBillDetail(editBillId)
      if (!bill.supplier_invoice_id) {
        throw new Error('This bill has no supplier invoice to edit.')
      }
      const invoice = await vendorInvoiceService.get(bill.supplier_invoice_id)
      const status = (invoice.status || '').toUpperCase()
      if (status === 'APPROVED' || status === 'PAID' || status === 'CANCELLED') {
        throw new Error('Approved, paid, or cancelled invoices cannot be edited.')
      }
      return { bill, invoice }
    },
    enabled: isEdit,
  })

  useEffect(() => {
    if (!isEdit) setCategory(invoiceCategoryFromSearch(categoryParam))
  }, [categoryParam, isEdit])

  useEffect(() => {
    const invoice = editQuery.data?.invoice
    if (!invoice) return
    const kind = (invoice.invoice_type || '').toUpperCase()
    setCategory(kind === 'EXPENSE' || kind === 'LANDED_COST' ? 'NON_PO' : 'PO')
    if (kind === 'LANDED_COST' || kind === 'EXPENSE') {
      setNonPoType(kind)
    }
    setVendorId(invoice.vendor_id || '')
    setVendorInvoiceNumber(invoice.vendor_invoice_number || '')
    setInvoiceDate((invoice.invoice_date || '').slice(0, 10))
    setDueDate((invoice.due_date || '').slice(0, 10))
    setDueDateDirty(true)
    setPaymentTermId(invoice.payment_term_id || '')
    setCurrency(invoice.currency || 'USD')
    setTaxAmount(invoice.tax_amount != null ? String(invoice.tax_amount) : '')
    setFreightAmount(invoice.freight_amount != null ? String(invoice.freight_amount) : '')
    setReferencePoNumber(invoice.reference_po_number || '')
    setSubmitMode('draft')
    const fallbackPo = invoice.reference_po_number || invoice.source_order_id || ''
    const rows = (invoice.distributions || []).map((row) => ({
      key: `dist-${row.id}`,
      gl_account_id: row.gl_account_id,
      department_id: row.department_id || '',
      amount: String(row.amount ?? ''),
      description: row.description || '',
      source_order_id: row.source_order_id || (row.goods_receipt_id ? fallbackPo : ''),
      goods_receipt_id: row.goods_receipt_id != null ? String(row.goods_receipt_id) : '',
      goods_receipt_number: row.goods_receipt_number || '',
    }))
    setDistributions(rows.length ? rows : [newDistRow()])
    skipVendorTermSync.current = false
  }, [editQuery.data])

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

  const receiptsQuery = useQuery({
    queryKey: [
      'postedGoodsReceipts',
      'invoice-form',
      sourceType,
      initialSourceOrderId,
      receiptSearch,
    ],
    queryFn: () =>
      goodsReceiptService.list({
        status: 'POSTED',
        source_type: sourceType,
        source_order_id: initialSourceOrderId || undefined,
        q: receiptSearch || undefined,
        unbilled_only: true,
        limit: 200,
      }),
    enabled: !isNonPo,
  })

  useEffect(() => {
    if (isNonPo || selectedReceipts.length) return
    const rows = receiptsQuery.data || []
    if (initialReceiptKeys.length) {
      const matches = rows.filter(
        (row) =>
          initialReceiptKeys.includes(String(row.id)) ||
          initialReceiptKeys.includes(row.receipt_number),
      )
      if (matches.length) {
        setSelectedReceipts(matches)
        return
      }
      void Promise.all(
        initialReceiptKeys.map((key) => goodsReceiptService.get(key).catch(() => null)),
      ).then((loaded) => {
        const found = loaded.filter((row): row is GoodsReceipt => Boolean(row))
        if (found.length) setSelectedReceipts(found)
      })
      return
    }
    if (initialSourceOrderId && rows.length) {
      setSelectedReceipts(rows.filter((row) => receiptReceivedQty(row) > 0))
    }
  }, [
    initialReceiptKeys,
    initialSourceOrderId,
    isNonPo,
    receiptsQuery.data,
    selectedReceipts.length,
  ])

  useEffect(() => {
    setQtyByLineId((current) => {
      const next = { ...current }
      for (const receipt of selectedReceipts) {
        for (const line of receipt.lines || []) {
          if (next[line.id] == null) {
            next[line.id] = String(receiptLineUnbilled(line))
          }
        }
      }
      return next
    })
    if (selectedReceipts.length === 1) {
      setSourceType(
        selectedReceipts[0].source_type === 'SUBCONTRACT_ORDER'
          ? 'SUBCONTRACT_ORDER'
          : 'PURCHASE_ORDER',
      )
      setSourceOrderId(selectedReceipts[0].source_order_id || '')
    } else if (selectedReceipts.length > 1) {
      const orders = new Set(selectedReceipts.map((row) => row.source_order_id).filter(Boolean))
      if (orders.size === 1) {
        setSourceOrderId(selectedReceipts[0].source_order_id || '')
      }
    }
  }, [selectedReceipts])

  const vendorsQuery = useQuery({
    queryKey: ['vendors', 'invoice-form'],
    queryFn: () => vendorService.listVendors(0, 500),
  })

  const paymentTermsQuery = useQuery({
    queryKey: ['paymentTerms'],
    queryFn: () => paymentTermsService.list(),
  })

  const referencePoQuery = useQuery({
    queryKey: ['purchaseOrders', 'reference-lookup', 'APPROVED'],
    queryFn: () =>
      purchaseOrderService.listPurchaseOrders(0, 200, { approval_status: 'APPROVED' }),
    enabled: isNonPo,
  })
  const approvedReferencePos = useMemo(
    () =>
      (referencePoQuery.data || []).filter(
        (po) => (po.approval_status || '').toUpperCase() === 'APPROVED',
      ),
    [referencePoQuery.data],
  )

  const accountsQuery = useQuery({
    queryKey: ['chartOfAccounts', 'invoice-form'],
    queryFn: () => chartOfAccountsService.listAccounts(0, 2000),
    enabled: isNonPo,
  })

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'invoice-form'],
    queryFn: () => vendorInvoiceService.listDepartments(),
    enabled: isNonPo,
  })

  const nextNumberQuery = useQuery({
    queryKey: ['supplierInvoiceNextNumber', invoiceDate],
    queryFn: () => vendorInvoiceService.nextNumber(invoiceDate),
    enabled: !isEdit,
  })
  const supplierInvoiceNumber = isEdit
    ? editQuery.data?.invoice.invoice_number || editBillId
    : nextNumberQuery.data?.invoice_number || ''

  const backPath = isEdit
    ? `/supplier-invoices/${encodeURIComponent(editBillId)}`
    : isNonPo
      ? '/supplier-invoices'
      : sourceType === 'SUBCONTRACT_ORDER' && sourceOrderId
        ? `/subcontract-orders/${sourceOrderId}`
        : sourceOrderId
          ? `/purchase-orders/${sourceOrderId}`
          : '/supplier-invoices'

  const paymentTerms = paymentTermsQuery.data || []
  const vendors = vendorsQuery.data || []

  useEffect(() => {
    if (skipVendorTermSync.current) return
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
      if (!selectedReceipts.length) {
        throw new Error('Select at least one goods receipt')
      }
      const vendors = new Set(selectedReceipts.map((row) => row.vendor_id))
      if (vendors.size > 1) {
        throw new Error('Selected goods receipts must share the same vendor')
      }
      const types = new Set(selectedReceipts.map((row) => (row.source_type || '').toUpperCase()))
      if (types.size > 1) {
        throw new Error('Selected goods receipts must be the same source type')
      }
      const resolvedType =
        selectedReceipts[0].source_type === 'SUBCONTRACT_ORDER'
          ? 'SUBCONTRACT_ORDER'
          : 'PURCHASE_ORDER'
      const lines = selectedReceipts.flatMap((receipt) =>
        (receipt.lines || [])
          .map((line) => {
            const qty = Number(qtyByLineId[line.id] ?? receiptLineUnbilled(line))
            if (!(qty > 0)) return null
            const unit = receiptUnitCost(receipt, line)
            return {
              goods_receipt_line_id: line.id,
              item_id: line.item_id,
              description: line.description || line.item_id,
              quantity_billed: qty,
              unit_price:
                resolvedType === 'SUBCONTRACT_ORDER' && unitPriceOverride
                  ? Number(unitPriceOverride)
                  : unit,
            }
          })
          .filter((line): line is NonNullable<typeof line> => Boolean(line)),
      )
      if (!lines.length) {
        throw new Error('Enter a billed quantity on at least one receipt line')
      }

      const created = await vendorInvoiceService.create({
        invoice_type: 'PO_MATCHED',
        source_type: resolvedType,
        source_order_id: sourceOrderId || selectedReceipts[0].source_order_id,
        receipt_ids: selectedReceipts.map((row) => row.id),
        vendor_invoice_number: null,
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
          return {
            gl_account_id: row.gl_account_id,
            department_id: row.department_id || null,
            amount: Number(row.amount),
            description: row.description || null,
            goods_receipt_id: receiptId,
          }
        })
      if (!vendorId) {
        throw new Error('Select a vendor')
      }
      if (rows.length === 0) {
        throw new Error('Add at least one GL distribution with a positive amount')
      }
      const allocatedReceiptIds = [
        ...new Set(rows.map((row) => row.goods_receipt_id).filter((id): id is number => Number.isFinite(id))),
      ]
      const payload = {
        invoice_type: nonPoType,
        source_type: 'NON_PO' as const,
        reference_po_number: referencePoNumber.trim() || null,
        vendor_id: vendorId,
        vendor_invoice_number: isEdit ? vendorInvoiceNumber || null : null,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        payment_term_id: paymentTermId || null,
        tax_amount: taxAmount ? Number(taxAmount) : 0,
        freight_amount: freightAmount ? Number(freightAmount) : 0,
        allocate_to_goods_receipt_id: allocatedReceiptIds.length === 1 ? allocatedReceiptIds[0] : null,
        currency,
        distributions: rows,
      }
      const saved = isEdit
        ? await vendorInvoiceService.update(editQuery.data!.invoice.id, payload)
        : await vendorInvoiceService.create({
            ...payload,
            source_order_id: null,
          })
      if (submitMode === 'submit') {
        return vendorInvoiceService.submit(saved.id)
      }
      return saved
    },
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['goodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['postedGoodsReceipts'] }),
      ])
      const nextPath =
        submitMode === 'draft'
          ? `/supplier-invoices/${encodeURIComponent(created.invoice_number)}/edit`
          : `/supplier-invoices/${encodeURIComponent(created.invoice_number)}`
      navigate(nextPath, { replace: isEdit })
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
            {isEdit
              ? `Edit ${editQuery.data?.invoice.invoice_number || editBillId}`
              : isNonPo
                ? 'Create Non-PO Invoice'
                : 'Create Supplier Invoice'}
          </h2>
          <p style={pageSubStyle}>
            {isEdit
              ? 'Draft, returned, and pending Non-PO invoices can be corrected, then saved or submitted again.'
              : isNonPo
                ? 'Freight, duty, rent, utilities, and other vouchers that are not 3-way matched to a PO'
                : selectedReceipts.length
                  ? `${selectedReceipts.length} goods receipt${selectedReceipts.length === 1 ? '' : 's'} selected${
                      sourceOrderId ? ` · ${orderLabel} ${sourceOrderId}` : ''
                    }${vendorFromOrder ? ` · ${vendorFromOrder}` : ''}`
                  : 'Match a vendor invoice to posted goods receipts'}
          </p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(backPath)}>
          {isEdit ? 'Back to Bill' : isNonPo || !sourceOrderId ? 'Back to Invoices' : 'Back to Order'}
        </button>
      </header>

      {isEdit && editQuery.isLoading ? (
        <div style={cardStyle}>Loading invoice…</div>
      ) : editQuery.isError ? (
        <div style={{ ...cardStyle, color: '#c62828' }}>
          {editQuery.error instanceof Error ? editQuery.error.message : 'Failed to load invoice'}
        </div>
      ) : isEdit && editQuery.data && (editQuery.data.invoice.invoice_type || '').toUpperCase() === 'PO_MATCHED' ? (
        <div style={{ ...cardStyle, color: '#c62828' }}>
          PO-matched bills cannot be edited after they are created. Create a new bill if the match is wrong.
        </div>
      ) : null}

      <div style={cardStyle}>
        <label style={labelStyle}>
          Invoice category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as InvoiceCategory)}
            disabled={lockedNonPo}
            style={{
              ...inputStyle,
              ...(lockedNonPo ? disabledInputStyle : null),
            }}
            title={
              lockedNonPo
                ? 'This page was opened as a Non-PO invoice. Category cannot be changed.'
                : undefined
            }
          >
            <option value="PO">PO-Based</option>
            <option value="NON_PO">Non-PO</option>
          </select>
        </label>

        {!isNonPo ? (
          <>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Source type
              <select
                value={sourceType}
                onChange={(e) =>
                  setSourceType(e.target.value as 'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER')
                }
                disabled={Boolean(initialSourceOrderId)}
                style={{
                  ...inputStyle,
                  ...(initialSourceOrderId ? disabledInputStyle : null),
                }}
              >
                <option value="PURCHASE_ORDER">Purchase Order</option>
                <option value="SUBCONTRACT_ORDER">Subcontract Order</option>
              </select>
            </label>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <span style={labelStyle}>Goods receipts</span>
                <button type="button" style={secondaryButtonStyle} onClick={() => setPickerOpen(true)}>
                  Select Goods Receipt
                </button>
              </div>
              {selectedReceipts.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 10 }}>
                  Select posted purchase or subcontract receipts. The bill uses received quantity and
                  receipt unit cost, not the original ordered quantity.
                </p>
              ) : (
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table style={receiptTableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Receipt ID</th>
                        <th style={thStyle}>Posting Date</th>
                        <th style={thStyle}>Source Document</th>
                        <th style={thStyle}>Received Qty</th>
                        <th style={thStyle}>Receipt Unit Cost</th>
                        <th style={thStyle} />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReceipts.map((receipt) => (
                        <tr key={receipt.id}>
                          <td style={tdStyle}>{receipt.receipt_number}</td>
                          <td style={tdStyle}>{formatReceiptDate(receipt.receipt_date)}</td>
                          <td style={tdStyle}>{receipt.source_order_id}</td>
                          <td style={tdStyle}>{formatReceiptQty(receiptReceivedQty(receipt))}</td>
                          <td style={tdStyle}>{formatReceiptMoney(receiptUnitCost(receipt))}</td>
                          <td style={tdStyle}>
                            <button
                              type="button"
                              style={linkButtonStyle}
                              onClick={() =>
                                setSelectedReceipts((rows) => rows.filter((row) => row.id !== receipt.id))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedReceipts.flatMap((receipt) => receipt.lines || []).length ? (
                    <table style={{ ...receiptTableStyle, marginTop: 12 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Receipt</th>
                          <th style={thStyle}>Item</th>
                          <th style={thStyle}>Unbilled Qty</th>
                          <th style={thStyle}>Qty to bill</th>
                          <th style={thStyle}>Unit cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedReceipts.flatMap((receipt) =>
                          (receipt.lines || []).map((line) => (
                            <tr key={line.id}>
                              <td style={tdStyle}>{receipt.receipt_number}</td>
                              <td style={tdStyle}>{line.description || line.item_id}</td>
                              <td style={tdStyle}>{formatReceiptQty(receiptLineUnbilled(line))}</td>
                              <td style={tdStyle}>
                                <input
                                  type="number"
                                  min={0}
                                  max={receiptLineUnbilled(line)}
                                  step="0.0001"
                                  value={qtyByLineId[line.id] ?? String(receiptLineUnbilled(line))}
                                  onChange={(e) =>
                                    setQtyByLineId((current) => ({
                                      ...current,
                                      [line.id]: e.target.value,
                                    }))
                                  }
                                  style={{ ...inputStyle, marginTop: 0 }}
                                />
                              </td>
                              <td style={tdStyle}>{formatReceiptMoney(receiptUnitCost(receipt, line))}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              )}
            </div>
          </>
        ) : null}

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

            <SupplierInvoiceNumberField
              value={supplierInvoiceNumber}
              loading={!isEdit && nextNumberQuery.isLoading}
              hint={
                isEdit
                  ? undefined
                  : 'Assigned on save with prefix UX13- from the invoice date.'
              }
            />

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
                Reference PO (For Tracking)
                <input
                  list="non-po-reference-po-options"
                  value={referencePoNumber}
                  onChange={(e) => setReferencePoNumber(e.target.value.trim())}
                  style={inputStyle}
                  placeholder="Optional — PU62-…"
                />
                <datalist id="non-po-reference-po-options">
                  {approvedReferencePos.map((po) => (
                    <option key={po.po_number} value={po.po_number}>
                      {po.supplier_name || po.supplier_id} · Approved
                    </option>
                  ))}
                </datalist>
                <span style={{ fontSize: 12, color: 'var(--muted, #666)', fontWeight: 400, display: 'block', marginTop: 6 }}>
                  Optional. Only approved purchase orders can be linked for tracking. This does not 3-way match or pull PO lines.
                </span>
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
                ? 'Map each charge to a GL account. Search the purchase order first, then pick the goods receipt to allocate freight/duty onto inventory. The freight vendor can be different from the goods PO vendor.'
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
                  <AccountLookup
                    accounts={accountsQuery.data || []}
                    value={row.gl_account_id}
                    placeholder="Search code or description, e.g. Freight"
                    ariaLabel={`GL account for line ${index + 1}`}
                    onSelect={(account) =>
                      updateDist(row.key, { gl_account_id: account?.id || '' })
                    }
                  />
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
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>Allocate to purchase order / receipt</div>
                    <GoodsReceiptLookup
                      poNumber={row.source_order_id}
                      receiptId={row.goods_receipt_id}
                      receiptNumber={row.goods_receipt_number}
                      onChange={({ poNumber, receipt }) => {
                        updateDist(row.key, {
                          source_order_id: poNumber,
                          goods_receipt_id: receipt ? String(receipt.id) : '',
                          goods_receipt_number: receipt?.receipt_number || '',
                        })
                        if (poNumber) setReferencePoNumber(poNumber)
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--muted, #666)', marginTop: 6, display: 'block' }}>
                      Search the goods PO, then choose its receipt. Do not look up the freight vendor’s own receipts.
                    </span>
                  </div>
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
        ) : !selectedReceipts.length ? (
          <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 16 }}>
            Select one or more posted goods receipts to 3-way match. For freight, rent, or other
            vouchers without a receipt, switch to Non-PO.
          </p>
        ) : loading ? (
          <div>Loading order…</div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>
              Lines default to unbilled received quantities at receipt unit cost. Approval posts Debit
              GRNI / Credit Accounts Payable on each receipt&apos;s posting date.
            </p>

            <SupplierInvoiceNumberField
              value={supplierInvoiceNumber}
              loading={!isEdit && nextNumberQuery.isLoading}
              hint={
                isEdit
                  ? undefined
                  : 'Assigned on save with prefix UX13- from the invoice date.'
              }
            />

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
            {mutation.error instanceof Error ? mutation.error.message : isEdit ? 'Save failed' : 'Create failed'}
          </p>
        ) : null}

        {isNonPo || selectedReceipts.length ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={mutation.isPending || (isEdit && (editQuery.isLoading || editQuery.isError))}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? 'Saving…'
                : isNonPo
                  ? submitMode === 'submit'
                    ? isEdit
                      ? 'Save & Submit'
                      : 'Create & Submit'
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

      {pickerOpen ? (
        <div style={modalOverlayStyle} onClick={() => setPickerOpen(false)}>
          <div style={modalCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Select Goods Receipt</h3>
              <button type="button" style={linkButtonStyle} onClick={() => setPickerOpen(false)}>
                Close
              </button>
            </div>
            <input
              value={receiptSearch}
              onChange={(e) => setReceiptSearch(e.target.value)}
              style={{ ...inputStyle, marginTop: 12 }}
              placeholder="Search receipt number or source document…"
            />
            <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 360 }}>
              <table style={receiptTableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle} />
                    <th style={thStyle}>Receipt ID</th>
                    <th style={thStyle}>Posting Date</th>
                    <th style={thStyle}>Source Document</th>
                    <th style={thStyle}>Received Qty</th>
                    <th style={thStyle}>Receipt Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(receiptsQuery.data || []).map((receipt) => {
                    const checked = selectedReceipts.some((row) => row.id === receipt.id)
                    return (
                      <tr key={receipt.id}>
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedReceipts((rows) =>
                                checked
                                  ? rows.filter((row) => row.id !== receipt.id)
                                  : [...rows, receipt],
                              )
                            }}
                          />
                        </td>
                        <td style={tdStyle}>{receipt.receipt_number}</td>
                        <td style={tdStyle}>{formatReceiptDate(receipt.receipt_date)}</td>
                        <td style={tdStyle}>{receipt.source_order_id}</td>
                        <td style={tdStyle}>{formatReceiptQty(receiptReceivedQty(receipt))}</td>
                        <td style={tdStyle}>{formatReceiptMoney(receiptUnitCost(receipt))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {receiptsQuery.isLoading ? (
                <p style={{ fontSize: 13, color: 'var(--text)' }}>Loading receipts…</p>
              ) : (receiptsQuery.data || []).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text)' }}>No unbilled posted receipts found.</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" style={primaryButtonStyle} onClick={() => setPickerOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
const disabledInputStyle: React.CSSProperties = {
  opacity: 0.7,
  cursor: 'not-allowed',
  backgroundColor: 'var(--bg-muted, #f5f5f5)',
}
const fieldHintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  fontSize: 12,
  fontWeight: 400,
  color: 'var(--text)',
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
const receiptTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-h)',
  whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text)',
}
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
  padding: 16,
}
const modalCardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 20,
  width: 'min(860px, 100%)',
  boxShadow: 'var(--shadow)',
}

export default SupplierInvoiceForm
