/**
 * Generate a printable vendor purchase attachment PDF for an approved Purchase Order.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PurchaseOrder } from '../types'

export type PurchaseOrderVendorPdfInput = {
  po: PurchaseOrder
  /** Optional SKU -> description map for line items */
  itemDescriptions?: Record<string, string>
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function formatMoney(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function buildPurchaseOrderVendorPdfFilename(poNumber: string): string {
  const safe = (poNumber || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `PO-${safe}-Vendor-Attachment.pdf`
}

export function generatePurchaseOrderVendorPdf(input: PurchaseOrderVendorPdfInput): void {
  const { po, itemDescriptions = {} } = input
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  let y = 48

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(40, 40, 40)
  doc.text('Grand-Tek Technology USA', marginX, y)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90, 90, 90)
  doc.text('PURCHASE ORDER', pageWidth - marginX, y, { align: 'right' })
  y += 22

  doc.setDrawColor(168, 85, 247)
  doc.setLineWidth(1.5)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 24

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`PO Number: ${po.po_number}`, marginX, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Order Date: ${formatDate(po.order_date)}`, marginX, y)
  doc.text(`Expected Delivery: ${formatDate(po.expected_delivery_date)}`, pageWidth / 2, y)
  y += 14
  doc.text(`Payment Terms: ${(po.payment_terms || '').trim() || '—'}`, marginX, y)
  y += 28

  // Vendor / Supplier
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Vendor / Supplier', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Supplier ID: ${po.supplier_id || '—'}`, marginX, y)
  y += 14
  doc.text(
    `Supplier Name: ${(po.supplier_name || '').trim() || '—'}`,
    marginX,
    y,
  )
  y += 26

  // Line items
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Line Items', marginX, y)
  y += 8

  const lineRows =
    po.items?.length > 0
      ? po.items.map((item) => [
          item.sku || '—',
          itemDescriptions[item.sku]?.trim() || '—',
          formatQty(item.quantity),
          formatMoney(item.unit_price),
          formatPercent(item.tax_rate),
          formatMoney(item.line_subtotal),
        ])
      : [['—', 'No line items', '—', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Item / SKU', 'Description', 'Quantity', 'Unit Price ($)', 'Tax Rate (%)', 'Line Subtotal ($)']],
    body: lineRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4,
      textColor: [40, 40, 40],
      lineColor: [210, 210, 210],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [147, 51, 234],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 246, 252],
    },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: {halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  })

  const afterTableY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40
  y = afterTableY + 24

  // Order summary
  const summaryWidth = 220
  const summaryX = pageWidth - marginX - summaryWidth
  const summaryRows: Array<[string, string, boolean?]> = [
    ['Subtotal (Excl. Tax)', formatMoney(po.subtotal)],
    ['Total Tax', formatMoney(po.total_tax)],
    ['Shipping & Handling', formatMoney(po.shipping_fee)],
  ]
  if (Number(po.discount_amount) > 0) {
    summaryRows.push(['Discount', `-${formatMoney(po.discount_amount)}`])
  }
  summaryRows.push(['Grand Total', formatMoney(po.grand_total), true])

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Order Summary', summaryX, y)
  y += 16

  for (const [label, value, emphasize] of summaryRows) {
    doc.setFont('helvetica', emphasize ? 'bold' : 'normal')
    doc.setFontSize(emphasize ? 11 : 10)
    doc.setTextColor(emphasize ? 30 : 60, emphasize ? 30 : 60, emphasize ? 30 : 60)
    doc.text(label, summaryX, y)
    doc.text(value, pageWidth - marginX, y, { align: 'right' })
    y += emphasize ? 18 : 14
  }

  y += 16

  // Notes
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Notes & Internal Comments', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(50, 50, 50)
  const notes = (po.notes || '').trim() || 'None'
  const notesLines = doc.splitTextToSize(notes, pageWidth - marginX * 2)
  doc.text(notesLines, marginX, y)
  y += notesLines.length * 12 + 28

  const pageHeight = doc.internal.pageSize.getHeight()
  if (y > pageHeight - 140) {
    doc.addPage()
    y = 56
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Terms & Sign-off', marginX, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  const terms = doc.splitTextToSize(
    'Please deliver goods according to the quantities, pricing, and expected delivery date on this purchase order. Acknowledge these terms upon acceptance. Contact Grand-Tek Technology USA for any discrepancies before processing.',
    pageWidth - marginX * 2,
  )
  doc.text(terms, marginX, y)
  y += terms.length * 11 + 28

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(10)
  doc.text('Authorized Signature: ________________________________', marginX, y)
  doc.text('Date: ____________________', pageWidth - marginX - 160, y)
  y += 28
  doc.setFontSize(9)
  doc.setTextColor(110, 110, 110)
  doc.text('Printed name / title: ________________________________', marginX, y)

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(
      `Grand-Tek Technology USA · Confidential · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 24,
      { align: 'center' },
    )
  }

  doc.save(buildPurchaseOrderVendorPdfFilename(po.po_number))
}
