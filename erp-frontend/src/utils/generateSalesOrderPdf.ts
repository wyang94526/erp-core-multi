/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Generate a printable sales order PDF for an approved Sales Order.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Location, SalesOrder } from '../types'
import {
  companyFooterLine,
  drawBillShipBlocks,
  drawPdfLetterhead,
  PDF_BRAND_ALT_RGB,
  PDF_BRAND_RGB,
  type CompanyPdfBranding,
} from './pdfLetterhead'

export type SalesOrderPdfInput = {
  order: SalesOrder
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerContact?: string | null
  billTo?: Location | null
  shipTo?: Location | null
  itemDescriptions?: Record<string, string>
  branding?: CompanyPdfBranding | null
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

export function buildSalesOrderPdfFilename(salesOrderId: string): string {
  const safe = (salesOrderId || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `SO-${safe}.pdf`
}

export function generateSalesOrderPdf(input: SalesOrderPdfInput): void {
  const {
    order,
    customerName,
    customerEmail,
    customerPhone,
    customerContact,
    billTo,
    shipTo,
    itemDescriptions = {},
    branding,
  } = input
  const currency = (order.currency || 'USD').trim() || 'USD'
  const companyName = (branding?.profile.company_name || 'Grand-Tek Technology USA').trim()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  let y = drawPdfLetterhead(doc, branding, 'SALES ORDER')

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
  doc.text(
    `Contact: ${(order.buyer_contact_name || customerContact || '').trim() || '—'}`,
    marginX,
    y,
  )
  y += 14
  doc.text(
    `Email: ${(order.buyer_contact_email || customerEmail || '').trim() || '—'}`,
    marginX,
    y,
  )
  y += 14
  doc.text(`Phone: ${(customerPhone || '').trim() || '—'}`, marginX, y)
  y += 26

  y = drawBillShipBlocks(doc, billTo, shipTo, y, {
    bill: order.bill_to_location_id,
    ship: order.ship_to_location_id,
  })

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
      fillColor: PDF_BRAND_RGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: PDF_BRAND_ALT_RGB,
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
    `Please confirm this sales order according to the quantities, pricing, and shipping terms listed. Contact ${companyName} for any discrepancies before fulfillment.`,
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
      `${companyFooterLine(branding?.profile)} · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 24,
      { align: 'center' },
    )
  }

  doc.save(buildSalesOrderPdfFilename(order.sales_order_id))
}
