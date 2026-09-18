/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link } from 'react-router-dom'
import {
  BadgeDollarSign,
  CircleAlert,
  Landmark,
  Receipt,
} from 'lucide-react'
import type { DashboardAggregates, MetricDrillKey, QuickAction } from '../../types/dashboard'
import { formatCurrency, formatCurrencyPrecise } from '../../hooks/useDashboardData'
import MetricCard from './MetricCard'
import QuickActions from './QuickActions'
import StatusBadge from './StatusBadge'
import {
  directoryTableStyle,
  directoryTbodyRowStyle,
  directoryTdStyle,
  directoryThStyle,
  directoryTheadRowStyle,
  emptyStateStyle,
  linkStyle,
  metricsGridStyle,
  sectionStyle,
  sectionTitleStyle,
  twoColStyle,
} from './dashboardStyles'
import { cashReferenceHref, cashReferenceLabel } from '../../utils/cashReference'

type FinanceDashboardProps = {
  data: DashboardAggregates
  actions: QuickAction[]
  activeMetric: MetricDrillKey | null
  onMetricClick: (key: MetricDrillKey) => void
}

export default function FinanceDashboard({
  data,
  actions,
  activeMetric,
  onMetricClick,
}: FinanceDashboardProps) {
  const pendingDocs = [
    ...data.pendingArApprovals.map((inv) => ({
      id: inv.invoice_id,
      kind: 'AR' as const,
      party: inv.customer_id,
      amount: inv.amount,
      status: inv.approval_status || 'PENDING_APPROVAL',
      to: '/accounts-receivable',
    })),
    ...data.pendingApApprovals.map((bill) => ({
      id: bill.bill_id,
      kind: 'AP' as const,
      party: bill.vendor_id,
      amount: bill.amount,
      status: bill.approval_status || 'PENDING_APPROVAL',
      to: '/accounts-payable',
    })),
  ].slice(0, 8)

  return (
    <>
      <div style={metricsGridStyle}>
        <MetricCard
          label="Accounts Receivable"
          value={formatCurrency(data.arOutstanding)}
          subtext="Unpaid / partial invoices"
          accent="blue"
          icon={Landmark}
          active={activeMetric === 'ar_outstanding'}
          onClick={() => onMetricClick('ar_outstanding')}
        />
        <MetricCard
          label="Accounts Payable"
          value={formatCurrency(data.apOutstanding)}
          subtext="Unpaid / partial bills"
          accent="teal"
          icon={Receipt}
          active={activeMetric === 'ap_outstanding'}
          onClick={() => onMetricClick('ap_outstanding')}
        />
        <MetricCard
          label="Overdue Invoices"
          value={data.overdueInvoices}
          accent="red"
          icon={CircleAlert}
          active={activeMetric === 'overdue_invoices'}
          onClick={() => onMetricClick('overdue_invoices')}
        />
        <MetricCard
          label="Monthly Margin"
          value={formatCurrency(data.monthlyMargin)}
          subtext="MTD sales − MTD purchasing"
          accent="green"
          icon={BadgeDollarSign}
          active={activeMetric === 'monthly_margin'}
          onClick={() => onMetricClick('monthly_margin')}
        />
      </div>

      <QuickActions actions={actions} />

      <div style={twoColStyle}>
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Recent Payments</h3>
          {data.recentPayments.length === 0 ? (
            <div style={emptyStateStyle}>No cash transactions found.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Date</th>
                    <th style={directoryThStyle}>Type</th>
                    <th style={directoryThStyle}>Reference</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((txn) => {
                    const href = cashReferenceHref(txn)
                    return (
                    <tr key={txn.transaction_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        {txn.transaction_date
                          ? new Date(txn.transaction_date).toLocaleDateString()
                          : '—'}
                      </td>
                      <td style={directoryTdStyle}>{txn.type}</td>
                      <td style={directoryTdStyle}>
                        {href ? (
                          <Link to={href} style={linkStyle} title={cashReferenceLabel(txn)}>
                            {txn.reference_id}
                          </Link>
                        ) : (
                          txn.reference_id
                        )}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {formatCurrencyPrecise(Number(txn.amount) || 0)}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Link to="/cash-management" style={{ ...linkStyle, fontSize: '0.875rem', fontWeight: 600 }}>
              Open cash management →
            </Link>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Invoices Pending Approval</h3>
          {pendingDocs.length === 0 ? (
            <div style={emptyStateStyle}>No invoices or bills pending approval.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Type</th>
                    <th style={directoryThStyle}>Document</th>
                    <th style={directoryThStyle}>Party</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingDocs.map((doc) => (
                    <tr key={`${doc.kind}-${doc.id}`} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{doc.kind}</td>
                      <td style={directoryTdStyle}>
                        <Link to={doc.to} style={linkStyle}>
                          {doc.id}
                        </Link>
                      </td>
                      <td style={directoryTdStyle}>{doc.party}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {formatCurrencyPrecise(Number(doc.amount) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
