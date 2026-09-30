/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * ItemList Component
 * Displays a list of items in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { itemService } from '../api/services'
import type { Item } from '../types'
import { useEffect, useState } from 'react'
import { csvFilename, downloadCsv } from '../utils/csvExport'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { PaginationControls } from './PaginationControls'
import { itemTypeLabel } from '../utils/itemTypes'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'

const ITEM_FILTERS: FilterField[] = []

export function ItemList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10
  const { values } = useListFilterParams(ITEM_FILTERS)
  const search = values.q.trim()

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: ['items', skip, limit, search],
    queryFn: () => itemService.listItemsPage(skip, limit, { q: search || undefined }),
    placeholderData: (previous) => previous,
  })

  const items = data?.items ?? []
  const total = data?.pagination.total ?? 0

  const { items: sortedItems, requestSort, sortConfig } = useSortableData(items, {
    columnTypes: {
      unit_price: 'number',
    },
  })

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (skip + items.length < total) {
      setSkip(skip + limit)
    }
  }

  useEffect(() => {
    setSkip(0)
  }, [search])

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Items</h2>
          <p style={pageSubStyle}>View, create and manage your item catalog (SKU master)</p>
        </div>
        <button
          onClick={() => navigate('/items/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Add Item
        </button>
      </header>

      <ListFilterBar
        fields={ITEM_FILTERS}
        searchPlaceholder="Search item ID, part number, description…"
        exportCount={total}
        onExport={async () => {
          const page = await itemService.listItemsPage(0, 2000, { q: search || undefined })
          downloadCsv(
            csvFilename('items'),
            ['Item ID', 'Customer Part Number', 'Description', 'UOM', 'Type', 'Unit Price'],
            page.items.map((row) => [
              row.item_id,
              row.customer_part_number,
              row.description,
              row.uom,
              itemTypeLabel(row.item_type),
              row.unit_price,
            ]),
          )
        }}
      />

      <div style={dashboardSectionStyle}>
        {isError ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
            <p>Error loading items:</p>
            <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        ) : isLoading && items.length === 0 ? (
          <div style={emptyStateWrapperStyle}>
            <p>Loading items...</p>
          </div>
        ) : items.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No items found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="Item ID" columnKey="item_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Customer Part Number" columnKey="customer_part_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Description" columnKey="description" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="UOM" columnKey="uom" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Type" columnKey="item_type" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Unit Price" columnKey="unit_price" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item: Item) => (
                    <tr key={item.item_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{item.item_id}</td>
                      <td style={directoryTdStyle}>{item.customer_part_number}</td>
                      <td style={directoryTdStyle}>{item.description || '-'}</td>
                      <td style={directoryTdStyle}>{item.uom || '—'}</td>
                      <td style={directoryTdStyle}>{itemTypeLabel(item.item_type)}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <button
                          onClick={() => navigate(`/items/${item.item_id}`)}
                          style={{ ...directoryActionButtonStyle, backgroundColor: '#e3f2fd', color: '#1565c0', border: '1px solid #bbdefb', marginRight: '6px' }}
                        >
                          View
                        </button>
                        <button
                          onClick={() => navigate(`/items/${item.item_id}/edit`)}
                          style={{ ...directoryActionButtonStyle, backgroundColor: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2' }}
                        >
                          Edit
                        </button>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}

        <PaginationControls
          skip={skip}
          pageCount={items.length}
          total={total}
          onPrevious={handlePreviousPage}
          onNext={handleNextPage}
        />
        {isFetching && !isLoading ? (
          <p style={{ ...pageSubStyle, marginTop: 8 }}>Updating results…</p>
        ) : null}
      </div>
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

// Formats a numeric unit price as USD currency, falling back to $0.00
// when the value is undefined or null (e.g. missing mock/legacy data).
function formatCurrency(value: number | null | undefined): string {
  const amount = value ?? 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
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

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
}

const directoryEmptyTdWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

export default ItemList
