/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SubcontractOrderDetail Component
 * Displays full details of a subcontract order (SCO): header info, required components,
 * material issue history, and finished goods receipt history. Also provides inline
 * forms to record new "Issue Materials" and "Receive Goods" transactions.
 */

import { useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, FileDown, Loader2, Mail, Pencil, Receipt, RotateCcw } from 'lucide-react'
import { itemService, purchaseOrderService, subcontractOrderService, vendorService } from '../api/services'
import { generateMaterialIssueShippingPdf } from '../utils/generateMaterialIssuePdf'
import { generateSubcontractVendorPdf } from '../utils/generateSubcontractPdf'
import { loadCompanyPdfBranding } from '../utils/pdfLetterhead'
import { defaultCostSheet } from '../utils/scoCostSheet'
import { goodsReceiptHref, receiptLinkStyle } from '../utils/goodsReceipts'
import { scoCanIssueMaterials, scoIssueBlockedReason } from '../utils/scoIssue'
import { SCO_KIT_MUST_BE_ISSUED_MESSAGE, scoHasUnissuedKitComponents } from '../utils/scoKitIssue'
import {
  scoCanReceiveFinishedGoods,
  scoCanShowCloseRemaining,
  scoCloseRemainingBlockedReason,
  scoReceiveBlockedReason,
} from '../utils/scoReceive'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  disabledActionStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'
import { useAuth } from '../context/AuthContext'

const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0)
import { ApprovalPanel } from './ApprovalPanel'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel'
import { DocumentRevisionPanel } from './DocumentRevisionPanel'
import ScoCostSheet from './ScoCostSheet'
import type { CalculatedComponentLine, MaterialIssue, SubcontractCharge, SubcontractOrder } from '../types'

