/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apBillService } from '../api/services'
import type { APBill } from '../types'
import { billDetailHref, sourceOrderHref } from '../utils/cashReference'
import { ApprovalPanel } from './ApprovalPanel'
import { RecordCashPaymentDialog, type CashPaymentChoice } from './RecordCashPaymentDialog'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'

const AP_FILTERS: FilterField[] = [
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

function APBills() {
  const [bills, setBills] = useState<APBill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pendingPay, setPendingPay] = useState<APBill | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const focusBill = (searchParams.get('bill') || '').trim()
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(AP_FILTERS)

  const loadBills = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apBillService.listBills()
      setBills(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AP bills')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBills()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const filteredBills = useMemo(() => {
    return bills.filter((bill) => {
      if (focusBill && bill.bill_id === focusBill) return true
      if (values.status !== 'ALL' && bill.status !== values.status) return false
      if (values.approval !== 'ALL') {
        const approval = (bill.approval_status || 'DRAFT').toUpperCase()
        if (approval !== values.approval.toUpperCase()) return false
      }
      if (values.due === 'overdue') {
        if (!(bill.due_date && bill.due_date < today && bill.status !== 'Paid')) return false
      }
      if (values.due === 'upcoming') {
        if (!(bill.due_date && bill.due_date >= today && bill.status !== 'Paid')) return false
      }
      return true
    })
  }, [bills, values.status, values.approval, values.due, today, focusBill])

  const { items: sortedBills, requestSort, sortConfig } = useSortableData(filteredBills, {
    columnTypes: {
      amount: 'number',
      due_date: 'date',
    },
  })

  const handleMakePayment = async (bill: APBill, choice: CashPaymentChoice) => {
    setPayingId(bill.bill_id)
    try {
      await apBillService.makePayment(bill.bill_id, choice)
      setPendingPay(null)
      await loadBills()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to make payment')
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
          <h1 style={pageTitleStyle}>AP Aging & Payments</h1>
          <p style={pageSubStyle}>Vendor bills generated from approved Purchase Orders</p>
        </div>
      </div>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredBills.length} bill(s) match current filters`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar fields={AP_FILTERS} />

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading AP bills...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : filteredBills.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No AP bills found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Bill ID" columnKey="bill_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Purchase Order ID" columnKey="purchase_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Vendor ID" columnKey="vendor_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Amount" columnKey="amount" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Due Date" columnKey="due_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Approval" columnKey="approval_status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={directoryThStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedBills.map((bill) => {
                  const colors = getStatusColors(bill.status)
                  const focused = Boolean(focusBill) && bill.bill_id === focusBill
                  const orderId = bill.source_order_id || bill.purchase_order_id
                  const orderHref = sourceOrderHref(bill.source_type, orderId)
                  return (
                    <tr
                      key={bill.bill_id}
                      style={{
                        ...directoryTbodyRowStyle,
                        backgroundColor: focused ? '#e3f2fd' : undefined,
                      }}
                    >
                      <td style={directoryTdStyle}>
                        <Link to={billDetailHref(bill.bill_id)} style={idLinkStyle} title="View bill details">
                          {bill.bill_id}
                        </Link>
                      </td>
                      <td style={directoryTdStyle}>
                        {orderHref && orderId ? (
                          <Link to={orderHref} style={idLinkStyle} title="Open source order">
                            {orderId}
                          </Link>
                        ) : (
                          orderId || '—'
                        )}
                      </td>
                      <td style={directoryTdStyle}>{bill.vendor_id}</td>
                      <td style={directoryTdStyle}>{formatCurrency(bill.amount)}</td>
                      <td style={directoryTdStyle}>{formatDate(bill.due_date)}</td>
                      <td style={directoryTdStyle}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {bill.status}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>{bill.approval_status || 'DRAFT'}</td>
                      <td style={directoryTdStyle}>
                        <button
                          style={{
                            ...directoryActionButtonStyle,
                            backgroundColor: '#e3f2fd',
                            color: '#1565c0',
                            border: '1px solid #bbdefb',
                            marginRight: '6px',
                          }}
                          onClick={() => setSelectedId(bill.bill_id)}
                        >
                          Approval
                        </button>
                        {bill.status !== 'Paid' && bill.approval_status === 'APPROVED' && (
                          <button
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#2196F3',
                              color: 'white',
                              border: 'none',
                              opacity: payingId === bill.bill_id ? 0.6 : 1,
                              cursor: payingId === bill.bill_id ? 'not-allowed' : 'pointer',
                            }}
                            disabled={payingId === bill.bill_id}
                            onClick={() => setPendingPay(bill)}
                          >
                            {payingId === bill.bill_id ? 'Processing...' : 'Make Payment'}
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
          module="ap-bills"
          documentId={selectedId}
          approvalStatus={bills.find((b) => b.bill_id === selectedId)?.approval_status}
          onStatusChange={loadBills}
        />
      )}

      <RecordCashPaymentDialog
        open={Boolean(pendingPay)}
        title={`Pay ${pendingPay?.bill_id || ''}`}
        subtitle="Choose the bank account and payment instrument for this disbursement."
        amount={pendingPay?.amount}
        confirmLabel="Make Payment"
        submitting={Boolean(pendingPay && payingId === pendingPay.bill_id)}
        onCancel={() => setPendingPay(null)}
        onConfirm={(choice) => pendingPay && void handleMakePayment(pendingPay, choice)}
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

const idLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  fontWeight: 700,
  textDecoration: 'none',
}

const statusBadgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  display: 'inline-block',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default APBills
