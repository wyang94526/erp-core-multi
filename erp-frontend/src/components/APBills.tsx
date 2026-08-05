import React, { useEffect, useState } from 'react'
import { apBillService } from '../api/services'
import type { APBill } from '../types'
import { ApprovalPanel } from './ApprovalPanel'

function APBills() {
  const [bills, setBills] = useState<APBill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const handleMakePayment = async (billId: string) => {
    setPayingId(billId)
    try {
      await apBillService.makePayment(billId)
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
          <h1 style={pageTitleStyle}>Accounts Payable</h1>
          <p style={pageSubStyle}>Vendor bills generated from approved Purchase Orders</p>
        </div>
      </div>

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading AP bills...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : bills.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No AP bills found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Bill ID</th>
                  <th style={directoryThStyle}>Purchase Order ID</th>
                  <th style={directoryThStyle}>Vendor ID</th>
                  <th style={directoryThStyle}>Amount</th>
                  <th style={directoryThStyle}>Due Date</th>
                  <th style={directoryThStyle}>Status</th>
                  <th style={directoryThStyle}>Approval</th>
                  <th style={directoryThStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const colors = getStatusColors(bill.status)
                  return (
                    <tr key={bill.bill_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{bill.bill_id}</td>
                      <td style={directoryTdStyle}>{bill.purchase_order_id}</td>
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
                            onClick={() => handleMakePayment(bill.bill_id)}
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

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default APBills