export function SubcontractOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { hasPermission } = useAuth()
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [showReceiveForm, setShowReceiveForm] = useState(false)
  const [showAmendModal, setShowAmendModal] = useState(false)

  const [issueForm, setIssueForm] = useState({
    issue_id: '',
    issue_date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [issueLines, setIssueLines] = useState<Record<string, string>>({})

  const [receiveForm, setReceiveForm] = useState({
    receipt_id: '',
    sco_line_id: '',
    quantity_received: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: '',
    unit_cost: '',
  })

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportingIssueId, setExportingIssueId] = useState<string | null>(null)
  const [issueDocError, setIssueDocError] = useState<string | null>(null)
  const kitLinesRef = useRef<CalculatedComponentLine[]>([])
  const printIssueShippingDocRef = useRef<
    ((order: SubcontractOrder, issue: MaterialIssue) => Promise<void>) | null
  >(null)
  const [editingCostSheet, setEditingCostSheet] = useState(false)
  const [draftCharges, setDraftCharges] = useState<Record<number, SubcontractCharge[]>>({})

  if (!id) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error: No SCO number provided</p>
        </div>
      </div>
    )
  }

  const {
    data: sco,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['subcontractOrders', id],
    queryFn: () => subcontractOrderService.getSubcontractOrder(id),
  })

  const { data: kitBreakdown } = useQuery({
    queryKey: ['subcontractOrders', id, 'calculate-components'],
    queryFn: () => subcontractOrderService.calculateComponents(id),
    enabled: !!id && !!sco,
  })

  const { data: linkedPurchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders', 'bySco', id],
    queryFn: () => purchaseOrderService.listPurchaseOrders(0, 50, { sco_number: id }),
    enabled: !!id,
  })

  const { data: vendor } = useQuery({
    queryKey: ['vendors', sco?.supplier_id],
    queryFn: () => vendorService.getVendor(sco!.supplier_id),
    enabled: Boolean(sco?.supplier_id),
  })

  const issueMutation = useMutation({
    mutationFn: (data: {
      issue_id?: string
      issue_date?: string
      notes?: string
      lines: Array<{ component_item_id: string; quantity_issued: number; sco_line_id?: number }>
    }) => subcontractOrderService.issueMaterials(id, data),
    onSuccess: (updated) => {
      const known = new Set((sco?.material_issues || []).map((row) => row.issue_id))
      const created = updated.material_issues?.find((row) => !known.has(row.issue_id))
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      queryClient.invalidateQueries({
        queryKey: ['subcontractOrders', id, 'calculate-components'],
      })
      setShowIssueForm(false)
      setIssueForm({ issue_id: '', issue_date: new Date().toISOString().split('T')[0], notes: '' })
      setIssueLines({})
      if (created) {
        void printIssueShippingDocRef.current?.(updated, created)
      }
    },
    onError: (err: any) => {
      setFormErrors({ issue: err.message || 'Failed to issue materials' })
    },
  })

  const receiveMutation = useMutation({
    mutationFn: (data: {
      receipt_id?: string
      quantity_received: number
      receipt_date?: string
      notes?: string
      unit_cost?: number
      sco_line_id?: number
    }) => subcontractOrderService.receiveGoods(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      setShowReceiveForm(false)
      setReceiveForm({
        receipt_id: '',
        sco_line_id: '',
        quantity_received: '',
        receipt_date: new Date().toISOString().split('T')[0],
        notes: '',
        unit_cost: '',
      })
    },
    onError: (err: any) => {
      setFormErrors({ receive: err.message || 'Failed to receive goods' })
    },
  })

  const closeRemainingMutation = useMutation({
    mutationFn: () => subcontractOrderService.closeRemaining(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
    },
    onError: (err: Error) => {
      setFormErrors({ receive: err.message || 'Failed to cancel remaining quantity' })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => subcontractOrderService.cancelSubcontractOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
    },
  })

  const amendMutation = useMutation({
    mutationFn: (comments: string) => subcontractOrderService.amendSubcontractOrder(id, comments),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      queryClient.invalidateQueries({ queryKey: ['subcontract-orders', id, 'revisions'] })
      queryClient.invalidateQueries({ queryKey: ['subcontract-orders', id, 'change-logs'] })
      setShowAmendModal(false)
      const lines =
        updated.lines && updated.lines.length > 0
          ? updated.lines
          : [
              {
                sco_line_id: 0,
                charges: [] as SubcontractCharge[],
              },
            ]
      const next: Record<number, SubcontractCharge[]> = {}
      for (const line of lines) {
        next[line.sco_line_id] = line.charges?.length
          ? line.charges.map((row) => ({ ...row }))
          : defaultCostSheet()
      }
      setDraftCharges(next)
      setEditingCostSheet(true)
      setFormErrors((prev) => {
        const copy = { ...prev }
        delete copy.amend
        delete copy.costSheet
        return copy
      })
    },
    onError: (err: Error) => {
      setFormErrors((prev) => ({
        ...prev,
        amend: err.message || 'Failed to amend subcontract order',
      }))
    },
  })

  const costSheetMutation = useMutation({
    mutationFn: (lines: Array<{ sco_line_id: number; charges: SubcontractCharge[] }>) =>
      subcontractOrderService.updateSubcontractOrder(id, {
        lines: lines.map((line) => ({
          sco_line_id: line.sco_line_id,
          charges: line.charges.map((charge) => ({
            line_no: charge.line_no,
            name: charge.name,
            detail_explanation: charge.detail_explanation,
            labor_minutes: charge.labor_minutes,
            sf_rate: charge.sf_rate,
            cost_per_unit: charge.cost_per_unit,
            margin_percent: charge.margin_percent,
            is_margin: charge.is_margin,
          })),
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      setEditingCostSheet(false)
      setFormErrors((prev) => {
        const next = { ...prev }
        delete next.costSheet
        return next
      })
    },
    onError: (err: Error) => {
      setFormErrors((prev) => ({
        ...prev,
        costSheet: err.message || 'Failed to save cost sheet',
      }))
    },
  })

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading subcontract order details...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading subcontract order:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button onClick={() => navigate('/subcontract-orders')} style={secondaryButtonStyle}>
            Back to Subcontract Orders
          </button>
        </div>
      </div>
    )
  }

  if (!sco) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p>Subcontract order not found</p>
          <button onClick={() => navigate('/subcontract-orders')} style={secondaryButtonStyle}>
            Back to Subcontract Orders
          </button>
        </div>
      </div>
    )
  }

  const statusColors = getStatusColors(sco.status)
  const isCancellable = sco.status !== 'COMPLETED' && sco.status !== 'CANCELLED'
  const isApproved = (sco.approval_status || 'DRAFT').toUpperCase() === 'APPROVED'
  const approvalStatus = (sco.approval_status || 'DRAFT').toUpperCase()
  const amendmentNumber = Number(sco.amendment_number || 0)
  const isAmending =
    amendmentNumber > 0 &&
    (approvalStatus === 'DRAFT' || approvalStatus === 'REJECTED' || approvalStatus === 'PENDING_APPROVAL') &&
    isCancellable
  const canEditCostSheet =
    (approvalStatus === 'DRAFT' || approvalStatus === 'REJECTED') &&
    sco.status !== 'COMPLETED' &&
    sco.status !== 'CANCELLED'
  const canAmend =
    isApproved &&
    isCancellable &&
    hasPermission('subcontract:submit')
  const canOperateKit = scoCanIssueMaterials(sco)
  const issueBlockedReason = scoIssueBlockedReason(sco)
  const canReceiveFinishedGoods = scoCanReceiveFinishedGoods(sco)
  const receiveBlockedReason = scoReceiveBlockedReason(sco)

  const assemblyLines =
    sco.lines && sco.lines.length > 0
      ? sco.lines
      : [
          {
            sco_line_id: 0,
            sco_number: sco.sco_number,
            line_number: 1,
            so_item_id: null,
            so_line_number: null,
            item_id: sco.item_id,
            bom_header_id: sco.bom_header_id ?? null,
            quantity_ordered: sco.quantity_ordered,
            unit_price: Number(sco.unit_price || 0),
            line_total: Number(sco.unit_price || 0) * Number(sco.quantity_ordered || 0),
            charges: [],
            components: [],
          },
        ]

  const enterCostSheetEdit = () => {
    const next: Record<number, SubcontractCharge[]> = {}
    for (const line of assemblyLines) {
      next[line.sco_line_id] = line.charges?.length
        ? line.charges.map((row) => ({ ...row }))
        : defaultCostSheet()
    }
    setDraftCharges(next)
    setEditingCostSheet(true)
    setFormErrors((prev) => {
      const copy = { ...prev }
      delete copy.costSheet
      return copy
    })
  }

  const saveCostSheet = () => {
    const lines = assemblyLines.map((line) => ({
      sco_line_id: line.sco_line_id,
      charges: draftCharges[line.sco_line_id] || line.charges || [],
    }))
    costSheetMutation.mutate(lines)
  }

  const kitLines: CalculatedComponentLine[] =
    kitBreakdown?.components?.length
      ? kitBreakdown.components
      : (sco.components || []).map((c) => ({
          component_item_id: c.component_item_id,
          description: null,
          quantity_per: 0,
          scrap_factor: 0,
          yield_loss_percentage: 0,
          quantity_required: Number(c.quantity_required),
          quantity_issued: Number(c.quantity_issued),
          quantity_remaining: Math.max(
            Number(c.quantity_required) - Number(c.quantity_issued),
            0,
          ),
          on_hand_quantity: 0,
          primary_vendor_id: null,
          primary_vendor_sku: null,
          unit_cost: null,
        }))
  kitLinesRef.current = kitLines

  const handleExportVendorPdf = async () => {
    setExportError(null)
    setExportingPdf(true)
    try {
      const [supplier, item, branding] = await Promise.all([
        sco.supplier_id
          ? vendorService.getVendor(sco.supplier_id).catch(() => null)
          : Promise.resolve(null),
        sco.item_id
          ? itemService.getItem(sco.item_id).catch(() => null)
          : Promise.resolve(null),
        loadCompanyPdfBranding().catch(() => null),
      ])

      generateSubcontractVendorPdf({
        sco,
        supplierName: supplier?.company_name ?? null,
        supplierContact: supplier,
        productName: item?.description ?? null,
        components: kitLines,
        branding,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export vendor PDF')
    } finally {
      setExportingPdf(false)
    }
  }

  const handleEmailVendor = async () => {
    const email = (vendor?.contact_email || '').trim()
    if (!email) {
      setExportError('No vendor email on file. Add a contact email on the vendor.')
      return
    }
    await handleExportVendorPdf()
    const subject = encodeURIComponent(`Subcontract order ${sco.sco_number} from Grand-Tek Technology USA`)
    const body = encodeURIComponent(
      [
        `Please find subcontract order ${sco.sco_number} for ${money(sco.document_total)}.`,
        sco.sales_order_id ? `Sales order: ${sco.sales_order_id}` : '',
        '',
        'The subcontract order PDF was downloaded so you can attach it to this email.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
  }

  const printIssueShippingDoc = async (order: SubcontractOrder, issue: MaterialIssue) => {
    setExportingIssueId(issue.issue_id)
    setIssueDocError(null)
    try {
      const [supplier, item] = await Promise.all([
        order.supplier_id
          ? vendorService.getVendor(order.supplier_id).catch(() => null)
          : Promise.resolve(null),
        order.item_id
          ? itemService.getItem(order.item_id).catch(() => null)
          : Promise.resolve(null),
      ])
      generateMaterialIssueShippingPdf({
        sco: order,
        issue,
        supplier,
        productName: item?.description ?? null,
        kitLines,
      })
    } catch (err) {
      setIssueDocError(err instanceof Error ? err.message : 'Failed to create shipping document')
    } finally {
      setExportingIssueId(null)
    }
  }
  printIssueShippingDocRef.current = printIssueShippingDoc

  const handleIssueLineChange = (key: string, value: string) => {
    setIssueLines((prev) => ({ ...prev, [key]: value }))
  }

  const openIssueForm = () => {
    if (!canOperateKit) return
    const defaults: Record<string, string> = {}
    for (const component of sco.components || []) {
      const remaining = remainingRequiredQty(component, kitLines)
      const onHand = onHandQty(component, kitLines)
      const suggested = Math.min(remaining, onHand)
      if (suggested > 0) {
        defaults[issueLineKey(component.sco_line_id, component.component_item_id)] =
          formatIssueQty(suggested)
      }
    }
    setIssueLines(defaults)
    setShowIssueForm(true)
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next.issue
      return next
    })
  }

  const closeIssueForm = () => {
    setShowIssueForm(false)
    setIssueLines({})
  }

  const handleIssueSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormErrors({})

    if (!canOperateKit) {
      setFormErrors({
        issue: issueBlockedReason || 'Materials cannot be issued until the Subcontract Order is approved.',
      })
      return
    }

    const lines: Array<{ component_item_id: string; quantity_issued: number; sco_line_id?: number }> = []
    for (const component of sco.components) {
      const key = `${component.sco_line_id || 'line'}:${component.component_item_id}`
      const qty = issueLines[key]
      if (!qty || Number(qty) <= 0) continue
      lines.push({
        component_item_id: component.component_item_id,
        quantity_issued: Number(qty),
        sco_line_id: component.sco_line_id || undefined,
      })
    }

    if (lines.length === 0) {
      setFormErrors({ issue: 'Enter a quantity for at least one component' })
      return
    }

    issueMutation.mutate({
      issue_date: issueForm.issue_date || undefined,
      notes: issueForm.notes || undefined,
      lines,
    })
  }

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormErrors({})

    if (!canReceiveFinishedGoods) {
      setFormErrors({
        receive: receiveBlockedReason || 'Finished goods cannot be received on this order.',
      })
      return
    }

    if (!receiveForm.quantity_received || Number(receiveForm.quantity_received) <= 0) {
      setFormErrors({ receive: 'Quantity received must be greater than 0' })
      return
    }

    receiveMutation.mutate({
      quantity_received: Number(receiveForm.quantity_received),
      receipt_date: receiveForm.receipt_date || undefined,
      notes: receiveForm.notes || undefined,
      unit_cost: receiveForm.unit_cost ? Number(receiveForm.unit_cost) : undefined,
      sco_line_id: receiveForm.sco_line_id ? Number(receiveForm.sco_line_id) : undefined,
    })
  }

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{sco.sco_number}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: statusColors.bg, color: statusColors.text }}>
              {sco.status}
            </span>
            <span
              style={{
                ...badgeStyle,
                backgroundColor: getStatusColors(approvalStatus).bg,
                color: getStatusColors(approvalStatus).text,
              }}
            >
              {approvalStatus.replace(/_/g, ' ')}
            </span>
            {sco.billing_status ? (
              <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>
                {String(sco.billing_status).replace(/_/g, ' ')}
              </span>
            ) : null}
            {Number(sco.revision_number || amendmentNumber || 0) > 0 ? (
              <span style={{ ...badgeStyle, backgroundColor: '#fff3e0', color: '#e65100' }}>
                Rev {sco.revision_number || amendmentNumber}
              </span>
            ) : null}
            {sco.remaining_closed ? (
              <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#455a64' }}>
                Remaining cancelled
              </span>
            ) : null}
          </div>
          <p style={documentPageSubStyle}>
            {sco.supplier_id}
            {vendor?.company_name ? ` · ${vendor.company_name}` : ''}
            {sco.sales_order_id ? (
              <>
                {' · '}
                <Link to={`/orders/${sco.sales_order_id}`} style={documentLinkStyle}>
                  {sco.sales_order_id}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Download or print this subcontract order as a PDF">
              <button type="button" style={primaryButtonStyle} onClick={() => void handleExportVendorPdf()} disabled={exportingPdf}>
                {exportingPdf ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={15} />}
                PDF
              </button>
            </HoverTip>
            <HoverTip label="Email this subcontract order to the vendor. The PDF downloads first so you can attach it.">
              <button type="button" style={secondaryButtonStyle} onClick={() => void handleEmailVendor()}>
                <Mail size={15} />
                Email vendor
              </button>
            </HoverTip>
            {canEditCostSheet && !editingCostSheet ? (
              <HoverTip label="Update labor, shipping, and admin charges">
                <button type="button" style={secondaryButtonStyle} onClick={enterCostSheetEdit}>
                  <Pencil size={15} />
                  Edit cost sheet
                </button>
              </HoverTip>
            ) : null}
            {editingCostSheet ? (
              <>
                <HoverTip label="Discard cost sheet edits">
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => {
                      setEditingCostSheet(false)
                      setFormErrors((prev) => {
                        const copy = { ...prev }
                        delete copy.costSheet
                        return copy
                      })
                    }}
                  >
                    Cancel
                  </button>
                </HoverTip>
                <HoverTip label="Save the revised cost sheet">
                  <button
                    type="button"
                    style={{ ...primaryButtonStyle, ...disabledActionStyle(!costSheetMutation.isPending) }}
                    onClick={saveCostSheet}
                    disabled={costSheetMutation.isPending}
                  >
                    {costSheetMutation.isPending ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Pencil size={15} />}
                    {costSheetMutation.isPending ? 'Saving…' : 'Save cost sheet'}
                  </button>
                </HoverTip>
              </>
            ) : null}
            {canAmend && !editingCostSheet ? (
              <HoverTip label="Create a revision of this subcontract order">
                <button type="button" style={secondaryButtonStyle} onClick={() => setShowAmendModal(true)}>
                  <RotateCcw size={15} />
                  Create Revision
                </button>
              </HoverTip>
            ) : null}
            {isApproved && !isAmending ? (
              <HoverTip label="Create a supplier invoice after receiving finished goods">
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() =>
                    navigate(
                      `/supplier-invoices/new?source_type=SUBCONTRACT_ORDER&source_order_id=${encodeURIComponent(sco.sco_number)}`,
                    )
                  }
                >
                  <Receipt size={15} />
                  Create Bill
                </button>
              </HoverTip>
            ) : null}
            {scoCanShowCloseRemaining(sco) ? (
              <HoverTip
                label={
                  scoCloseRemainingBlockedReason(sco) ||
                  'Cancel leftover finished-goods quantity after this partial receipt.'
                }
              >
                <button
                  type="button"
                  style={{
                    ...dangerButtonStyle,
                    ...disabledActionStyle(Boolean(sco.can_close_remaining) && !closeRemainingMutation.isPending),
                  }}
                  disabled={closeRemainingMutation.isPending || !sco.can_close_remaining}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Cancel the remaining unreceived quantity on ${sco.sco_number}? Further finished-goods receipts will be closed.`,
                      )
                    ) {
                      return
                    }
                    closeRemainingMutation.mutate()
                  }}
                >
                  <Ban size={15} />
                  {closeRemainingMutation.isPending ? 'Closing…' : 'Cancel remaining'}
                </button>
              </HoverTip>
            ) : null}
            {isCancellable ? (
              <HoverTip label="Cancel this subcontract order">
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
                </button>
              </HoverTip>
            ) : null}
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the subcontract order list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/subcontract-orders')}>
                <ArrowLeft size={15} />
                Subcontract Orders
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <ApprovalPanel
        module="subcontract-orders"
        documentId={sco.sco_number}
        approvalStatus={sco.approval_status}
        currentApprovalStep={sco.current_approval_step}
        actionDisabled={scoHasUnissuedKitComponents(sco.components)}
        actionDisabledReason={SCO_KIT_MUST_BE_ISSUED_MESSAGE}
        onStatusChange={() => {
          queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
          queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
          queryClient.invalidateQueries({ queryKey: ['subcontract-orders', id, 'revisions'] })
          queryClient.invalidateQueries({ queryKey: ['subcontract-orders', id, 'change-logs'] })
        }}
      />

      <DocumentRevisionPanel
        kind="subcontract-orders"
        documentId={sco.sco_number}
        revisionNumber={sco.revision_number || amendmentNumber}
        listRevisions={subcontractOrderService.listRevisions}
        listChangeLogs={subcontractOrderService.listChangeLogs}
      />

      {exportError && (
        <div style={{ ...errorAlertStyle, marginBottom: 16 }} role="alert">
          <span>⚠️ {exportError}</span>
        </div>
      )}

      {canEditCostSheet && !editingCostSheet && (
        <div style={draftEditBarStyle}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>
              Vendor cost sheet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              {isAmending
                ? `Revision ${sco.revision_number || amendmentNumber} is open. Update quantity, labor, shipping, and admin charges, then submit for approval. Linked purchase orders stay. Issue and receive stay locked until this revision is approved. Do not create the subcontractor bill until then.`
                : `Approval is ${approvalStatus.replace(/_/g, ' ')}. Update labor, shipping, and admin charges before submitting for approval.`}
            </div>
          </div>
        </div>
      )}

      {isAmending && approvalStatus === 'PENDING_APPROVAL' && (
        <div style={draftEditBarStyle}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>
              Cost sheet amendment {amendmentNumber}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              The revised cost sheet is waiting for approval. Linked purchase orders stay.
              Issue and receive stay locked until this amendment is approved. Create the
              subcontractor bill after approval.
            </div>
          </div>
        </div>
      )}

      {isAmending && (
        <div style={{ ...draftEditBarStyle, marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>
              Supplier invoice on hold
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              Re-approve amendment {amendmentNumber} before creating the subcontractor bill.
              Existing bills are not changed automatically.
            </div>
          </div>
        </div>
      )}

      {/* Order Header Information */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Order Data</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>SCO Number</label>
            <p style={valueStyle}>{sco.sco_number}</p>
          </div>
          <div>
            <label style={labelStyle}>Supplier</label>
            <p style={valueStyle}>{sco.supplier_id}</p>
          </div>
          <div>
            <label style={labelStyle}>Parent Sales Order</label>
            <p style={valueStyle}>
              {sco.sales_order_id ? (
                <Link
                  to={`/orders/${encodeURIComponent(sco.sales_order_id)}`}
                  style={documentLinkStyle}
                  title={`Open parent sales order ${sco.sales_order_id}`}
                >
                  {sco.sales_order_id}
                </Link>
              ) : (
                '—'
              )}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Purchase Order</label>
            <p style={valueStyle}>
              {linkedPurchaseOrders.length > 0 ? (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                  {linkedPurchaseOrders.map((po) => (
                    <Link
                      key={po.po_number}
                      to={`/purchase-orders/${encodeURIComponent(po.po_number)}`}
                      style={documentLinkStyle}
                      title={`Open purchase order ${po.po_number}`}
                    >
                      {po.po_number}
                      {po.po_type === 'SUBCONTRACT'
                        ? ' · Subcontract'
                        : po.po_type === 'MATERIAL'
                          ? ' · Material'
                          : ''}
                      {po.status ? ` · ${po.status}` : ''}
                    </Link>
                  ))}
                </span>
              ) : (
                '—'
              )}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Product</label>
            <p style={valueStyle}>
              {sco.item_id}
              {(sco.line_count || sco.lines?.length || 0) > 1
                ? ` (${sco.line_count || sco.lines?.length} assemblies)`
                : ''}
            </p>
          </div>
          <div>
            <label style={labelStyle}>BOM Version</label>
            <p style={valueStyle}>
              {sco.bom_version_no != null ? `v${sco.bom_version_no}` : '—'}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Quantity Ordered</label>
            <p style={valueStyle}>{sco.quantity_ordered}</p>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <p style={valueStyle}>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  backgroundColor: statusColors.bg,
                  color: statusColors.text,
                }}
              >
                {sco.status}
              </span>
            </p>
          </div>
          <div>
            <label style={labelStyle}>Approval Status</label>
            <p style={valueStyle}>
              {(sco.approval_status || 'DRAFT').replace(/_/g, ' ')}
              {amendmentNumber > 0 ? ` · Amendment ${amendmentNumber}` : ''}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Order Date</label>
            <p style={valueStyle}>{sco.order_date ? new Date(sco.order_date).toLocaleDateString() : '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Expected Return Date</label>
            <p style={valueStyle}>
              {sco.expected_return_date ? new Date(sco.expected_return_date).toLocaleDateString() : '-'}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <p style={valueStyle}>{sco.notes || '-'}</p>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ ...sectionHeadingStyle, margin: 0, borderBottom: 'none', paddingBottom: 0 }}>
              Finished assemblies
            </h3>
            {canEditCostSheet && !editingCostSheet && (
              <button type="button" onClick={enterCostSheetEdit} style={primaryButtonStyle}>
                Edit cost sheet
              </button>
            )}
            {editingCostSheet && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCostSheet(false)
                    setFormErrors((prev) => {
                      const copy = { ...prev }
                      delete copy.costSheet
                      return copy
                    })
                  }}
                  style={secondaryButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCostSheet}
                  disabled={costSheetMutation.isPending}
                  style={{
                    ...primaryButtonStyle,
                    opacity: costSheetMutation.isPending ? 0.7 : 1,
                    cursor: costSheetMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {costSheetMutation.isPending ? 'Saving…' : 'Save cost sheet'}
                </button>
              </div>
            )}
          </div>
          <p style={{ color: 'var(--muted, #666)', fontSize: 13, margin: '8px 0 12px' }}>
            {canEditCostSheet
              ? 'Vendor labor / shipping / admin charges can be updated while this order is Draft or Rejected.'
              : 'Cost sheet is locked after the subcontract order is submitted for approval.'}
          </p>
          {formErrors.costSheet && (
            <div style={errorAlertStyle}>
              <span>⚠️ {formErrors.costSheet}</span>
            </div>
          )}
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Line</th>
                <th style={thStyle}>SO line</th>
                <th style={thStyle}>Item</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit price</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {assemblyLines.map((line) => (
                <tr key={line.sco_line_id || line.line_number} style={tbodyRowStyle}>
                  <td style={tdStyle}>{line.line_number}</td>
                  <td style={tdStyle}>
                    {sco.sales_order_id && line.so_line_number != null ? (
                      <Link
                        to={`/orders/${encodeURIComponent(sco.sales_order_id)}`}
                        style={documentLinkStyle}
                        title={`Open parent sales order ${sco.sales_order_id}`}
                      >
                        {line.so_line_number}
                      </Link>
                    ) : (
                      (line.so_line_number ?? '—')
                    )}
                  </td>
                  <td style={tdStyle}>{line.item_id}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_ordered}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(line.unit_price || 0).toFixed(2)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(line.line_total || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assemblyLines.map((line) => (
            <div key={`charges-${line.sco_line_id || line.line_number}`} style={{ marginTop: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>
                Vendor cost sheet · {line.item_id}
              </h4>
              <ScoCostSheet
                quantity={line.quantity_ordered}
                charges={
                  editingCostSheet
                    ? draftCharges[line.sco_line_id] || defaultCostSheet()
                    : line.charges || []
                }
                onChange={(charges) =>
                  setDraftCharges((prev) => ({ ...prev, [line.sco_line_id]: charges }))
                }
                readOnly={!editingCostSheet}
              />
            </div>
          ))}
        </div>

      <DocumentAttachmentsPanel documentType="SUBCONTRACT_ORDER" documentId={sco.sco_number} />

      {/* Required Components / Kit Breakdown */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Required Components / Kit Breakdown</h3>
        <p style={{ color: 'var(--muted, #666)', fontSize: '13px', marginBottom: '12px' }}>
          Exploded from the assembly Subcontract BOM (order qty × qty per + scrap / yield loss),
          compared to warehouse issues to the subcontractor.
        </p>
        {(() => {
          const lines: CalculatedComponentLine[] = kitLines

          if (lines.length === 0) {
            return (
              <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>
                No material kit. A Material BOM is required so components can be issued before
                approval and receipt.
              </p>
            )
          }

          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={thStyle}>Component</th>
                    <th style={thStyle}>Primary Vendor</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Qty / Unit</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Scrap / Yield</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Required</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Issued</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Remaining</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>On Hand</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((c) => (
                    <tr key={`${c.sco_line_id || 'all'}-${c.component_item_id}`} style={tbodyRowStyle}>
                      <td style={tdStyle}>
                        <div>{c.component_item_id}</div>
                        {c.description && (
                          <div style={{ fontSize: '12px', color: 'var(--muted, #666)' }}>
                            {c.description}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {c.primary_vendor_id
                          ? `${c.primary_vendor_id}${
                              c.primary_vendor_sku ? ` (${c.primary_vendor_sku})` : ''
                            }`
                          : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {Number(c.quantity_per) || '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {Number(c.scrap_factor) || Number(c.yield_loss_percentage)
                          ? `${Number(c.scrap_factor)} / ${Number(c.yield_loss_percentage)}%`
                          : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {Number(c.quantity_required)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {Number(c.quantity_issued)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                        {Number(c.quantity_remaining).toFixed(4)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{c.on_hand_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>

      {/* Material Issues History */}
      <div style={cardStyle}>
        <div style={tableHeaderContainerStyle}>
          <h3 style={sectionHeadingStyleNoBorder}>Material Issues</h3>
          {isCancellable && canOperateKit && (sco.components || []).length > 0 && (
            <button
              type="button"
              onClick={() => (showIssueForm ? closeIssueForm() : openIssueForm())}
              style={addButtonStyle}
            >
              {showIssueForm ? 'Cancel' : '+ Issue Materials'}
            </button>
          )}
        </div>

        {!canOperateKit && issueBlockedReason && (
          <p style={{ color: '#e65100', fontSize: '13px', marginBottom: '12px' }}>
            {issueBlockedReason}
          </p>
        )}

        {showIssueForm && canOperateKit && (
          <form onSubmit={handleIssueSubmit} style={{ marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text)' }}>
              Issue ID is assigned automatically as UM31-YYMMXXXX
            </p>
            <div style={gridStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Issue Date</label>
                <input
                  type="date"
                  value={issueForm.issue_date}
                  onChange={(e) => setIssueForm((prev) => ({ ...prev, issue_date: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Notes</label>
                <input
                  type="text"
                  value={issueForm.notes}
                  onChange={(e) => setIssueForm((prev) => ({ ...prev, notes: e.target.value }))}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>
            </div>

            <p style={{ ...labelStyle, marginTop: '16px', marginBottom: '8px' }}>
              Quantities to Issue per Component
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={thStyle}>Assembly / Component</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Remaining Required</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>On Hand</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: '160px' }}>Qty to Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {sco.components.map((c) => {
                    const remaining = remainingRequiredQty(c, kitLines)
                    const onHand = onHandQty(c, kitLines)
                    const key = issueLineKey(c.sco_line_id, c.component_item_id)
                    const short = remaining > onHand
                    return (
                      <tr key={c.sco_component_id} style={tbodyRowStyle}>
                        <td style={tdStyle}>
                          {c.sco_line_id
                            ? `Line ${sco.lines?.find((line) => line.sco_line_id === c.sco_line_id)?.line_number ?? ''} · `
                            : ''}
                          {c.component_item_id}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{remaining.toFixed(4)}</td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            color: short ? '#c62828' : 'var(--text)',
                            fontWeight: short ? 700 : undefined,
                          }}
                        >
                          {onHand}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            max={onHand}
                            value={issueLines[key] ?? ''}
                            onChange={(e) => handleIssueLineChange(key, e.target.value)}
                            style={{ ...inputStyle, width: '140px', textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {(sco.components || []).some(
              (c) => remainingRequiredQty(c, kitLines) > onHandQty(c, kitLines),
            ) && (
              <p style={{ color: '#e65100', fontSize: 13, marginTop: 12 }}>
                Some components have less on-hand than remaining required. Receive the linked
                material purchase order (or add stock) before issuing those lines.
              </p>
            )}

            {formErrors.issue && (
              <div style={{ ...errorAlertStyle, marginTop: '16px' }}>
                <span>⚠️ {formErrors.issue}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button
                type="submit"
                disabled={issueMutation.isPending}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: issueMutation.isPending ? '#90caf9' : '#1976d2',
                  cursor: issueMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {issueMutation.isPending ? 'Submitting...' : 'Submit Issue'}
              </button>
            </div>
          </form>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        {issueDocError && (
          <div style={{ ...errorAlertStyle, marginBottom: 12 }}>
            <span>⚠️ {issueDocError}</span>
          </div>
        )}

        {sco.material_issues && sco.material_issues.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sco.material_issues.map((mi) => (
              <div key={mi.issue_id} style={issueCardStyle}>
                <div style={issueCardHeaderStyle}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>{mi.issue_id}</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4 }}>
                      {new Date(mi.issue_date).toLocaleDateString()}
                      {` · ${mi.lines.length} component${mi.lines.length === 1 ? '' : 's'}`}
                      {mi.notes ? ` · ${mi.notes}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void printIssueShippingDoc(sco, mi)}
                    disabled={exportingIssueId === mi.issue_id}
                    style={{
                      ...primaryButtonStyle,
                      opacity: exportingIssueId === mi.issue_id ? 0.75 : 1,
                      cursor: exportingIssueId === mi.issue_id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {exportingIssueId === mi.issue_id ? (
                      <>
                        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                        Preparing…
                      </>
                    ) : (
                      <>
                        <FileDown size={15} />
                        PDF
                      </>
                    )}
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...tableStyle, marginBottom: 0 }}>
                    <thead>
                      <tr style={theadRowStyle}>
                        <th style={thStyle}>Item</th>
                        <th style={thStyle}>Description</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Qty Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mi.lines.map((line) => {
                        const kit = matchKitLine(
                          {
                            sco_line_id: line.sco_line_id,
                            component_item_id: line.component_item_id,
                          },
                          kitLines,
                        )
                        return (
                          <tr key={line.issue_line_id} style={tbodyRowStyle}>
                            <td style={tdStyle}>{line.component_item_id}</td>
                            <td style={tdStyle}>{kit?.description || '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                              {Number(line.quantity_issued).toLocaleString('en-US', {
                                maximumFractionDigits: 4,
                              })}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>No materials issued yet.</p>
        )}
      </div>

      {/* Finished Goods Receipts History */}
      <div style={cardStyle}>
        <div style={tableHeaderContainerStyle}>
          <h3 style={sectionHeadingStyleNoBorder}>Finished Goods Receipts</h3>
          {isCancellable && (
            <span
              title={
                canReceiveFinishedGoods
                  ? 'Receive finished goods returned from the subcontractor'
                  : receiveBlockedReason || undefined
              }
              style={{
                display: 'inline-block',
                cursor: canReceiveFinishedGoods ? 'pointer' : 'not-allowed',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (!canReceiveFinishedGoods) return
                  setShowReceiveForm((v) => !v)
                }}
                disabled={!canReceiveFinishedGoods}
                aria-disabled={!canReceiveFinishedGoods}
                aria-label={
                  canReceiveFinishedGoods
                    ? showReceiveForm
                      ? 'Cancel receive finished goods'
                      : 'Receive Finished Goods'
                    : `Receive Finished Goods. ${receiveBlockedReason || ''}`
                }
                style={{
                  ...addButtonStyle,
                  backgroundColor: canReceiveFinishedGoods ? '#1976d2' : '#9e9e9e',
                  opacity: canReceiveFinishedGoods ? 1 : 0.75,
                  cursor: canReceiveFinishedGoods ? 'pointer' : 'not-allowed',
                  pointerEvents: canReceiveFinishedGoods ? 'auto' : 'none',
                }}
              >
                {showReceiveForm ? 'Cancel' : '+ Receive Goods'}
              </button>
            </span>
          )}
        </div>

        {isCancellable && !canReceiveFinishedGoods && (
          <p style={{ color: '#e65100', fontSize: '13px', marginBottom: '12px' }} role="status">
            {receiveBlockedReason}
          </p>
        )}

        {showReceiveForm && canReceiveFinishedGoods && (
          <form onSubmit={handleReceiveSubmit} style={{ marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text)' }}>
              Receipt ID is assigned automatically as UP72-YYMMXXXX
            </p>
            <div style={gridStyle}>
              {(sco.lines || []).length > 1 && (
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>Assembly line *</label>
                  <select
                    value={receiveForm.sco_line_id}
                    onChange={(e) => setReceiveForm((prev) => ({ ...prev, sco_line_id: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">Select a line</option>
                    {sco.lines!.map((line) => (
                      <option key={line.sco_line_id} value={line.sco_line_id}>
                        Line {line.line_number} · {line.item_id} · qty {line.quantity_ordered}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Quantity Received *</label>
                <input
                  type="number"
                  min="1"
                  value={receiveForm.quantity_received}
                  onChange={(e) =>
                    setReceiveForm((prev) => ({ ...prev, quantity_received: e.target.value }))
                  }
                  style={inputStyle}
                />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Receipt Date</label>
                <input
                  type="date"
                  value={receiveForm.receipt_date}
                  onChange={(e) => setReceiveForm((prev) => ({ ...prev, receipt_date: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Unit Cost (GRNI accrual)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={receiveForm.unit_cost}
                  onChange={(e) => setReceiveForm((prev) => ({ ...prev, unit_cost: e.target.value }))}
                  style={inputStyle}
                  placeholder={String(sco.unit_price ?? 0)}
                />
              </div>
              <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Notes</label>
                <input
                  type="text"
                  value={receiveForm.notes}
                  onChange={(e) => setReceiveForm((prev) => ({ ...prev, notes: e.target.value }))}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>
            </div>

            {formErrors.receive && (
              <div style={{ ...errorAlertStyle, marginTop: '16px' }}>
                <span>⚠️ {formErrors.receive}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button
                type="submit"
                disabled={receiveMutation.isPending}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: receiveMutation.isPending ? '#90caf9' : '#1976d2',
                  cursor: receiveMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {receiveMutation.isPending ? 'Submitting...' : 'Submit Receipt'}
              </button>
            </div>
          </form>
        )}

        {sco.finished_goods_receipts && sco.finished_goods_receipts.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Receipt ID</th>
                  <th style={thStyle}>Receipt Date</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity Received</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sco.finished_goods_receipts.map((fgr) => (
                  <tr key={fgr.receipt_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>
                      <Link
                        to={goodsReceiptHref(fgr.receipt_id)}
                        style={receiptLinkStyle}
                        title={`Open receipt ${fgr.receipt_id}`}
                      >
                        {fgr.receipt_id}
                      </Link>
                    </td>
                    <td style={tdStyle}>{new Date(fgr.receipt_date).toLocaleDateString()}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fgr.quantity_received}</td>
                    <td style={tdStyle}>{fgr.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>No finished goods received yet.</p>
        )}
      </div>

      {showAmendModal && (
        <AmendCostSheetModal
          busy={amendMutation.isPending}
          error={formErrors.amend}
          amendmentNumber={amendmentNumber + 1}
          onClose={() => {
            if (amendMutation.isPending) return
            setShowAmendModal(false)
            setFormErrors((prev) => {
              const copy = { ...prev }
              delete copy.amend
              return copy
            })
          }}
          onConfirm={(comments) => amendMutation.mutate(comments)}
        />
      )}
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function issueLineKey(scoLineId: number | null | undefined, componentItemId: string): string {
  return `${scoLineId || 'line'}:${componentItemId}`
}

function formatIssueQty(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return String(Number(value.toFixed(4)))
}

function matchKitLine(
  component: { sco_line_id?: number | null; component_item_id: string },
  kitLines: CalculatedComponentLine[],
): CalculatedComponentLine | undefined {
  return kitLines.find(
    (row) =>
      row.component_item_id === component.component_item_id &&
      (row.sco_line_id == null ||
        component.sco_line_id == null ||
        row.sco_line_id === component.sco_line_id),
  )
}

function onHandQty(
  component: { sco_line_id?: number | null; component_item_id: string },
  kitLines: CalculatedComponentLine[],
): number {
  const kit = matchKitLine(component, kitLines)
  return Math.max(Number(kit?.on_hand_quantity ?? 0), 0)
}

function remainingRequiredQty(
  component: {
    sco_line_id?: number | null
    component_item_id: string
    quantity_required: number
    quantity_issued: number
  },
  kitLines: CalculatedComponentLine[],
): number {
  const kit = matchKitLine(component, kitLines)
  if (kit != null && kit.quantity_remaining != null) {
    return Math.max(Number(kit.quantity_remaining) || 0, 0)
  }
  return Math.max(Number(component.quantity_required) - Number(component.quantity_issued), 0)
}

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    PLANNED: { bg: '#fffde7', text: '#f9a825' },
    PARTIALLY_ISSUED: { bg: '#fff3e0', text: '#e65100' },
    MATERIALS_ISSUED: { bg: '#e3f2fd', text: '#1565c0' },
    PARTIALLY_RECEIVED: { bg: '#ede7f6', text: '#5e35b1' },
    COMPLETED: { bg: '#e8f5e9', text: '#2e7d32' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

function AmendCostSheetModal({
  busy,
  error,
  amendmentNumber,
  onClose,
  onConfirm,
}: {
  busy: boolean
  error?: string
  amendmentNumber: number
  onClose: () => void
  onConfirm: (comments: string) => void
}) {
  return (
    <div style={amendOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="amend-sco-title">
      <form
        style={amendModalStyle}
        onSubmit={(event) => {
          event.preventDefault()
          const comments = String(new FormData(event.currentTarget).get('comments') || '')
          onConfirm(comments)
        }}
      >
        <h3 id="amend-sco-title" style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--text-h)' }}>
          Create Revision
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
          This starts revision {amendmentNumber} on the same subcontract order number. The approved
          state is frozen. Approval returns to Draft so you can update quantity or vendor charges
          and re-submit. Linked purchase orders stay. Do not create a new subcontractor bill until
          the revision is approved. Existing bills are not changed automatically.
        </p>
        <textarea
          name="comments"
          rows={4}
          placeholder="Reason for the cost-sheet change (optional)…"
          style={amendTextareaStyle}
          autoFocus
        />
        {error && (
          <p style={{ color: '#c62828', fontSize: 13, margin: '8px 0 0' }} role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              ...amendButtonStyle,
              opacity: busy ? 0.7 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Opening revision…' : 'Create Revision'}
          </button>
        </div>
      </form>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',

}

const sectionHeadingStyleNoBorder: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tableHeaderContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',

}

const addButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '20px',
}

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  marginBottom: '4px',
  display: 'block',
}

const valueStyle: React.CSSProperties = {
  color: 'var(--text)',
  margin: 0,
  fontSize: '14px',
}

const documentLinkStyle: React.CSSProperties = {
  color: 'var(--link, #1565c0)',
  fontWeight: 600,
  textDecoration: 'underline',
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '14px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '6px',
  padding: '12px 20px',
  fontSize: '14px',
  fontWeight: 'bold',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const theadRowStyle: React.CSSProperties = {
  backgroundColor: 'var(--social-bg)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--divider)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const amendButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: '#ef6c00',
}

const amendOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const amendModalStyle: React.CSSProperties = {
  background: 'var(--bg)',
  borderRadius: 10,
  padding: '20px 24px',
  width: 'min(480px, 100%)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  border: '1px solid var(--border)',
}

const amendTextareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: 13,
  resize: 'vertical',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
}

const draftEditBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: '16px 18px',
  marginBottom: 16,
  borderRadius: 10,
  border: '1px solid rgba(25, 118, 210, 0.35)',
  background:
    'linear-gradient(135deg, rgba(25, 118, 210, 0.12) 0%, rgba(255,255,255,0.95) 55%)',
  boxShadow: 'var(--shadow)',
}

const issueCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  overflow: 'hidden',
  backgroundColor: 'var(--bg)',
}

const issueCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '12px 14px',
  borderBottom: '1px solid var(--divider)',
  backgroundColor: 'var(--social-bg)',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

export default SubcontractOrderDetail
