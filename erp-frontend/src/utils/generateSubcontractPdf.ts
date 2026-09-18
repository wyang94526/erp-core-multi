/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Generate a printable vendor purchase attachment PDF for an approved Subcontract Order.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CalculatedComponentLine, SubcontractOrder } from '../types'

export type SubcontractVendorPdfInput = {
  sco: SubcontractOrder
  supplierName?: string | null
  productName?: string | null
  components: CalculatedComponentLine[]
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

function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })
}

export function buildSubcontractVendorPdfFilename(scoNumber: string): string {
  const safe = (scoNumber || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  return `SCO-${safe}-Vendor-Attachment.pdf`
}

export function generateSubcontractVendorPdf(input: SubcontractVendorPdfInput): void {
  const { sco, supplierName, productName, components } = input
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
  doc.text('SUBCONTRACT ORDER', pageWidth - marginX, y, { align: 'right' })
  y += 22

  doc.setDrawColor(168, 85, 247)
  doc.setLineWidth(1.5)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 24

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Subcontract Order # ${sco.sco_number}`, marginX, y)
  y += 20
  if (Number(sco.amendment_number || 0) > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Amendment ${sco.amendment_number}`, marginX, y)
    y += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Order Date: ${formatDate(sco.order_date)}`, marginX, y)
  doc.text(
    `Expected Return Date: ${formatDate(sco.expected_return_date)}`,
    pageWidth / 2,
    y,
  )
  y += 28

  // Vendor / Supplier
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Vendor / Supplier', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Supplier ID: ${sco.supplier_id || '—'}`, marginX, y)
  y += 14
  doc.text(`Supplier Name: ${supplierName?.trim() || '—'}`, marginX, y)
  y += 26

  // Order summary
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Order Summary', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Sales Order: ${sco.sales_order_id || '—'}`, marginX, y)
  y += 14
  doc.text(`Product Code: ${sco.item_id || '—'}`, marginX, y)
  y += 14
  doc.text(`Product Name: ${productName?.trim() || '—'}`, marginX, y)
  y += 14
  doc.text(`Quantity Ordered: ${formatQty(sco.quantity_ordered)}`, marginX, y)
  if (sco.document_total != null) {
    y += 14
    doc.text(`Document Total: ${Number(sco.document_total).toFixed(2)}`, marginX, y)
  }
  y += 14

  const notes = (sco.notes || '').trim() || 'None'
  const notesLines = doc.splitTextToSize(`Notes / Special Instructions: ${notes}`, pageWidth - marginX * 2)
  doc.text(notesLines, marginX, y)
  y += notesLines.length * 12 + 18

  // Component / kit breakdown
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Component / Kit Breakdown', marginX, y)
  y += 8

  const tableBody =
    components.length > 0
      ? components.map((c) => [
          c.component_item_id || '—',
          c.description?.trim() || '—',
          c.primary_vendor_sku?.trim() || '—',
          formatQty(c.quantity_per),
          formatQty(c.quantity_required),
        ])
      : [['—', 'No components found', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Item Code', 'Description', 'Vendor Part #', 'Qty/Unit', 'Total Required Qty']],
    body: tableBody,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 5,
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
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  })

  const finalY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40
  y = finalY + 24
  const pageHeight = doc.internal.pageSize.getHeight()

  if (sco.lines?.length) {
    sco.lines.forEach((line) => {
      if (y > pageHeight - 160) {
        doc.addPage()
        y = 56
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(30, 30, 30)
      doc.text(
        `Assembly ${line.line_number}: ${line.item_id}  qty ${formatQty(line.quantity_ordered)}  unit ${Number(line.unit_price || 0).toFixed(2)}`,
        marginX,
        y,
      )
      y += 10
      const chargeBody =
        line.charges?.length
          ? line.charges.map((charge) => [
              String(charge.line_no),
              charge.name,
              charge.is_margin ? '—' : String(charge.labor_minutes ?? '—'),
              charge.is_margin ? '—' : String(charge.sf_rate ?? '—'),
              Number(charge.cost_per_unit || 0).toFixed(2),
            ])
          : [['—', 'No cost sheet', '—', '—', '—']]
      autoTable(doc, {
        startY: y,
        head: [['#', 'Cost Component', 'Minutes', 'SF Rate', 'Cost/Unit']],
        body: chargeBody,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [147, 51, 234], textColor: [255, 255, 255] },
        margin: { left: marginX, right: marginX },
      })
      y = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 18
    })
  }

  // Keep signature block on one page when possible
  if (y > pageHeight - 120) {
    doc.addPage()
    y = 56
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Terms & Sign-off', marginX, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  const terms = doc.splitTextToSize(
    'Please process this subcontract purchase attachment according to the quantities and component kit listed above. Contact Grand-Tek Technology USA for any discrepancies before processing.',
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

  // Footer page numbers
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

  doc.save(buildSubcontractVendorPdfFilename(sco.sco_number))
}
