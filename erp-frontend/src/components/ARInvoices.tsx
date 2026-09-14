import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { arInvoiceService } from '../api/services'
import type { ARInvoice } from '../types'
import { ApprovalPanel } from './ApprovalPanel'
import { RecordCashPaymentDialog, type CashPaymentChoice } from './RecordCashPaymentDialog'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'
import { invoiceDetailHref } from '../utils/cashReference'

const AR_FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'Unpaid', label: 'Unpaid' },
      { value: 'Partial', label: 'Partial' },
      { value: 'Paid', label: 'Paid' },
    ],
  },
  {
    key: 'due',
    label: 'Due',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'upcoming', label: 'Upcoming' },
    ],
  },
  {
    key: 'approval',
    label: 'Approval',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
]

function ARInvoices() {
  const [invoices, setInvoices] = useState<ARInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pendingPay, setPendingPay] = useState<ARInvoice | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const focusInvoice = (searchParams.get('invoice') || '').trim()
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(AR_FILTERS)

  const loadInvoices = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await arInvoiceService.listInvoices()
      setInvoices(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AR invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInvoices()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (focusInvoice && inv.invoice_id === focusInvoice) return true
      if (values.status !== 'ALL' && inv.status !== values.status) return false
      if (values.approval !== 'ALL') {
        const approval = (inv.approval_status || 'DRAFT').toUpperCase()
        if (approval !== values.approval.toUpperCase()) return false
      }
      if (values.due === 'overdue') {
        if (!(inv.due_date && inv.due_date < today && inv.status !== 'Paid')) return false
      }
      if (values.due === 'upcoming') {
        if (!(inv.due_date && inv.due_date >= today && inv.status !== 'Paid')) return false
      }
      return true
    })
  }, [invoices, values.status, values.approval, values.due, today, focusInvoice])

  const { items: sortedInvoices, requestSort, sortConfig } = useSortableData(filteredInvoices, {
    columnTypes: {
      amount: 'number',
      due_date: 'date',
    },
  })

  const handleReceivePayment = async (invoice: ARInvoice, choice: CashPaymentChoice) => {
    setPayingId(invoice.invoice_id)
    try {
      await arInvoiceService.receivePayment(invoice.invoice_id, choice)
      setPendingPay(null)
      await loadInvoices()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to receive payment')
    } finally {
      setPayingId(null)
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
  }

  return (
    <div style={containerStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>AR Aging & Collections</h1>
          <p style={pageSubStyle}>
            Open customer receivables. Approved Sales Invoices post here (invoice id matches INV-YYYY-NNNN when created from O2C).
          </p>
        </div>
      </div>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredInvoices.length} invoice(s) match current filters`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar fields={AR_FILTERS} />

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading AR invoices...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : filteredInvoices.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No AR invoices found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Invoice ID" columnKey="invoice_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Sales Order ID" columnKey="sales_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Customer ID" columnKey="customer_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Amount" columnKey="amount" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Due Date" columnKey="due_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Approval" columnKey="approval_status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={directoryThStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.map((inv) => {
                  const colors = getStatusColors(inv.status)
                  const focused = Boolean(focusInvoice) && inv.invoice_id === focusInvoice
                  return (
                    <tr
                      key={inv.invoice_id}
                      style={{
                        ...directoryTbodyRowStyle,
                        backgroundColor: focused ? '#e3f2fd' : undefined,
                      }}
                    >
                      <td style={directoryTdStyle}>
                        <Link to={invoiceDetailHref(inv.invoice_id)} style={idLinkStyle} title="View invoice details">
                          {inv.invoice_id}
                        </Link>
                      </td>
                      <td style={directoryTdStyle}>{inv.sales_order_id}</td>
                      <td style={directoryTdStyle}>{inv.customer_id}</td>
                      <td style={directoryTdStyle}>{formatCurrency(inv.amount)}</td>
                      <td style={directoryTdStyle}>{formatDate(inv.due_date)}</td>
                      <td style={directoryTdStyle}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>{inv.approval_status || 'DRAFT'}</td>
                      <td style={directoryTdStyle}>
                        <button
                          style={{
                            ...directoryActionButtonStyle,
                            backgroundColor: '#e3f2fd',
                            color: '#1565c0',
                            border: '1px solid #bbdefb',
                            marginRight: '6px',
                          }}
                          onClick={() => setSelectedId(inv.invoice_id)}
                        >
                          Approval
                        </button>
                        {inv.status !== 'Paid' && inv.approval_status === 'APPROVED' && (
                          <button
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#2196F3',
                              color: 'white',
                              border: 'none',
                              opacity: payingId === inv.invoice_id ? 0.6 : 1,
                              cursor: payingId === inv.invoice_id ? 'not-allowed' : 'pointer',
                            }}
                            disabled={payingId === inv.invoice_id}
                            onClick={() => setPendingPay(inv)}
                          >
                            {payingId === inv.invoice_id ? 'Processing...' : 'Receive Payment'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <ApprovalPanel
          module="ar-invoices"
          documentId={selectedId}
          approvalStatus={invoices.find((i) => i.invoice_id === selectedId)?.approval_status}
          onStatusChange={loadInvoices}
        />
      )}

      <RecordCashPaymentDialog
        open={Boolean(pendingPay)}
        title={`Receive payment for ${pendingPay?.invoice_id || ''}`}
        subtitle="Choose the bank account and payment instrument for this deposit."
        amount={pendingPay?.amount}
        confirmLabel="Receive Payment"
        submitting={Boolean(pendingPay && payingId === pendingPay.invoice_id)}
        onCancel={() => setPendingPay(null)}
        onConfirm={(choice) => pendingPay && void handleReceivePayment(pendingPay, choice)}
      />
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    Unpaid: { bg: '#ffebee', text: '#c62828' },
    Partial: { bg: '#fff3e0', text: '#e65100' },
    Paid: { bg: '#e8f5e9', text: '#2e7d32' },
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
  borderBottom: '1px solid #ddd',
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
  color: '#212121',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: '#616161',
}

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid #ddd',
  backgroundColor: '#f5f5f5',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: '#212121',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: '#424242',
  verticalAlign: 'middle',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const statusBadgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  display: 'inline-block',
}

const idLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  fontWeight: 700,
  textDecoration: 'none',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default ARInvoices
