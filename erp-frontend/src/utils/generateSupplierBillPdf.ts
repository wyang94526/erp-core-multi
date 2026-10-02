/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Printable vendor bill PDF (AP / supplier invoice).
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { APBillDetail, Supplier } from '../types'
import { downloadPdf } from './pdfDownload'
import {
  companyFooterLine,
  drawBillShipBlocks,
  drawPdfLetterhead,
  PDF_BRAND_ALT_RGB,
  PDF_BRAND_RGB,
  type CompanyPdfBranding,
} from './pdfLetterhead'

export type SupplierBillPdfInput = {
  detail: APBillDetail
  branding?: CompanyPdfBranding | null
  vendor?: Pick<Supplier, 'contact_name' | 'contact_email' | 'phone_number'> | null
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

function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  try {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

function formatQty(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)))
}

export function buildSupplierBillPdfFilename(billId: string): string {
  const safe = (billId || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `Bill-${safe}.pdf`
}

export function generateSupplierBillPdf(input: SupplierBillPdfInput): void {
  const { detail, branding, vendor } = input
  const currency = (detail.currency || 'USD').trim() || 'USD'
  const companyName = (branding?.profile.company_name || 'Grand-Tek Technology USA').trim()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  const sourceOrder = detail.source_order_id || detail.purchase_order_id || '—'
  const receiptIds = (detail.goods_receipts || [])
    .map((row) => row.receipt_number)
    .filter(Boolean)
    .join(', ')
  let y = drawPdfLetterhead(doc, branding, 'SUPPLIER INVOICE')

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Bill: ${detail.bill_id}`, marginX, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Issue Date: ${formatDate(detail.issue_date)}`, marginX, y)
  doc.text(`Status: ${detail.display_status || detail.status || '—'}`, pageWidth / 2, y)
  y += 14
  doc.text(`Source Order: ${sourceOrder}`, marginX, y)
  doc.text(`Due Date: ${formatDate(detail.due_date)}`, pageWidth / 2, y)
  y += 14
  doc.text(`Payment Terms: ${(detail.payment_terms || '').trim() || '—'}`, marginX, y)
  doc.text(`Currency: ${currency}`, pageWidth / 2, y)
  y += 14
  if (receiptIds) {
    doc.text(`Goods Receipt: ${receiptIds}`, marginX, y)
    y += 14
  }
  if (detail.vendor_invoice_number) {
    doc.text(`Vendor Invoice: ${detail.vendor_invoice_number}`, marginX, y)
    y += 14
  }
  if (detail.payment_date) {
    doc.text(`Paid: ${formatDate(detail.payment_date)}`, marginX, y)
    y += 14
  }
  y += 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Vendor / Supplier', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Supplier ID: ${detail.vendor_id || '—'}`, marginX, y)
  y += 14
  doc.text(`Supplier Name: ${(detail.vendor_name || '').trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Contact: ${(vendor?.contact_name || '').trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Email: ${(vendor?.contact_email || detail.vendor_email || '').trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Phone: ${(vendor?.phone_number || '').trim() || '—'}`, marginX, y)
  y += 26

  y = drawBillShipBlocks(doc, branding?.profile.bill_to, branding?.profile.ship_to, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Line Items', marginX, y)
  y += 8

  const lineRows =
    (detail.lines || []).length > 0
      ? detail.lines.map((line, index) => [
          String(index + 1),
          line.item_id || '—',
          line.description || '—',
          formatQty(line.quantity),
          formatMoney(line.unit_price, currency),
          formatMoney(line.line_subtotal, currency),
        ])
      : [['—', '—', 'No line items', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Line', 'Item / SKU', 'Description', 'Qty', 'Unit Price', 'Line Total']],
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
    },
    margin: { left: marginX, right: marginX },
  })

  const afterTableY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40
  y = afterTableY + 24

  const summaryWidth = 220
  const summaryX = pageWidth - marginX - summaryWidth
  const rows: Array<[string, string, boolean]> = [
    ['Subtotal', formatMoney(detail.subtotal, currency), false],
    ['Shipping / Freight', formatMoney(detail.freight_amount, currency), false],
    ['Taxes', formatMoney(detail.tax_amount, currency), false],
    ['Grand Total', formatMoney(detail.total_amount ?? detail.amount, currency), true],
  ]
  rows.forEach(([label, value, emphasize]) => {
    doc.setFont('helvetica', emphasize ? 'bold' : 'normal')
    doc.setFontSize(emphasize ? 12 : 10)
    doc.setTextColor(emphasize ? 30 : 60, emphasize ? 30 : 60, emphasize ? 30 : 60)
    doc.text(label, summaryX, y)
    doc.text(value, pageWidth - marginX, y, { align: 'right' })
    y += emphasize ? 18 : 14
  })

  if ((detail.payments || []).length > 0) {
    y += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(30, 30, 30)
    doc.text('Payments', marginX, y)
    y += 8
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Method / Ref', 'Amount', 'Balance']],
      body: detail.payments.map((p) => [
        formatDate(p.payment_date),
        `${p.method} ${p.reference}`,
        formatMoney(p.amount_applied, currency),
        formatMoney(p.unapplied_balance, currency),
      ]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: PDF_BRAND_RGB, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: PDF_BRAND_ALT_RGB },
      margin: { left: marginX, right: marginX },
    })
    y = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y
  }

  const pageHeight = doc.internal.pageSize.getHeight()
  if (y > pageHeight - 100) {
    doc.addPage()
    y = 56
  } else {
    y += 28
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Notes', marginX, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  const notes = doc.splitTextToSize(
    `This bill reflects goods or services received. Contact ${companyName} Accounts Payable for any discrepancies.`,
    pageWidth - marginX * 2,
  )
  doc.text(notes, marginX, y)

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

  downloadPdf(doc, buildSupplierBillPdfFilename(detail.bill_id))
}
