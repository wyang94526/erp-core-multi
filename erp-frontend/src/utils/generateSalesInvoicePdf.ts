/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Printable customer invoice PDF (AR / sales invoice).
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ARInvoiceDetail } from '../types'

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

export function buildSalesInvoicePdfFilename(invoiceId: string): string {
  const safe = (invoiceId || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `Invoice-${safe}.pdf`
}

export function generateSalesInvoicePdf(detail: ARInvoiceDetail): void {
  const currency = (detail.currency || 'USD').trim() || 'USD'
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
  doc.text('INVOICE', pageWidth - marginX, y, { align: 'right' })
  y += 22

  doc.setDrawColor(21, 101, 192)
  doc.setLineWidth(1.5)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 24

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(detail.invoice_id, marginX, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Customer: ${detail.customer_name || detail.customer_id}`, marginX, y)
  doc.text(`Status: ${detail.display_status || detail.status}`, pageWidth / 2, y)
  y += 14
  doc.text(`Sales Order: ${detail.sales_order_id}`, marginX, y)
  doc.text(`Issue: ${formatDate(detail.issue_date)}`, pageWidth / 2, y)
  y += 14
  doc.text(`Due: ${formatDate(detail.due_date)}`, marginX, y)
  if (detail.payment_date) {
    doc.text(`Paid: ${formatDate(detail.payment_date)}`, pageWidth / 2, y)
  }
  y += 22

  const lineRows =
    (detail.lines || []).length > 0
      ? detail.lines.map((line) => [
          line.item_id,
          line.description || '—',
          String(line.quantity),
          formatMoney(line.unit_price, currency),
          formatMoney(line.line_subtotal, currency),
        ])
      : [['—', 'No line items', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Part #', 'Description', 'Qty', 'Unit Price', 'Subtotal']],
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
      fillColor: [21, 101, 192],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  })

  const afterTableY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40
  y = afterTableY + 20

  const summaryX = pageWidth - marginX - 220
  const rows: Array<[string, string]> = [
    ['Subtotal', formatMoney(detail.subtotal, currency)],
    ['Shipping / Freight', formatMoney(detail.freight_amount, currency)],
    ['Taxes', formatMoney(detail.tax_amount, currency)],
    ['Grand Total', formatMoney(detail.total_amount ?? detail.amount, currency)],
  ]
  rows.forEach(([label, value], idx) => {
    doc.setFont('helvetica', idx === rows.length - 1 ? 'bold' : 'normal')
    doc.setFontSize(idx === rows.length - 1 ? 11 : 10)
    doc.text(label, summaryX, y)
    doc.text(value, pageWidth - marginX, y, { align: 'right' })
    y += 14
  })

  if ((detail.payments || []).length > 0) {
    y += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
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
      headStyles: { fillColor: [21, 101, 192], textColor: [255, 255, 255] },
      margin: { left: marginX, right: marginX },
    })
  }

  doc.save(buildSalesInvoicePdfFilename(detail.invoice_id))
}
