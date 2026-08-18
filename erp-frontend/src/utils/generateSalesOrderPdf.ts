/**
 * Generate a printable sales order PDF for an approved Sales Order.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Location, SalesOrder } from '../types'

export type SalesOrderPdfInput = {
  order: SalesOrder
  customerName?: string | null
  billTo?: Location | null
  shipTo?: Location | null
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

function formatMoney(
  value: number | null | undefined,
  currency = 'USD',
  fractionDigits = 2,
): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  try {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  } catch {
    return `${currency} ${n.toFixed(fractionDigits)}`
  }
}

function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })
}

function formatLocation(loc: Location | null | undefined, fallbackId: string): string[] {
  if (!loc) return [fallbackId || '—']
  const lines: string[] = []
  if (loc.location_name?.trim()) lines.push(loc.location_name.trim())
  if (loc.attention_to?.trim()) lines.push(`Attn: ${loc.attention_to.trim()}`)
  else if (loc.contact_person?.trim()) lines.push(`Attn: ${loc.contact_person.trim()}`)
  if (loc.address_line1?.trim()) lines.push(loc.address_line1.trim())
  const cityLine = [loc.city, loc.state_province || loc.state, loc.postal_code]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(', ')
  if (loc.address_line2?.trim()) lines.push(loc.address_line2.trim())
  if (cityLine) lines.push(cityLine)
  if (loc.country?.trim()) lines.push(loc.country.trim())
  if (lines.length === 0) lines.push(loc.location_id || fallbackId || '—')
  return lines
}

export function buildSalesOrderPdfFilename(salesOrderId: string): string {
  const safe = (salesOrderId || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `SO-${safe}.pdf`
}

export function generateSalesOrderPdf(input: SalesOrderPdfInput): void {
  const {
    order,
    customerName,
    billTo,
    shipTo,
    itemDescriptions = {},
  } = input
  const currency = (order.currency || 'USD').trim() || 'USD'
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  let y = 48

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(40, 40, 40)
  doc.text('Grand-Tek Technology USA', marginX, y)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90, 90, 90)
  doc.text('SALES ORDER', pageWidth - marginX, y, { align: 'right' })
  y += 22

  doc.setDrawColor(168, 85, 247)
  doc.setLineWidth(1.5)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 24

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Sales Order: ${order.sales_order_id}`, marginX, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Order Date: ${formatDate(order.order_date)}`, marginX, y)
  doc.text(`Status: ${(order.status || '—').replace(/_/g, ' ')}`, pageWidth / 2, y)
  y += 14
  doc.text(`Customer PO: ${(order.customer_po_number || '').trim() || '—'}`, marginX, y)
  doc.text(`PO Revision: ${order.po_revision_number ?? '—'}`, pageWidth / 2, y)
  y += 14
  doc.text(`Payment Terms: ${(order.payment_terms || '').trim() || '—'}`, marginX, y)
  doc.text(`Freight Terms: ${(order.freight_terms || '').trim() || '—'}`, pageWidth / 2, y)
  y += 14
  doc.text(`Shipping Method: ${(order.shipping_method || '').trim() || '—'}`, marginX, y)
  doc.text(`Currency: ${currency}`, pageWidth / 2, y)
  y += 28

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Customer', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Customer ID: ${order.customer_id || '—'}`, marginX, y)
  y += 14
  doc.text(`Customer Name: ${customerName?.trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Buyer: ${(order.buyer_contact_name || '').trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Buyer Email: ${(order.buyer_contact_email || '').trim() || '—'}`, marginX, y)
  y += 26

  const colWidth = (pageWidth - marginX * 2 - 24) / 2
  const leftX = marginX
  const rightX = marginX + colWidth + 24

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Bill To', leftX, y)
  doc.text('Ship To', rightX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const wrap = (lines: string[]) =>
    lines.flatMap((line) => doc.splitTextToSize(line, colWidth) as string[])
  const billLines = wrap(formatLocation(billTo, order.bill_to_location_id))
  const shipLines = wrap(formatLocation(shipTo, order.ship_to_location_id))
  const maxLines = Math.max(billLines.length, shipLines.length, 1)
  for (let i = 0; i < maxLines; i += 1) {
    if (billLines[i]) doc.text(billLines[i], leftX, y)
    if (shipLines[i]) doc.text(shipLines[i], rightX, y)
    y += 13
  }
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Line Items', marginX, y)
  y += 8

  const lineRows =
    order.items?.length > 0
      ? order.items.map((item) => [
          String(item.line_number ?? '—'),
          item.item_id || '—',
          itemDescriptions[item.item_id]?.trim() || '—',
          formatQty(item.quantity_ordered),
          formatMoney(item.unit_price, currency, 4),
          formatMoney(item.tax_amount, currency),
          formatMoney(item.total_amount, currency),
        ])
      : [['—', '—', 'No line items', '—', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Line', 'Item / SKU', 'Description', 'Qty', 'Unit Price', 'Tax', 'Line Total']],
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
      0: { cellWidth: 36 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  })

  const afterTableY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40
  y = afterTableY + 24

  const summaryWidth = 220
  const summaryX = pageWidth - marginX - summaryWidth
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Order Total', summaryX, y)
  y += 16
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Grand Total', summaryX, y)
  doc.text(formatMoney(order.total_amount, currency), pageWidth - marginX, y, { align: 'right' })
  y += 28

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
    'Please confirm this sales order according to the quantities, pricing, and shipping terms listed. Contact Grand-Tek Technology USA for any discrepancies before fulfillment.',
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

  doc.save(buildSalesOrderPdfFilename(order.sales_order_id))
}
