import React, { useEffect, useMemo, useState } from 'react'
import { cashTransactionService } from '../api/services'
import type { CashTransaction } from '../types'
import { ApprovalPanel } from './ApprovalPanel'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'

const CASH_FILTERS: FilterField[] = [
  {
    key: 'type',
    label: 'Type',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'Check Deposit', label: 'Check Deposit (In)' },
      { value: 'Check Issue', label: 'Check Issue (Out)' },
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
  {
    key: 'date',
    label: 'Date',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'this_month', label: 'This Month' },
      { value: 'ytd', label: 'YTD' },
    ],
  },
]

function matchesCashDate(dateStr: string | null, filter: string): boolean {
  if (filter === 'all') return true
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  if (filter === 'this_month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }
  if (filter === 'ytd') {
    return d.getFullYear() === now.getFullYear() && d <= now
  }
  return true
}

function CashManagement() {
  const [transactions, setTransactions] = useState<CashTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(CASH_FILTERS)

  const loadTransactions = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await cashTransactionService.listTransactions()
      setTransactions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cash transactions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTransactions()
  }, [])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (values.type !== 'ALL' && tx.type !== values.type) return false
      if (values.approval !== 'ALL') {
        const approval = (tx.approval_status || 'DRAFT').toUpperCase()
        if (approval !== values.approval.toUpperCase()) return false
      }
      if (!matchesCashDate(tx.transaction_date, values.date)) return false
      return true
    })
  }, [transactions, values.type, values.approval, values.date])

  const cashSummary = useMemo(() => {
    const inflow = filteredTransactions
      .filter((t) => t.type === 'Check Deposit')
      .reduce((s, t) => s + Number(t.amount || 0), 0)
    const outflow = filteredTransactions
      .filter((t) => t.type === 'Check Issue')
      .reduce((s, t) => s + Number(t.amount || 0), 0)
    return { inflow, outflow, net: inflow - outflow }
  }, [filteredTransactions])

  const { items: sortedTransactions, requestSort, sortConfig } = useSortableData(filteredTransactions, {
    columnTypes: {
      transaction_date: 'date',
      amount: 'number',
    },
  })

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toLocaleString()
  }

  return (
    <div style={containerStyle}>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>Cash Management</h1>
          <p style={pageSubStyle}>Chronological ledger of all cash inflows and outflows</p>
        </div>
      </div>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredTransactions.length} txn(s) · In ${formatCurrency(cashSummary.inflow)} · Out ${formatCurrency(cashSummary.outflow)} · Net ${formatCurrency(cashSummary.net)}`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar fields={CASH_FILTERS} />

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading cash transactions...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : filteredTransactions.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No cash transactions found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Transaction ID" columnKey="transaction_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Date" columnKey="transaction_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Type" columnKey="type" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Reference ID" columnKey="reference_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Bank Account" columnKey="bank_account_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Amount" columnKey="amount" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                  <SortableTh label="Approval" columnKey="approval_status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={directoryThStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map((tx) => {
                  const isDeposit = tx.type === 'Check Deposit'
                  const amountColor = isDeposit ? '#2e7d32' : '#c62828'
                  const sign = isDeposit ? '+' : '-'
                  return (
                    <tr key={tx.transaction_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{tx.transaction_id}</td>
                      <td style={directoryTdStyle}>{formatDateTime(tx.transaction_date)}</td>
                      <td style={directoryTdStyle}>
                        <span
                          style={{
                            ...typeBadgeStyle,
                            backgroundColor: isDeposit ? '#e8f5e9' : '#ffebee',
                            color: amountColor,
                          }}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>{tx.reference_id}</td>
                      <td style={directoryTdStyle}>{tx.bank_account_id || '—'}</td>
                      <td
                        style={{
                          ...directoryTdStyle,
                          textAlign: 'right',
                          fontWeight: 'bold',
                          color: amountColor,
                        }}
                      >
                        {sign}
                        {formatCurrency(tx.amount)}
                      </td>
                      <td style={directoryTdStyle}>{tx.approval_status || 'DRAFT'}</td>
                      <td style={directoryTdStyle}>
                        <button
                          style={approvalButtonStyle}
                          onClick={() => setSelectedId(tx.transaction_id)}
                        >
                          Approval
                        </button>
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
          module="cash-transactions"
          documentId={selectedId}
          approvalStatus={
            transactions.find((t) => t.transaction_id === selectedId)?.approval_status
          }
          onStatusChange={loadTransactions}
        />
      )}
    </div>
  )
}

// ==========================================
// STYLES
// ==========================================

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

const typeBadgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  display: 'inline-block',
}

const approvalButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'inherit',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default CashManagement
