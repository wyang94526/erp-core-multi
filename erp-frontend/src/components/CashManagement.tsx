/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { cashReferenceHref, cashReferenceLabel, cashReferenceLinkStyle } from '../utils/cashReference'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { headerButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

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
  const [detailId, setDetailId] = useState<string | null>(null)
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
      return matchesSearch(
        values.q,
        tx.transaction_id,
        tx.entity_name,
        tx.reference_id,
        tx.bank_account_name,
        tx.bank_account_id,
        tx.type,
        tx.approval_status,
      )
    })
  }, [transactions, values.type, values.approval, values.date, values.q])

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
  }

  const detailTxn = transactions.find((t) => t.transaction_id === detailId) || null

  return (
    <div style={containerStyle}>
      <PageHeader title="Cash Management" subtitle="Chronological ledger of all cash inflows and outflows">
        <Link to="/bank-accounts" style={{ ...headerButtonStyle, textDecoration: 'none' }}>
          Manage bank accounts
        </Link>
      </PageHeader>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredTransactions.length} txn(s) · In ${formatCurrency(cashSummary.inflow)} · Out ${formatCurrency(cashSummary.outflow)} · Net ${formatCurrency(cashSummary.net)}`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar
        fields={CASH_FILTERS}
        searchPlaceholder="Search transaction, payee, reference, bank…"
        exportCount={filteredTransactions.length}
        onExport={() =>
          downloadCsv(
            csvFilename('cash-transactions'),
            ['Transaction ID', 'Date', 'Type', 'Payee / Payer', 'Reference ID', 'Bank Account', 'Amount', 'Approval'],
            filteredTransactions.map((tx) => [
              tx.transaction_id,
              tx.transaction_date,
              tx.type,
              tx.entity_name,
              tx.reference_id,
              tx.bank_account_name || tx.bank_account_id,
              tx.amount,
              tx.approval_status || 'DRAFT',
            ]),
          )
        }
      />

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
                  <SortableTh label="Payee / Payer" columnKey="entity_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Reference ID" columnKey="reference_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Bank Account" columnKey="bank_account_name" sortConfig={sortConfig} onRequestSort={requestSort} />
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
                  const referenceHref = cashReferenceHref(tx)
                  return (
                    <tr key={tx.transaction_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        <button
                          type="button"
                          style={idButtonStyle}
                          title="View transaction details"
                          onClick={() => setDetailId(tx.transaction_id)}
                        >
                          {tx.transaction_id}
                        </button>
                      </td>
                      <td style={directoryTdStyle}>{formatDateTime(tx.transaction_date)}</td>
                      <td style={directoryTdStyle}>
                        <span
                          style={{
                            ...typeBadgeStyle,
                            backgroundColor: isDeposit ? '#e8f5e9' : '#ffebee',
                            color: amountColor,
                          }}
                        >
                          {tx.type_label || tx.type}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>
                        <div style={{ fontWeight: 600 }}>{tx.entity_name || '—'}</div>
                        <div style={{ fontSize: 11, color: '#757575' }}>{tx.entity_role || (isDeposit ? 'Payer' : 'Payee')}</div>
                      </td>
                      <td style={directoryTdStyle}>
                        {referenceHref ? (
                          <Link
                            to={referenceHref}
                            style={cashReferenceLinkStyle}
                            title={cashReferenceLabel(tx)}
                          >
                            {tx.reference_id}
                          </Link>
                        ) : (
                          tx.reference_id || '—'
                        )}
                      </td>
                      <td style={directoryTdStyle}>{tx.bank_account_name || tx.bank_account_id || '—'}</td>
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

      {detailTxn ? (
        <div style={drawerOverlayStyle} onClick={() => setDetailId(null)}>
          <aside style={drawerStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, color: '#212121' }}>{detailTxn.transaction_id}</h3>
              <button type="button" style={approvalButtonStyle} onClick={() => setDetailId(null)}>
                Close
              </button>
            </div>
            <p style={{ margin: '8px 0 0', color: '#616161', fontSize: 13 }}>
              {detailTxn.type_label || detailTxn.type} · {formatCurrency(detailTxn.amount)}
            </p>

            <h4 style={drawerHeadingStyle}>Bank Information</h4>
            <dl style={metaListStyle}>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Bank Name</dt>
                <dd style={metaDdStyle}>{detailTxn.bank_name || '—'}</dd>
              </div>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Routing Number</dt>
                <dd style={metaDdStyle}>{detailTxn.routing_number || '—'}</dd>
              </div>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Account Number</dt>
                <dd style={metaDdStyle}>{detailTxn.account_number || detailTxn.account_number_masked || '—'}</dd>
              </div>
            </dl>

            <h4 style={drawerHeadingStyle}>Check / Instrument Details</h4>
            <dl style={metaListStyle}>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Check Date</dt>
                <dd style={metaDdStyle}>{formatDate(detailTxn.transaction_date)}</dd>
              </div>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Check #</dt>
                <dd style={metaDdStyle}>
                  {detailTxn.instrument_ref_no
                    ? `#${detailTxn.instrument_display_number || detailTxn.instrument_ref_no}`
                    : '—'}
                </dd>
              </div>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>Clearing Status</dt>
                <dd style={metaDdStyle}>{(detailTxn.clearing_status || 'CLEARED').replace(/_/g, ' ')}</dd>
              </div>
              <div style={metaItemStyle}>
                <dt style={metaDtStyle}>{detailTxn.entity_role || 'Counterparty'}</dt>
                <dd style={metaDdStyle}>{detailTxn.entity_name || '—'}</dd>
              </div>
            </dl>

            <h4 style={drawerHeadingStyle}>Linked Document</h4>
            {cashReferenceHref(detailTxn) ? (
              <Link to={cashReferenceHref(detailTxn)!} style={cashReferenceLinkStyle}>
                {detailTxn.reference_id}
              </Link>
            ) : (
              <span>{detailTxn.reference_id || '—'}</span>
            )}
          </aside>
        </div>
      ) : null}
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
  whiteSpace: 'nowrap',
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

const idButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1565c0',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
}

const drawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  zIndex: 40,
  display: 'flex',
  justifyContent: 'flex-end',
}

const drawerStyle: React.CSSProperties = {
  width: 'min(440px, 100%)',
  background: '#fff',
  height: '100%',
  padding: 24,
  overflowY: 'auto',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
}

const drawerHeadingStyle: React.CSSProperties = {
  margin: '20px 0 8px',
  fontSize: 13,
  fontWeight: 700,
  color: '#212121',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const metaListStyle: React.CSSProperties = {
  margin: 0,
}

const metaItemStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 8,
  fontSize: 13,
}

const metaDtStyle: React.CSSProperties = {
  minWidth: 120,
  color: '#757575',
  fontWeight: 600,
}

const metaDdStyle: React.CSSProperties = {
  margin: 0,
  color: '#212121',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default CashManagement
