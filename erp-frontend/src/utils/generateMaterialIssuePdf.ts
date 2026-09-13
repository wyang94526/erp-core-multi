/**
 * Printable kit shipping document for a subcontract material issue.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type {
  CalculatedComponentLine,
  MaterialIssue,
  SubcontractOrder,
  Supplier,
} from '../types'

export type MaterialIssueShippingPdfInput = {
  sco: SubcontractOrder
  issue: MaterialIssue
  supplier?: Supplier | null
  productName?: string | null
  kitLines: CalculatedComponentLine[]
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

function kitLookup(
  kitLines: CalculatedComponentLine[],
  itemId: string,
  scoLineId?: number | null,
): CalculatedComponentLine | undefined {
  return (
    kitLines.find(
      (row) =>
        row.component_item_id === itemId &&
        (scoLineId == null || row.sco_line_id == null || row.sco_line_id === scoLineId),
    ) || kitLines.find((row) => row.component_item_id === itemId)
  )
}

function supplierAddress(supplier?: Supplier | null): string[] {
  if (!supplier) return ['—']
  const lines = [
    supplier.company_name,
    supplier.address_line1,
    supplier.address_line2,
    [supplier.city, supplier.state, supplier.postal_code].filter(Boolean).join(', '),
    supplier.country,
  ]
  return lines.map((line) => (line || '').trim()).filter(Boolean)
}

export function buildMaterialIssuePdfFilename(scoNumber: string, issueId: string): string {
  const sco = (scoNumber || 'UNKNOWN').replace(/[^\w.-]+/g, '-')
  const issue = (issueId || 'ISSUE').replace(/[^\w.-]+/g, '-')
  return `SCO-${sco}-Issue-${issue}-Shipping.pdf`
}

export function generateMaterialIssueShippingPdf(input: MaterialIssueShippingPdfInput): void {
  const { sco, issue, supplier, productName, kitLines } = input
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 48
  let y = 48

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(40, 40, 40)
  doc.text('Grand-Tek Technology USA', marginX, y)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90, 90, 90)
  doc.text('MATERIAL ISSUE / SHIPPING DOCUMENT', pageWidth - marginX, y, { align: 'right' })
  y += 22

  doc.setDrawColor(168, 85, 247)
  doc.setLineWidth(1.5)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 22

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Issue ${issue.issue_id}`, marginX, y)
  y += 18
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Issue Date: ${formatDate(issue.issue_date)}`, marginX, y)
  doc.text(`Subcontract Order: ${sco.sco_number}`, pageWidth / 2, y)
  y += 14
  doc.text(`Sales Order: ${sco.sales_order_id || '—'}`, marginX, y)
  doc.text(`Expected FG Return: ${formatDate(sco.expected_return_date)}`, pageWidth / 2, y)
  y += 24

  const colMid = pageWidth / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Ship From', marginX, y)
  doc.text('Ship To (Subcontractor)', colMid, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const fromLines = [
    'Grand-Tek Technology USA',
    'Kit shipment for outside processing',
  ]
  const toLines = [
    ...supplierAddress(supplier),
    supplier?.supplier_id ? `Vendor ID: ${supplier.supplier_id}` : '',
    supplier?.phone_number ? `Phone: ${supplier.phone_number}` : '',
  ].filter(Boolean)
  const blockLines = Math.max(fromLines.length, toLines.length)
  for (let i = 0; i < blockLines; i += 1) {
    if (fromLines[i]) doc.text(fromLines[i], marginX, y)
    if (toLines[i]) doc.text(toLines[i], colMid, y)
    y += 13
  }
  y += 12

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Finished assembly to process', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const assemblies =
    sco.lines && sco.lines.length > 0
      ? sco.lines.map(
          (line) =>
            `${line.item_id}  ·  qty ${formatQty(line.quantity_ordered)}${
              line.so_line_number ? `  ·  SO line ${line.so_line_number}` : ''
            }`,
        )
      : [`${sco.item_id}  ·  qty ${formatQty(sco.quantity_ordered)}`]
  if (productName?.trim()) {
    assemblies.unshift(productName.trim())
  }
  assemblies.forEach((line) => {
    doc.text(line, marginX, y)
    y += 13
  })
  y += 10

  const notes = (issue.notes || sco.notes || '').trim()
  if (notes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Notes', marginX, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const noteLines = doc.splitTextToSize(notes, pageWidth - marginX * 2)
    doc.text(noteLines, marginX, y)
    y += noteLines.length * 12 + 10
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Packing list — components shipped', marginX, y)
  y += 8

  const body =
    issue.lines.length > 0
      ? issue.lines.map((line, index) => {
          const kit = kitLookup(kitLines, line.component_item_id, line.sco_line_id)
          return [
            String(index + 1),
            line.component_item_id,
            kit?.description?.trim() || '—',
            kit?.primary_vendor_sku?.trim() || '—',
            formatQty(line.quantity_issued),
            kit?.uom?.trim() || 'EA',
          ]
        })
      : [['—', 'No issue lines', '—', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item Code', 'Description', 'Vendor P/N', 'Qty Shipped', 'UOM']],
    body,
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
      fillColor: [25, 118, 210],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: {
      0: { cellWidth: 28 },
      4: { halign: 'right' },
      5: { cellWidth: 40 },
    },
    margin: { left: marginX, right: marginX },
  })

  y = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 28
  if (y > pageHeight - 140) {
    doc.addPage()
    y = 56
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Receipt acknowledgement', marginX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  const terms = doc.splitTextToSize(
    'The subcontractor acknowledges receipt of the kit listed above for outside processing against the subcontract order. Report any shortage or damage to Grand-Tek Technology USA before starting work.',
    pageWidth - marginX * 2,
  )
  doc.text(terms, marginX, y)
  y += terms.length * 11 + 26

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(10)
  doc.text('Received by: ________________________________', marginX, y)
  doc.text('Date: ____________________', pageWidth - marginX - 160, y)
  y += 26
  doc.setFontSize(9)
  doc.setTextColor(110, 110, 110)
  doc.text('Printed name / title: ________________________________', marginX, y)

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(
      `Grand-Tek Technology USA · Kit shipping document · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 24,
      { align: 'center' },
    )
  }

  doc.save(buildMaterialIssuePdfFilename(sco.sco_number, issue.issue_id))
}
