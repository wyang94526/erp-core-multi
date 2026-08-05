/**
 * SubcontractOrderDetail Component
 * Displays full details of a subcontract order (SCO): header info, required components,
 * material issue history, and finished goods receipt history. Also provides inline
 * forms to record new "Issue Materials" and "Receive Goods" transactions.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subcontractOrderService } from '../api/services'
import { ApprovalPanel } from './ApprovalPanel'
import type { CalculatedComponentLine } from '../types'

export function SubcontractOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showIssueForm, setShowIssueForm] = useState(false)
  const [showReceiveForm, setShowReceiveForm] = useState(false)

  const [issueForm, setIssueForm] = useState({
    issue_id: '',
    issue_date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [issueLines, setIssueLines] = useState<Record<string, string>>({})

  const [receiveForm, setReceiveForm] = useState({
    receipt_id: '',
    quantity_received: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

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

  const issueMutation = useMutation({
    mutationFn: (data: {
      issue_id: string
      issue_date?: string
      notes?: string
      lines: Array<{ component_product_id: string; quantity_issued: number }>
    }) => subcontractOrderService.issueMaterials(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      queryClient.invalidateQueries({
        queryKey: ['subcontractOrders', id, 'calculate-components'],
      })
      setShowIssueForm(false)
      setIssueForm({ issue_id: '', issue_date: new Date().toISOString().split('T')[0], notes: '' })
      setIssueLines({})
    },
    onError: (err: any) => {
      setFormErrors({ issue: err.message || 'Failed to issue materials' })
    },
  })

  const receiveMutation = useMutation({
    mutationFn: (data: {
      receipt_id: string
      quantity_received: number
      receipt_date?: string
      notes?: string
    }) => subcontractOrderService.receiveGoods(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      setShowReceiveForm(false)
      setReceiveForm({
        receipt_id: '',
        quantity_received: '',
        receipt_date: new Date().toISOString().split('T')[0],
        notes: '',
      })
    },
    onError: (err: any) => {
      setFormErrors({ receive: err.message || 'Failed to receive goods' })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => subcontractOrderService.cancelSubcontractOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
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

  const handleIssueLineChange = (componentProductId: string, value: string) => {
    setIssueLines((prev) => ({ ...prev, [componentProductId]: value }))
  }

  const handleIssueSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormErrors({})

    if (!issueForm.issue_id.trim()) {
      setFormErrors({ issue: 'Issue ID is required' })
      return
    }

    const lines = Object.entries(issueLines)
      .filter(([, qty]) => qty && Number(qty) > 0)
      .map(([component_product_id, qty]) => ({
        component_product_id,
        quantity_issued: Number(qty),
      }))

    if (lines.length === 0) {
      setFormErrors({ issue: 'Enter a quantity for at least one component' })
      return
    }

    issueMutation.mutate({
      issue_id: issueForm.issue_id,
      issue_date: issueForm.issue_date || undefined,
      notes: issueForm.notes || undefined,
      lines,
    })
  }

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormErrors({})

    if (!receiveForm.receipt_id.trim()) {
      setFormErrors({ receive: 'Receipt ID is required' })
      return
    }
    if (!receiveForm.quantity_received || Number(receiveForm.quantity_received) <= 0) {
      setFormErrors({ receive: 'Quantity received must be greater than 0' })
      return
    }

    receiveMutation.mutate({
      receipt_id: receiveForm.receipt_id,
      quantity_received: Number(receiveForm.quantity_received),
      receipt_date: receiveForm.receipt_date || undefined,
      notes: receiveForm.notes || undefined,
    })
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Subcontract Order Details</h2>
          <p style={pageSubStyle}>Viewing SCO {sco.sco_number}</p>
        </div>
        <button onClick={() => navigate('/subcontract-orders')} style={secondaryButtonStyle}>
          Back to Subcontract Orders
        </button>
      </header>

      <ApprovalPanel
        module="subcontract-orders"
        documentId={sco.sco_number}
        approvalStatus={sco.approval_status}
        currentApprovalStep={sco.current_approval_step}
        onStatusChange={() => {
          queryClient.invalidateQueries({ queryKey: ['subcontractOrders', id] })
          queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
        }}
      />

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
            <label style={labelStyle}>Product</label>
            <p style={valueStyle}>{sco.product_id}</p>
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
            <p style={valueStyle}>{(sco.approval_status || 'DRAFT').replace(/_/g, ' ')}</p>
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

      {/* Required Components / Kit Breakdown */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Required Components / Kit Breakdown</h3>
        <p style={{ color: 'var(--muted, #666)', fontSize: '13px', marginBottom: '12px' }}>
          Exploded from the assembly Subcontract BOM (order qty × qty per + scrap / yield loss),
          compared to warehouse issues to the subcontractor.
        </p>
        {(() => {
          const lines: CalculatedComponentLine[] =
            kitBreakdown?.components?.length
              ? kitBreakdown.components
              : (sco.components || []).map((c) => ({
                  component_product_id: c.component_product_id,
                  description: null,
                  quantity_per: 0,
                  scrap_factor: 0,
                  yield_loss_percentage: 0,
                  quantity_required: Number(c.quantity_required),
                  quantity_issued: Number(c.quantity_issued),
                  quantity_remaining: Math.max(
                    Number(c.quantity_required) - Number(c.quantity_issued),
                    0
                  ),
                  on_hand_quantity: 0,
                  primary_vendor_id: null,
                  primary_vendor_sku: null,
                  unit_cost: null,
                }))

          if (lines.length === 0) {
            return (
              <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>No components found.</p>
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
                    <tr key={c.component_product_id} style={tbodyRowStyle}>
                      <td style={tdStyle}>
                        <div>{c.component_product_id}</div>
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
          {isCancellable && isApproved && (
            <button
              type="button"
              onClick={() => setShowIssueForm((v) => !v)}
              style={addButtonStyle}
            >
              {showIssueForm ? 'Cancel' : '+ Issue Materials'}
            </button>
          )}
        </div>

        {isCancellable && !isApproved && (
          <p style={{ color: '#e65100', fontSize: '13px', marginBottom: '12px' }}>
            Approve this subcontract order before issuing materials.
          </p>
        )}

        {showIssueForm && (
          <form onSubmit={handleIssueSubmit} style={{ marginBottom: '20px' }}>
            <div style={gridStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Issue ID *</label>
                <input
                  type="text"
                  value={issueForm.issue_id}
                  onChange={(e) => setIssueForm((prev) => ({ ...prev, issue_id: e.target.value }))}
                  style={inputStyle}
                  placeholder="e.g. ISS-0001"
                />
              </div>
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
                    <th style={thStyle}>Component Product ID</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Remaining Required</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: '160px' }}>Qty to Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {sco.components.map((c) => {
                    const remaining = Number(c.quantity_required) - Number(c.quantity_issued)
                    return (
                      <tr key={c.sco_component_id} style={tbodyRowStyle}>
                        <td style={tdStyle}>{c.component_product_id}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{remaining.toFixed(4)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={issueLines[c.component_product_id] || ''}
                            onChange={(e) => handleIssueLineChange(c.component_product_id, e.target.value)}
                            style={{ ...inputStyle, width: '140px', textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

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

        {sco.material_issues && sco.material_issues.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Issue ID</th>
                  <th style={thStyle}>Issue Date</th>
                  <th style={thStyle}>Components</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sco.material_issues.map((mi) => (
                  <tr key={mi.issue_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{mi.issue_id}</td>
                    <td style={tdStyle}>{new Date(mi.issue_date).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      {mi.lines
                        .map((l) => `${l.component_product_id}: ${Number(l.quantity_issued)}`)
                        .join(', ')}
                    </td>
                    <td style={tdStyle}>{mi.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <button
              type="button"
              onClick={() => setShowReceiveForm((v) => !v)}
              style={addButtonStyle}
            >
              {showReceiveForm ? 'Cancel' : '+ Receive Goods'}
            </button>
          )}
        </div>

        {showReceiveForm && (
          <form onSubmit={handleReceiveSubmit} style={{ marginBottom: '20px' }}>
            <div style={gridStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Receipt ID *</label>
                <input
                  type="text"
                  value={receiveForm.receipt_id}
                  onChange={(e) => setReceiveForm((prev) => ({ ...prev, receipt_id: e.target.value }))}
                  style={inputStyle}
                  placeholder="e.g. RCV-0001"
                />
              </div>
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
                    <td style={tdStyle}>{fgr.receipt_id}</td>
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

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {isCancellable && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            style={{
              ...dangerButtonStyle,
              cursor: cancelMutation.isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Order'}
          </button>
        )}
        <button onClick={() => navigate('/subcontract-orders')} style={secondaryButtonStyle}>
          Back to Subcontract Orders
        </button>
      </div>
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    PLANNED: { bg: '#fffde7', text: '#f9a825' },
    PARTIALLY_ISSUED: { bg: '#fff3e0', text: '#e65100' },
    MATERIALS_ISSUED: { bg: '#e3f2fd', text: '#1565c0' },
    PARTIALLY_RECEIVED: { bg: '#ede7f6', text: '#5e35b1' },
    COMPLETED: { bg: '#e8f5e9', text: '#2e7d32' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
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
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
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
  marginBottom: '16px',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}

const addButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
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
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const dangerButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

export default SubcontractOrderDetail
