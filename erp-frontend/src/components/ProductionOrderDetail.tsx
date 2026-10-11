/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Loader2, PackageCheck, PackageMinus, Pencil, XCircle } from 'lucide-react'
import { productionOrderService } from '../api/services'
import ShopFloorPanel, { type StepCompletion } from './ShopFloorPanel'
import {
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  documentPageHeaderStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusColors(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#fffde7', text: '#f9a825' },
    released: { bg: '#e3f2fd', text: '#1565c0' },
    in_process: { bg: '#fff3e0', text: '#e65100' },
    completed: { bg: '#e8f5e9', text: '#2e7d32' },
    closed: { bg: '#eceff1', text: '#546e7a' },
    cancelled: { bg: '#ffebee', text: '#c62828' },
  }
  return colors[status] || { bg: '#f5f5f5', text: '#616161' }
}

function formatMoney(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={metaRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  )
}

export default function ProductionOrderDetail() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [issueQty, setIssueQty] = useState('1')
  const [receiptQty, setReceiptQty] = useState('1')
  const [tab, setTab] = useState<'header' | 'components' | 'routing'>('header')

  const { data: order = null, isLoading, error: loadError } = useQuery({
    queryKey: ['productionOrders', orderId],
    queryFn: () => productionOrderService.get(orderId),
    enabled: Boolean(orderId),
  })

  useEffect(() => {
    if (!order || materialId) return
    const first = order.materials[0]
    if (first) setMaterialId(String(first.id))
  }, [order, materialId])

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['productionOrders'] })
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const issue = (event: FormEvent) => {
    event.preventDefault()
    void run(() =>
      productionOrderService.issue(orderId, {
        lines: [{ material_id: Number(materialId), quantity: Number(issueQty) }],
      }),
    )
  }

  const receive = (event: FormEvent) => {
    event.preventDefault()
    void run(() => productionOrderService.receive(orderId, { quantity_received: Number(receiptQty) }))
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading production order…
        </p>
      </div>
    )
  }

  if (!order) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{loadError instanceof Error ? loadError.message : 'Production order not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate('/production-orders')}>
            <ArrowLeft size={15} />
            Production Orders
          </button>
        </div>
      </div>
    )
  }

  const colors = statusColors(order.status)
  const canMove = order.status === 'released' || order.status === 'in_process'
  const openQty = Math.max(0, order.qty_ordered - order.qty_completed - (order.scrapped_qty ?? 0))

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{order.production_order_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>{statusLabel(order.status)}</span>
            <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>{order.item_id}</span>
          </div>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            {order.status === 'draft' ? (
              <button type="button" style={headerButtonStyle} onClick={() => navigate(`/production-orders/${encodeURIComponent(orderId)}/edit`)}>
                <Pencil size={15} />
                Edit
              </button>
            ) : null}
            {order.status === 'draft' ? (
              <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void run(() => productionOrderService.release(orderId))}>
                <CheckCircle2 size={15} />
                Release
              </button>
            ) : null}
            {order.status === 'draft' ? (
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={busy}
                onClick={() => void run(async () => {
                  await productionOrderService.cancel(orderId)
                  navigate('/production-orders')
                })}
              >
                <XCircle size={15} />
                Cancel
              </button>
            ) : null}
            {order.status !== 'draft' && order.status !== 'closed' && order.status !== 'cancelled' ? (
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => productionOrderService.close(orderId))}>
                Close
              </button>
            ) : null}
            <button type="button" style={headerButtonStyle} onClick={() => navigate('/production-orders')}>
              <ArrowLeft size={15} />
              Production Orders
            </button>
          </div>
        </div>
      </header>

      {error ? <p style={errorStyle}>{error}</p> : null}

      <div style={tabRowStyle}>
        {([
          ['header', 'Header'],
          ['components', 'Components'],
          ['routing', 'Routing'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={tab === key ? tabActiveStyle : tabStyle}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'header' ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Header</h2>
          <dl style={metaGridStyle}>
            <div style={metaColumnStyle}>
              <MetaRow label="Item">{order.item_id}</MetaRow>
              <MetaRow label="Sales order">{order.sales_order_id || '—'}</MetaRow>
              <MetaRow label="Planned">{order.qty_ordered}</MetaRow>
              <MetaRow label="Completed">{order.qty_completed}</MetaRow>
              <MetaRow label="Scrapped">{order.scrapped_qty ?? 0}</MetaRow>
              <MetaRow label="Receipts">
                {(order.receipts || []).length === 0 ? (
                  '—'
                ) : (
                  (order.receipts || [])
                    .slice()
                    .sort((a, b) => a.receipt_date.localeCompare(b.receipt_date) || a.receipt_id.localeCompare(b.receipt_id))
                    .map((receipt, index) => (
                      <span key={receipt.receipt_id}>
                        {index > 0 ? ', ' : null}
                        <Link
                          to={`/production-orders/${encodeURIComponent(order.production_order_id)}/receipts/${encodeURIComponent(receipt.receipt_id)}`}
                          style={docLinkStyle}
                        >
                          {receipt.receipt_id}
                        </Link>
                      </span>
                    ))
                )}
              </MetaRow>
            </div>
            <div style={metaColumnStyle}>
              <MetaRow label="Order date">{order.order_date ? new Date(order.order_date).toLocaleDateString() : '—'}</MetaRow>
              <MetaRow label="Start">{order.planned_start ? new Date(order.planned_start).toLocaleDateString() : '—'}</MetaRow>
              <MetaRow label="Due">{order.due_date ? new Date(order.due_date).toLocaleDateString() : '—'}</MetaRow>
              <MetaRow label="Warehouse">{order.warehouse_id || '—'}</MetaRow>
              <MetaRow label="Currency">{order.transaction_currency}</MetaRow>
              <MetaRow label="Transaction amount">{formatMoney(order.transaction_amount)}</MetaRow>
              <MetaRow label="Exchange rate">{order.exchange_rate ?? 'Frozen at release'}</MetaRow>
              <MetaRow label="Base amount">{formatMoney(order.base_amount)}</MetaRow>
            </div>
          </dl>
          {order.notes ? <p style={{ ...hintStyle, marginTop: 16 }}>{order.notes}</p> : null}
          {canMove && openQty > 0 ? (
            <form onSubmit={receive} style={{ marginTop: 20 }}>
              <h3 style={subHeadingStyle}>Receive finished goods</h3>
              <div style={formRowStyle}>
                <label style={fieldStyle}>
                  Quantity
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={openQty}
                    value={receiptQty}
                    onChange={(e) => setReceiptQty(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" style={{ ...primaryButtonStyle, alignSelf: 'end' }} disabled={busy}>
                  <PackageCheck size={15} />
                  Receive
                </button>
              </div>
            </form>
          ) : null}
          {canMove && openQty === 0 ? (
            <p style={{ ...hintStyle, marginTop: 16 }}>
              Nothing remains to receive. Completed {order.qty_completed} and scrapped {order.scrapped_qty ?? 0} cover the planned quantity of {order.qty_ordered}.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === 'components' ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Component allocation</h2>
          {order.materials.length === 0 ? (
            <p style={hintStyle}>This draft has no exploded components yet. Save it again after the item has an active BOM.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <th style={thStyle}>Component</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Warehouse</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Required</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Issued</th>
                    <th style={thStyle}>Lot / serial</th>
                  </tr>
                </thead>
                <tbody>
                  {order.materials.map((line) => (
                    <tr key={line.id} style={rowStyle}>
                      <td style={tdStyle}>{line.component_item_id || line.component_code || '—'}</td>
                      <td style={tdStyle}>{line.item_type}</td>
                      <td style={tdStyle}>{line.warehouse_id || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_required}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_issued}</td>
                      <td style={tdStyle}>{line.lot_serial_tracking_required ? 'Required' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canMove ? (
            <form onSubmit={issue} style={{ marginTop: 20 }}>
              <h3 style={subHeadingStyle}>Issue components</h3>
              <div style={formRowStyle}>
                <label style={fieldStyle}>
                  Material
                  <select style={inputStyle} value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
                    {order.materials.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.component_item_id || line.component_code} · required {line.quantity_required}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={fieldStyle}>
                  Quantity
                  <input style={inputStyle} type="number" min={1} value={issueQty} onChange={(e) => setIssueQty(e.target.value)} required />
                </label>
                <button type="submit" style={{ ...primaryButtonStyle, alignSelf: 'end' }} disabled={busy || order.materials.length === 0}>
                  <PackageMinus size={15} />
                  Issue
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {tab === 'routing' ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>
            Routing
            {order.routing_code ? ` · ${order.routing_code} v${order.routing_version_no}` : ''}
          </h2>
          {(order.operations || []).length === 0 ? (
            <p style={hintStyle}>No routing steps were copied from the active BOM.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <th style={thStyle}>Seq</th>
                    <th style={thStyle}>Operation</th>
                    <th style={thStyle}>Work center</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Setup</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Run</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Good</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Scrap</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Rework</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Labor h</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Variance min</th>
                    <th style={thStyle}>Status</th>
                    {canMove ? <th style={thStyle}>Progress</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {(order.operations || []).map((step) => (
                    <tr key={step.id} style={rowStyle}>
                      <td style={tdStyle}>{step.operation_sequence}</td>
                      <td style={tdStyle}>{step.operation_name}</td>
                      <td style={tdStyle}>{step.work_center_id || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.setup_time}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.run_time}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.good_quantity ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.scrap_quantity ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.rework_quantity ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.labor_hours ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{step.variance_minutes ?? '—'}</td>
                      <td style={tdStyle}>{statusLabel(step.status)}</td>
                      {canMove ? (
                        <td style={tdStyle}>
                          {step.status === 'pending' ? (
                            <button
                              type="button"
                              style={headerButtonStyle}
                              disabled={busy}
                              onClick={() => void run(() => productionOrderService.startStep(orderId, step.id))}
                            >
                              Start
                            </button>
                          ) : (
                            statusLabel(step.status)
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(order.operations || [])
            .filter((step) => step.status === 'running')
            .map((step) => (
              <ShopFloorPanel
                key={step.id}
                step={step}
                plannedQuantity={order.qty_ordered}
                busy={busy}
                onComplete={(body: StepCompletion) =>
                  void run(() => productionOrderService.completeStep(orderId, step.id, body))
                }
              />
            ))}
          {(order.operations || [])
            .filter((step) => step.status === 'completed')
            .map((step) => (
              <p key={`trace-${step.id}`} style={{ ...hintStyle, fontStyle: 'normal', marginTop: 12 }}>
                Sequence {step.operation_sequence} completed
                {step.scrap_reason_code ? ` · scrap ${step.scrap_reason_code}` : ''}
                {(step.quality_checks || []).map((check) => ` · ${check.characteristic} ${check.passed ? 'passed' : 'failed'}`).join('')}
                {(step.downtime_logs || []).map((row) => ` · downtime ${row.reason_code} ${row.minutes} min`).join('')}
                {(step.parameters || []).map((row) => ` · ${row.name} ${row.value}${row.unit ? ` ${row.unit}` : ''}`).join('')}
              </p>
            ))}
          {(order.operations || []).some((step) => (step.backflushes || []).length > 0) ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={subHeadingStyle}>Material backflush</h3>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <th style={thStyle}>Component</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                    <th style={thStyle}>Lot</th>
                    <th style={thStyle}>Serial</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.operations || []).flatMap((step) =>
                    (step.backflushes || []).map((row) => (
                      <tr key={row.id} style={rowStyle}>
                        <td style={tdStyle}>{row.component_item_id || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{row.quantity}</td>
                        <td style={tdStyle}>{row.lot_number || '—'}</td>
                        <td style={tdStyle}>{row.serial_number || '—'}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg, #fff)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
}
const sectionHeadingStyle: CSSProperties = { margin: '0 0 16px', fontSize: 18, fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const subHeadingStyle: CSSProperties = { margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text-h)' }
const metaGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, fontSize: 14 }
const metaColumnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const metaRowStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, margin: 0 }
const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 150,
  flexShrink: 0,
}
const valueStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text, #424242)' }
const docLinkStyle: CSSProperties = { color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadStyle: CSSProperties = { backgroundColor: 'var(--social-bg, #f5f5f5)' }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--divider, #eee)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text, #424242)', verticalAlign: 'middle' }
const formRowStyle: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 'bold', color: 'var(--text-h)', minWidth: 180 }
const inputStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  fontFamily: 'inherit',
}
const errorStyle: CSSProperties = {
  margin: '0 0 16px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
}
const hintStyle: CSSProperties = { margin: 0, color: 'var(--text)', fontStyle: 'italic' }
const tabRowStyle: CSSProperties = { display: 'flex', gap: 8, marginBottom: 16 }
const tabStyle: CSSProperties = {
  ...headerButtonStyle,
  backgroundColor: 'transparent',
}
const tabActiveStyle: CSSProperties = {
  ...primaryButtonStyle,
}
