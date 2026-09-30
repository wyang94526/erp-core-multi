/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Goods Receipts directory — PO / SCO receipts stay findable after the source
 * order is revised or removed.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { goodsReceiptService } from '../api/services'
import type { GoodsReceipt } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import {
  formatReceiptHeaderQty,
  formatReceiptMoney,
  goodsReceiptHref,
  goodsReceiptStatusColors,
  goodsReceiptStatusLabel,
  receiptLinkStyle,
  receiptQtyIsHomogeneous,
  receiptReceivedHint,
} from '../utils/goodsReceipts'
import { sourceOrderHref } from '../utils/cashReference'

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'source_type',
    label: 'Source',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All sources' },
      { value: 'PURCHASE_ORDER', label: 'Purchase order' },
      { value: 'SUBCONTRACT_ORDER', label: 'Subcontract order' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'POSTED', label: 'Posted' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'CANCELLED', label: 'Voided' },
    ],
  },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function sourceLabel(sourceType: string | null | undefined): string {
  const type = (sourceType || '').toUpperCase()
  if (type === 'SUBCONTRACT_ORDER') return 'Subcontract'
  if (type === 'PURCHASE_ORDER') return 'Purchase order'
  return sourceType || '—'
}

export function GoodsReceiptList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const { values } = useListFilterParams(FILTERS)

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['goodsReceipts'],
    queryFn: () => goodsReceiptService.list({ skip: 0, limit: 500 }),
  })

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (values.source_type !== 'ALL' && (row.source_type || '').toUpperCase() !== values.source_type) {
        return false
      }
      if (values.status !== 'ALL' && (row.status || '').toUpperCase() !== values.status) {
        return false
      }
      return matchesSearch(
        values.q,
        row.receipt_number,
        row.source_order_id,
        row.vendor_id,
        row.vendor_name,
        row.status,
        row.notes,
      )
    })
  }, [rows, values.source_type, values.status, values.q])

  useEffect(() => {
    setSkip(0)
  }, [values.source_type, values.status, values.q])

  const pageRows = filtered.slice(skip, skip + PAGE_SIZE)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      receipt_date: 'date',
      total_amount: 'number',
    },
  })

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Goods Receipts</h2>
          <p style={pageSubStyle}>
            Posted receipts (PU67- / UP72-) and their GRNI journals, including receipts whose
            source purchase order was later deleted.
          </p>
        </div>
      </header>

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search receipt, PO, vendor…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('goods-receipts'),
            ['Receipt #', 'Date', 'Source', 'Source document', 'Vendor', 'Status', 'Amount'],
            filtered.map((row) => [
              row.receipt_number,
              row.receipt_date,
              row.source_type,
              row.source_order_id,
              row.vendor_name || row.vendor_id,
              row.status,
              row.total_amount,
            ]),
          )
        }
      />

      {isLoading ? (
        <div style={emptyStyle}>Loading goods receipts…</div>
      ) : isError ? (
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to load goods receipts'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>No goods receipts found. Receive goods from an approved purchase order.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <SortableTh label="Receipt #" columnKey="receipt_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Date" columnKey="receipt_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Source document</th>
                  <th style={thStyle}>Vendor</th>
                  <th style={thStyle}>Status</th>
                  <SortableTh
                    label="Amount"
                    columnKey="total_amount"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                    style={{ textAlign: 'right' }}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row: GoodsReceipt) => {
                  const badge = goodsReceiptStatusColors(row.status)
                  const sourceHref = sourceOrderHref(row.source_type, row.source_order_id)
                  const qtyLabel = formatReceiptHeaderQty(row.lines)
                  const mixedQty = !receiptQtyIsHomogeneous(row.lines)
                  const hint = receiptReceivedHint(row.lines)
                  return (
                    <tr
                      key={row.id || row.receipt_number}
                      style={{ ...tbodyRowStyle, cursor: 'pointer' }}
                      onClick={() => navigate(goodsReceiptHref(row.receipt_number))}
                    >
                      <td style={tdStyle}>
                        <Link
                          to={goodsReceiptHref(row.receipt_number)}
                          style={receiptLinkStyle}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.receipt_number}
                        </Link>
                      </td>
                      <td style={tdStyle}>{formatDate(row.receipt_date)}</td>
                      <td style={tdStyle}>{sourceLabel(row.source_type)}</td>
                      <td style={tdStyle}>
                        {sourceHref ? (
                          <Link
                            to={sourceHref}
                            style={receiptLinkStyle}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.source_order_id}
                          </Link>
                        ) : (
                          row.source_order_id || '—'
                        )}
                      </td>
                      <td style={tdStyle}>{row.vendor_name || row.vendor_id || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ ...badgeStyle, backgroundColor: badge.bg, color: badge.text }}>
                          {row.status_label || goodsReceiptStatusLabel(row.status)}
                        </span>
                        {qtyLabel !== '—' ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text)',
                              marginTop: 4,
                              fontFamily: 'monospace',
                            }}
                            title={hint}
                          >
                            {mixedQty ? qtyLabel : `Qty ${qtyLabel}`}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatReceiptMoney(row.total_amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={pagerStyle}>
            <button
              type="button"
              style={pagerButtonStyle}
              disabled={skip === 0}
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>{formatPaginationLabel({ skip, pageCount: pageRows.length, total: filtered.length })}</span>
            <button
              type="button"
              style={pagerButtonStyle}
              disabled={skip + PAGE_SIZE >= filtered.length}
              onClick={() => setSkip(skip + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: 24,
  maxWidth: 1200,
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: CSSProperties = {
  marginBottom: 20,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 16,
}
const pageTitleStyle: CSSProperties = { margin: 0, fontSize: 28, fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: CSSProperties = { margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: CSSProperties = { borderBottom: '1px solid var(--border)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text)', verticalAlign: 'middle' }
const badgeStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
}
const pagerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  marginTop: 16,
}
const pagerButtonStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export default GoodsReceiptList
