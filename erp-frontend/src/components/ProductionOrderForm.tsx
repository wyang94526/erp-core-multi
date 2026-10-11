/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { inventoryService, itemService, productionOrderService, salesOrderService } from '../api/services'
import { useCompanyLetterhead } from '../hooks/useCompanyProfile'
import { headerButtonStyle, primaryButtonStyle, secondaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

export default function ProductionOrderForm() {
  const { orderId } = useParams()
  const editing = Boolean(orderId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const letterhead = useCompanyLetterhead()
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('1')
  const [salesOrderId, setSalesOrderId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [currency, setCurrency] = useState(letterhead.detail.split(' · ').pop() || 'USD')
  const [amount, setAmount] = useState('0')
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [scrappedQty, setScrappedQty] = useState('0')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: items = [] } = useQuery({
    queryKey: ['items', 'production-order-form'],
    queryFn: () => itemService.listItems(0, 200),
  })

  const { data: salesOrders = [] } = useQuery({
    queryKey: ['salesOrders', 'production-order-form'],
    queryFn: () => salesOrderService.listSalesOrders(0, 200),
  })

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'production-order-form'],
    queryFn: () => inventoryService.listWarehouses(0, 200),
  })

  const salesOrderOptions = [
    ...(salesOrderId && !salesOrders.some((order) => order.sales_order_id === salesOrderId)
      ? [{ sales_order_id: salesOrderId, customer_id: '', customer_po_number: '', status: '' }]
      : []),
    ...salesOrders.map((order) => ({
      sales_order_id: order.sales_order_id,
      customer_id: order.customer_id,
      customer_po_number: order.customer_po_number,
      status: order.status,
    })),
  ]

  const activeWarehouses = warehouses.filter((warehouse) => warehouse.is_active || warehouse.warehouse_id === warehouseId)
  const warehouseOptions = warehouseId && !activeWarehouses.some((warehouse) => warehouse.warehouse_id === warehouseId)
    ? [{ warehouse_id: warehouseId, name: warehouseId, code: warehouseId, address: null, is_active: true }, ...activeWarehouses]
    : activeWarehouses

  const { data: existing, isLoading } = useQuery({
    queryKey: ['productionOrders', orderId],
    queryFn: () => productionOrderService.get(orderId || ''),
    enabled: editing,
  })

  useEffect(() => {
    if (!existing) return
    setItemId(existing.item_id)
    setQty(String(existing.qty_ordered))
    setSalesOrderId(existing.sales_order_id || '')
    setWarehouseId(existing.warehouse_id || '')
    setCurrency(existing.transaction_currency)
    setAmount(String(existing.transaction_amount ?? 0))
    setOrderDate(existing.order_date)
    setStartDate(existing.planned_start || '')
    setDueDate(existing.due_date || '')
    setNotes(existing.notes || '')
    setScrappedQty(String(existing.scrapped_qty ?? 0))
  }, [existing])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setSaving(true)
    const body = {
      item_id: itemId.trim(),
      qty_ordered: Number(qty),
      sales_order_id: salesOrderId.trim() || null,
      warehouse_id: warehouseId.trim() || null,
      order_date: orderDate,
      planned_start: startDate || null,
      due_date: dueDate || null,
      transaction_currency: currency.trim().toUpperCase(),
      transaction_amount: Number(amount || 0),
      notes: notes.trim() || null,
    }
    try {
      const saved = editing && orderId
        ? await productionOrderService.update(orderId, { ...body, scrapped_qty: Number(scrappedQty || 0) })
        : await productionOrderService.create({ ...body, explode_bom: true })
      await queryClient.invalidateQueries({ queryKey: ['productionOrders'] })
      navigate(`/production-orders/${encodeURIComponent(saved.production_order_id)}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save production order')
    } finally {
      setSaving(false)
    }
  }

  if (editing && isLoading) {
    return (
      <div style={containerStyle}>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} />
          Loading production order…
        </p>
      </div>
    )
  }

  if (existing && existing.status !== 'draft') {
    return (
      <div style={containerStyle}>
        <PageHeader title={existing.production_order_id} subtitle="Released orders stay as they were when the BOM was exploded." />
        <button type="button" style={headerButtonStyle} onClick={() => navigate(`/production-orders/${encodeURIComponent(existing.production_order_id)}`)}>
          <ArrowLeft size={15} />
          Back to order
        </button>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title={editing ? `Edit ${orderId}` : 'New production order'}
        subtitle="Saving a draft copies the active bill of materials and routing so you can review them before release."
      >
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(editing && orderId ? `/production-orders/${encodeURIComponent(orderId)}` : '/production-orders')}>
          <ArrowLeft size={15} />
          Back
        </button>
      </PageHeader>

      <form onSubmit={onSubmit} style={cardStyle}>
        {formError ? <p style={errorStyle}>{formError}</p> : null}
        <div style={gridStyle}>
          <label style={fieldStyle}>
            Finished item
            <select style={inputStyle} value={itemId} onChange={(e) => setItemId(e.target.value)} required>
              <option value="">Select an item</option>
              {items.map((item) => (
                <option key={item.item_id} value={item.item_id}>
                  {item.item_id}{item.description ? ` — ${item.description}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            Planned quantity
            <input style={inputStyle} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </label>
          <label style={fieldStyle}>
            Sales order
            <select style={inputStyle} value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)}>
              <option value="">None</option>
              {salesOrderOptions.map((order) => (
                <option key={order.sales_order_id} value={order.sales_order_id}>
                  {order.sales_order_id}
                  {order.customer_id ? ` — ${order.customer_id}` : ''}
                  {order.customer_po_number ? ` · PO ${order.customer_po_number}` : ''}
                  {order.status ? ` · ${order.status}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            Warehouse
            <select style={inputStyle} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">None</option>
              {warehouseOptions.map((warehouse) => (
                <option key={warehouse.warehouse_id} value={warehouse.warehouse_id}>
                  {warehouse.code || warehouse.warehouse_id} — {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            Order date
            <input style={inputStyle} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
          </label>
          <label style={fieldStyle}>
            Start date
            <input style={inputStyle} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label style={fieldStyle}>
            Due date
            <input style={inputStyle} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label style={fieldStyle}>
            Currency
            <input style={inputStyle} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} required />
          </label>
          <label style={fieldStyle}>
            Transaction amount
            <input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {editing ? (
            <label style={fieldStyle}>
              Scrapped quantity
              <input style={inputStyle} type="number" min={0} value={scrappedQty} onChange={(e) => setScrappedQty(e.target.value)} />
            </label>
          ) : null}
        </div>
        <label style={{ ...fieldStyle, marginTop: 16 }}>
          Notes
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button type="submit" style={primaryButtonStyle} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save draft' : 'Create draft'}
          </button>
        </div>
      </form>
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow)',
}
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 'bold', color: 'var(--text-h)' }
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
  margin: '0 0 12px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
}
