/**
 * Admin utility: view TIPTOP CSV loader mapping as a dry-run.
 * Route: /admin/data-import
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type RefObject } from 'react'
import { dataImportService } from '../api/services'
import type {
  DataImportAccount,
  DataImportBomLine,
  DataImportCustomer,
  DataImportItem,
  DataImportPreview,
  DataImportSupplier,
  DataImportVendorMapping,
} from '../api/services'
import { useAuth } from '../context/AuthContext'

type Tab = 'customers' | 'suppliers' | 'items' | 'bom' | 'accounts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'customers', label: 'Customers' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'items', label: 'Items' },
  { id: 'bom', label: 'BOM' },
  { id: 'accounts', label: 'Chart of Accounts' },
]

const CUSTOMER_COLUMNS: (keyof DataImportCustomer)[] = [
  'customer_id',
  'customer_number_ext',
  'company_name',
  'tax_id_type',
  'tax_id',
  'industry_type',
  'facility_type',
  'website',
  'primary_contact_name',
  'primary_email',
  'primary_phone',
  'currency',
  'credit_limit',
  'payment_terms',
  'preferred_incoterms',
  'preferred_shipping_method',
  'tax_exempt',
  'tax_exempt_certificate_id',
  'status',
  'created_at',
  'updated_at',
]

const SUPPLIER_COLUMNS: (keyof DataImportSupplier)[] = [
  'supplier_id',
  'company_name',
  'contact_name',
  'contact_email',
  'phone_number',
  'address_line1',
  'city',
  'state',
  'postal_code',
  'country',
  'vendor_number_ext',
  'payment_terms',
  'status',
  'vendor_type',
  'tax_id',
  'tax_document_type',
  'is_overseas',
  'currency',
  'ap_account_id',
  'payment_method',
  'incoterms',
  'incoterm_location',
  'country_of_origin',
  'bank_name',
  'swift_code',
  'iban_account_number',
  'bank_address',
  'intermediary_bank_name',
  'intermediary_swift_code',
  'intermediary_routing_aba',
  'lead_time_days',
  'work_center_id',
  'consignment_stock_loc_id',
  'standard_scrap_rate',
  'iso_certified',
  'qc_status',
  'notes',
  'address_line2',
  'created_at',
  'updated_at',
]

const ITEM_COLUMNS: (keyof DataImportItem)[] = [
  'item_id',
  'customer_part_number',
  'description',
  'uom',
  'unit_price',
  'on_hand_quantity',
  'wip_quantity',
  'is_outside_processed',
  'is_purchase_item',
  'is_subcontract_assembly',
  'is_raw_material',
]

const VENDOR_MAPPING_COLUMNS: (keyof DataImportVendorMapping)[] = [
  'mapping_id',
  'supplier_id',
  'item_id',
  'vendor_sku',
  'unit_cost',
  'minimum_order_qty',
  'lead_time_days',
  'is_primary_vendor',
  'created_at',
]

const BOM_COLUMNS: (keyof DataImportBomLine)[] = [
  'bom_id',
  'bom_header_id',
  'parent_item_id',
  'component_item_id',
  'component_code',
  'quantity_per',
  'item_type',
  'scrap_factor',
  'yield_loss_percentage',
  'version_no',
  'status',
  'created_at',
]

const ACCOUNT_COLUMNS: (keyof DataImportAccount)[] = [
  'account_code',
  'account_name',
  'account_type',
  'type_basis',
]

function emptyCell(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return <span style={muted}>—</span>
  }
  return String(value)
}

function renderCustomerCell(row: DataImportCustomer, col: keyof DataImportCustomer) {
  if (col === 'customer_id') {
    return <code>{row.customer_id}</code>
  }
  if (col === 'status') {
    return <StatusChip status={row.status} />
  }
  if (col === 'tax_id_type' && row.tax_id_type) {
    return <span style={chip}>{row.tax_id_type}</span>
  }
  if (col === 'tax_exempt') {
    return row.tax_exempt ? 'true' : 'false'
  }
  if (col === 'created_at' || col === 'updated_at') {
    return emptyCell(row[col])
  }
  const value = row[col]
  if (typeof value === 'string' || typeof value === 'number' || value == null) {
    return emptyCell(value)
  }
  return emptyCell(null)
}

function renderSupplierCell(row: DataImportSupplier, col: keyof DataImportSupplier) {
  if (col === 'supplier_id') {
    return <code>{row.supplier_id}</code>
  }
  if (col === 'vendor_type') {
    return <span style={chip}>{row.vendor_type}</span>
  }
  if (col === 'tax_document_type' && row.tax_document_type) {
    return <span style={chip}>{row.tax_document_type}</span>
  }
  if (col === 'is_overseas') {
    return boolCell(row.is_overseas)
  }
  if (col === 'iso_certified') {
    return row.iso_certified ? 'true' : 'false'
  }
  if (col === 'created_at' || col === 'updated_at') {
    return emptyCell(row[col])
  }
  const value = row[col]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return emptyCell(value)
  }
  return emptyCell(null)
}

function boolCell(value: boolean | undefined) {
  return value ? 'true' : 'false'
}

function schemaValue(value: unknown) {
  if (typeof value === 'boolean') {
    return boolCell(value)
  }
  if (typeof value === 'string' || typeof value === 'number' || value == null) {
    return emptyCell(value)
  }
  return emptyCell(null)
}

function renderItemCell(row: DataImportItem, col: keyof DataImportItem) {
  if (col === 'item_id' || col === 'customer_part_number') {
    return <code>{String(row[col] ?? '')}</code>
  }
  if (
    col === 'is_outside_processed' ||
    col === 'is_purchase_item' ||
    col === 'is_subcontract_assembly' ||
    col === 'is_raw_material'
  ) {
    return boolCell(row[col])
  }
  return schemaValue(row[col])
}

function renderVendorMappingCell(row: DataImportVendorMapping, col: keyof DataImportVendorMapping) {
  if (col === 'supplier_id' || col === 'item_id' || col === 'vendor_sku') {
    return row[col] ? <code>{String(row[col])}</code> : emptyCell(null)
  }
  if (col === 'is_primary_vendor') {
    return boolCell(row.is_primary_vendor)
  }
  return schemaValue(row[col])
}

function renderBomCell(row: DataImportBomLine, col: keyof DataImportBomLine) {
  if (col === 'parent_item_id' || col === 'component_item_id') {
    return <code>{String(row[col] ?? '')}</code>
  }
  return schemaValue(row[col])
}

function renderAccountCell(row: DataImportAccount, col: keyof DataImportAccount) {
  if (col === 'account_code') {
    return <code>{row.account_code}</code>
  }
  if (col === 'account_type') {
    return <span style={chip}>{row.account_type}</span>
  }
  if (col === 'type_basis') {
    return row.type_basis === 'description' ? (
      <span style={chip}>from name</span>
    ) : (
      <span style={{ ...chip, background: '#fff8e1', color: '#f57f17' }}>from code</span>
    )
  }
  return schemaValue(row[col])
}

export default function DataImportPreview() {
  const { hasPermission } = useAuth()
  const canView = hasPermission('admin:manage')
  const [tab, setTab] = useState<Tab>('customers')
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['data-import-preview'],
    queryFn: () => dataImportService.preview(),
    enabled: canView,
  })

  const upload = useMutation({
    mutationFn: (files: File[]) => dataImportService.upload(files),
    onSuccess: async () => {
      setUploadError(null)
      await queryClient.invalidateQueries({ queryKey: ['data-import-preview'] })
    },
    onError: (err: unknown) => {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    },
  })

  if (!canView) {
    return (
      <div style={pageStyle}>
        <h2 style={headingStyle}>CSV Import Preview</h2>
        <p style={subStyle}>You need the admin:manage permission to view this utility.</p>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div style={headerRow}>
        <div>
          <h2 style={headingStyle}>CSV Import Preview</h2>
          <p style={subStyle}>
            Dry-run of the TIPTOP basic-data loader. Upload the CSVs onto this server, then review
            the mapped records. Nothing is written to ERP tables.
          </p>
        </div>
        <button type="button" style={primaryBtn} onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh dry-run'}
        </button>
      </div>

      <UploadPanel
        data={data}
        fileRef={fileRef}
        busy={upload.isPending}
        error={uploadError}
        onPick={() => fileRef.current?.click()}
        onFiles={(files) => {
          if (files.length) upload.mutate(files)
        }}
      />

      {isLoading && <p style={muted}>Checking import folder…</p>}
      {isError && (
        <p style={errorStyle}>{error instanceof Error ? error.message : 'Failed to load preview'}</p>
      )}

      {data?.ready && <PreviewBody data={data} tab={tab} onTab={setTab} />}
    </div>
  )
}

const FILE_LABELS: Record<string, string> = {
  customers: 'Customers (客戶)',
  suppliers: 'Suppliers (供應商)',
  items: 'Items (料件)',
  bom: 'BOM',
  accounts: 'Chart of Accounts (科目)',
}

const CORE_FILE_KEYS = ['customers', 'suppliers', 'items', 'bom'] as const
const FILE_KEYS = [...CORE_FILE_KEYS, 'accounts'] as const

function UploadPanel({
  data,
  fileRef,
  busy,
  error,
  onPick,
  onFiles,
}: {
  data: DataImportPreview | undefined
  fileRef: RefObject<HTMLInputElement | null>
  busy: boolean
  error: string | null
  onPick: () => void
  onFiles: (files: File[]) => void
}) {
  const missing = data?.missing ?? [...CORE_FILE_KEYS]
  return (
    <div style={uploadBox}>
      <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--text)' }}>
        Files are stored in the server import folder
        {data?.data_dir ? (
          <>
            : <code>{data.data_dir}</code>
          </>
        ) : (
          '.'
        )}{' '}
        This works on OCI — no laptop path is required.
      </p>
      <ul style={fileList}>
        {FILE_KEYS.map((key) => {
          const info = data?.files?.[key]
          const optional = key === 'accounts'
          return (
            <li key={key}>
              {info ? (
                <>
                  <strong>{FILE_LABELS[key]}</strong>: {info.name} ({formatSize(info.size)})
                </>
              ) : (
                <>
                  <strong>{FILE_LABELS[key]}</strong>:{' '}
                  {optional ? (
                    <span style={muted}>optional — not uploaded</span>
                  ) : (
                    <span style={errorStyle}>missing</span>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.zip,text/csv,application/zip"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          onFiles(files)
        }}
      />
      <button type="button" style={primaryBtn} onClick={onPick} disabled={busy}>
        {busy ? 'Uploading…' : 'Upload CSVs or zip'}
      </button>
      {missing.length > 0 && (
        <p style={{ ...muted, margin: '10px 0 0' }}>
          Upload the four TIPTOP exports (or a zip). Optionally add chartOfAccount.csv. Recognized
          names include 客戶 / 供應商 / 料件 / BOM / 科目.
        </p>
      )}
      {error && <p style={errorStyle}>{error}</p>}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function PreviewBody({
  data,
  tab,
  onTab,
}: {
  data: DataImportPreview
  tab: Tab
  onTab: (tab: Tab) => void
}) {
  const counts = data.counts
  const vendorMappings =
    data.vendor_mappings ?? data.items.flatMap((item) => item.vendor_mappings ?? [])
  return (
    <>
      <div style={banner}>
        <strong>Dry-run only.</strong> Review mapped records below before running the loader.
      </div>

      <div style={statRow}>
        <Stat label="Customers" value={counts.customers} hint={`${counts.customers_with_address} with address`} />
        <Stat label="Suppliers" value={counts.suppliers} hint={`${counts.suppliers_with_address} with address`} />
        <Stat label="Items" value={counts.items} />
        <Stat label="BOM lines" value={counts.bom} />
        <Stat label="Accounts" value={counts.accounts ?? 0} />
        <Stat label="Warnings" value={counts.warnings} warn={counts.warnings > 0} />
      </div>

      <p style={muted}>
        Source folder: <code>{data.data_dir}</code>
        {data.source_files.customers ? ` · ${data.source_files.customers}` : ''}
      </p>

      {data.warnings.length > 0 && (
        <div style={warnBox}>
          <strong>Warnings</strong>
          <ul style={warnList}>
            {data.warnings.map((row, idx) => (
              <li key={`${row.entity}-${row.id}-${idx}`}>
                {row.entity} {row.id ? `${row.id}: ` : ''}
                {row.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={tabsStyle}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            style={{ ...tabBtn, ...(tab === item.id ? tabActive : {}) }}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'customers' && (
        <>
          <p style={muted}>
            Columns match the <code>customers</code> table. Empty cells are not present in the TIPTOP
            CSV. <code>tax_id_type</code> is inferred from the tax ID format. Addresses load into{' '}
            <code>customerlocations</code> below.
          </p>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {CUSTOMER_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.customers.map((row) => (
                  <tr key={row.customer_id}>
                    {CUSTOMER_COLUMNS.map((col) => (
                      <td key={col} style={td}>
                        {renderCustomerCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={subHeading}>customerlocations</h3>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>location_id</th>
                  <th style={th}>customer_id</th>
                  <th style={th}>location_type</th>
                  <th style={th}>location_code</th>
                  <th style={th}>location_name</th>
                  <th style={th}>attention_to</th>
                  <th style={th}>address_line1</th>
                  <th style={th}>city</th>
                  <th style={th}>state</th>
                  <th style={th}>postal_code</th>
                  <th style={th}>country</th>
                  <th style={th}>contact_person</th>
                  <th style={th}>contact_email</th>
                  <th style={th}>contact_phone</th>
                  <th style={th}>tax_id</th>
                  <th style={th}>shipping_instructions</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.flatMap((row) =>
                  row.locations.length
                    ? row.locations.map((loc) => (
                        <tr key={loc.location_id}>
                          <td style={td}>
                            <code>{loc.location_id}</code>
                          </td>
                          <td style={td}>
                            <code>{row.customer_id}</code>
                          </td>
                          <td style={td}>
                            <span style={chip}>{loc.location_type}</span>
                          </td>
                          <td style={td}>{loc.location_code || '—'}</td>
                          <td style={td}>{loc.location_name || '—'}</td>
                          <td style={td}>{loc.attention_to || '—'}</td>
                          <td style={td}>{loc.address_line1 || '—'}</td>
                          <td style={td}>{loc.city || '—'}</td>
                          <td style={td}>{loc.state || '—'}</td>
                          <td style={td}>{loc.postal_code || '—'}</td>
                          <td style={td}>{loc.country || '—'}</td>
                          <td style={td}>{loc.contact_person || '—'}</td>
                          <td style={td}>{loc.contact_email || '—'}</td>
                          <td style={td}>{loc.contact_phone || '—'}</td>
                          <td style={td}>{loc.tax_id || '—'}</td>
                          <td style={td}>{loc.shipping_instructions || '—'}</td>
                        </tr>
                      ))
                    : [
                        <tr key={`${row.customer_id}-none`}>
                          <td style={td} colSpan={16}>
                            <span style={muted}>
                              {row.customer_id}: no Bill-To/Ship-To address in CSV
                            </span>
                          </td>
                        </tr>,
                      ],
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <p style={muted}>
            Columns match the <code>suppliers</code> table. Empty cells are not present in the TIPTOP
            CSV. <code>is_overseas</code> and <code>tax_document_type</code> follow the address country;
            <code>pmc55</code>/<code>pmc56</code> map to SWIFT and remittance account when present.
          </p>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {SUPPLIER_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.suppliers.map((row) => (
                  <tr key={row.supplier_id}>
                    {SUPPLIER_COLUMNS.map((col) => (
                      <td key={col} style={td}>
                        {renderSupplierCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'items' && (
        <>
          <p style={muted}>
            Columns match the <code>items</code> table. Vendor cost/lead time loads into{' '}
            <code>vendoritemmappings</code> below.
          </p>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {ITEM_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.item_id}>
                    {ITEM_COLUMNS.map((col) => (
                      <td key={col} style={td}>
                        {renderItemCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={subHeading}>vendoritemmappings</h3>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {VENDOR_MAPPING_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendorMappings.length === 0 ? (
                  <tr>
                    <td style={td} colSpan={VENDOR_MAPPING_COLUMNS.length}>
                      <span style={muted}>No primary vendor (ima54) in the item CSV</span>
                    </td>
                  </tr>
                ) : (
                  vendorMappings.map((row) => (
                    <tr key={`${row.supplier_id}-${row.item_id}`}>
                      {VENDOR_MAPPING_COLUMNS.map((col) => (
                        <td key={col} style={td}>
                          {renderVendorMappingCell(row, col)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'bom' && (
        <>
          <p style={muted}>
            Columns match <code>itembomcomponents</code> plus the version header. TIPTOP has no
            revision field, so the loader creates <code>itembomheaders</code> version 1 (active).{' '}
            <code>bom_id</code>, <code>bom_header_id</code>, and <code>created_at</code> are assigned
            on insert.
          </p>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {BOM_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.bom.map((row) => (
                  <tr key={`${row.parent_item_id}-${row.component_item_id}`}>
                    {BOM_COLUMNS.map((col) => (
                      <td key={col} style={td}>
                        {renderBomCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <>
          <p style={muted}>
            Columns match the <code>chart_of_accounts</code> table. The CSV has code and name only.
            <code>account_type</code> is inferred from the account name, with the 1xxx–9xxx code
            range as fallback (<code>type_basis</code>).
          </p>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {ACCOUNT_COLUMNS.map((col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.accounts ?? []).length === 0 ? (
                  <tr>
                    <td style={td} colSpan={ACCOUNT_COLUMNS.length}>
                      <span style={muted}>No chartOfAccount.csv in the import folder</span>
                    </td>
                  </tr>
                ) : (
                  (data.accounts ?? []).map((row) => (
                    <tr key={row.account_code}>
                      {ACCOUNT_COLUMNS.map((col) => (
                        <td key={col} style={td}>
                          {renderAccountCell(row, col)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: number
  hint?: string
  warn?: boolean
}) {
  return (
    <div style={{ ...statCard, ...(warn ? statWarn : {}) }}>
      <div style={statValue}>{value}</div>
      <div style={statLabel}>{label}</div>
      {hint ? <div style={muted}>{hint}</div> : null}
    </div>
  )
}

const subHeading: React.CSSProperties = {
  margin: '20px 0 8px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--text-h)',
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' ? { background: '#e8f5e9', color: '#2e7d32' } : { background: '#fff8e1', color: '#f57f17' }
  return <span style={{ ...chip, ...tone }}>{status}</span>
}

const pageStyle: React.CSSProperties = { maxWidth: '1400px' }
const tableWrap: React.CSSProperties = { overflowX: 'auto' }
const headingStyle: React.CSSProperties = { margin: '0 0 4px', color: 'var(--text-h)' }
const subStyle: React.CSSProperties = {
  margin: '0 0 16px',
  color: 'var(--text)',
  fontSize: '14px',
}
const headerRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  marginBottom: '8px',
}
const banner: React.CSSProperties = {
  background: '#e3f2fd',
  color: '#0d47a1',
  borderRadius: '8px',
  padding: '10px 14px',
  fontSize: '13px',
  marginBottom: '16px',
}
const uploadBox: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '14px 16px',
  marginBottom: '16px',
  background: 'var(--bg)',
}
const fileList: React.CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: '18px',
  fontSize: '13px',
  color: 'var(--text)',
}
const statRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '10px',
  marginBottom: '12px',
}
const statCard: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '12px 14px',
  background: 'var(--bg)',
}
const statWarn: React.CSSProperties = { borderColor: '#ffcc80', background: '#fff8e1' }
const statValue: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: 'var(--text-h)' }
const statLabel: React.CSSProperties = { fontSize: '13px', color: 'var(--text)' }
const warnBox: React.CSSProperties = {
  border: '1px solid #ffe082',
  background: '#fffde7',
  borderRadius: '8px',
  padding: '12px 14px',
  margin: '8px 0 16px',
  fontSize: '13px',
}
const warnList: React.CSSProperties = { margin: '8px 0 0', paddingLeft: '18px' }
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
  flexWrap: 'wrap',
}
const tabBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'var(--text-h)',
}
const tabActive: React.CSSProperties = {
  background: 'var(--text-h)',
  color: '#fff',
  borderColor: 'transparent',
}
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  padding: '8px',
  color: 'var(--text-h)',
}
const td: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  padding: '8px',
  verticalAlign: 'top',
  color: 'var(--text)',
}
const muted: React.CSSProperties = { color: 'var(--text)', fontSize: '12px' }
const chip: React.CSSProperties = {
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: '10px',
  background: '#eceff1',
  color: '#37474f',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: '13px',
  whiteSpace: 'nowrap',
}
const errorStyle: React.CSSProperties = { color: '#c62828' }
