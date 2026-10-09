/**
 * @author: Wendy Yang
 * @date: 2026-10-09
 *
 * Journal voucher PDF matching the TIPTOP Journal Entry print layout,
 * with company letterhead.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ChartOfAccount, JournalEntry } from '../types'
import { journalDisplayId } from './journalEntries'
import { downloadPdf } from './pdfDownload'
import {
  companyFooterLine,
  drawPdfLetterhead,
  PDF_BRAND_ALT_RGB,
  type CompanyPdfBranding,
} from './pdfLetterhead'

export type JournalPdfLine = {
  account_code: string
  account_name: string
  description?: string | null
  debit: number
  credit: number
  currency?: string | null
}

export type JournalPdfInput = {
  journalNumber: string
  postingDate: string | null
  period?: string | null
  reference?: string | null
  description: string
  postingStatus?: string | null
  approvalStatus?: string | null
  lines: JournalPdfLine[]
  branding?: CompanyPdfBranding | null
}

function moneyAmount(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatJournalPdfDate(value: string | null | undefined): string {
  const text = (value || '').trim()
  if (!text) return '—'
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return text
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

export function buildJournalEntryPdfFilename(journalNumber: string, postingDate?: string | null): string {
  const number = (journalNumber || 'JOURNAL').replace(/[^\w.-]+/g, '-')
  const datePart = formatJournalPdfDate(postingDate).replaceAll('/', '')
  return datePart && datePart !== '—' ? `JE-${number}-${datePart}.pdf` : `JE-${number}.pdf`
}

export function journalEntryToPdfInput(
  entry: JournalEntry,
  accounts: ChartOfAccount[] = [],
  branding?: CompanyPdfBranding | null,
): JournalPdfInput {
  const byId = new Map(accounts.map((row) => [row.id, row]))
  const lines = (entry.postings || []).map((posting) => {
    const account = byId.get(posting.account_id)
    return {
      account_code: posting.account_code || account?.account_code || '',
      account_name: posting.account_name || account?.account_name || '',
      description: posting.description,
      debit: Number(posting.debit) || 0,
      credit: Number(posting.credit) || 0,
      currency: posting.currency || 'USD',
    }
  })
  return {
    journalNumber: journalDisplayId(entry),
    postingDate: entry.posting_date || entry.created_at || null,
    period: entry.period,
    reference: entry.reference,
    description: entry.description || '',
    postingStatus: entry.posting_status,
    approvalStatus: entry.approval_status,
    lines,
    branding,
  }
}

const PDF_HEAD_RGB: [number, number, number] = [96, 96, 96]
const JOURNAL_COL_WIDTHS = [22, 120, 96, 34, 52, 38, 50, 82, 86, 86] as const

export function generateJournalEntryPdf(input: JournalPdfInput): void {
  const branding = input.branding
  const companyName = (branding?.profile.company_name || 'Grand-Tek Technology USA').trim()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 40
  const contentWidth = pageWidth - marginX * 2
  let y = drawPdfLetterhead(doc, branding, 'JOURNAL ENTRY', { marginX, startY: 50 })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(30, 30, 30)
  doc.text('Journal Entry', pageWidth / 2, y, { align: 'center' })
  y += 16

  doc.setFontSize(11)
  const dateLabel = formatJournalPdfDate(input.postingDate)
  const numberLabel = `Journal Entry No: ${input.journalNumber}`
  doc.text(dateLabel, pageWidth / 2 - 12, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.text(numberLabel, pageWidth / 2 + 12, y)
  y += 14

  doc.setFontSize(8)
  doc.setTextColor(70, 70, 70)
  const metaBits = [
    input.reference?.trim() ? `Reference: ${input.reference.trim()}` : '',
    input.period ? `Period: ${input.period}` : '',
    input.postingStatus ? `Posting: ${input.postingStatus}` : '',
    input.approvalStatus ? `Approval: ${String(input.approvalStatus).replace(/_/g, ' ')}` : '',
  ].filter(Boolean)
  if (input.description?.trim()) {
    const descLines = doc.splitTextToSize(`Description: ${input.description.trim()}`, contentWidth) as string[]
    doc.text(descLines, marginX, y)
    y += 11 * descLines.length
  }
  if (metaBits.length) {
    const metaLines = doc.splitTextToSize(metaBits.join('   ·   '), contentWidth) as string[]
    doc.text(metaLines, marginX, y)
    y += 11 * metaLines.length
  }
  y += 4

  const lines = input.lines.filter(
    (line) => line.account_code || line.debit > 0 || line.credit > 0,
  )
  let debitTotal = 0
  let creditTotal = 0
  const body =
    lines.length > 0
      ? lines.map((line, index) => {
          debitTotal += line.debit > 0 ? line.debit : 0
          creditTotal += line.credit > 0 ? line.credit : 0
          const amount = line.debit > 0 ? line.debit : line.credit
          const account = [line.account_code, line.account_name].filter(Boolean).join('\n')
          return [
            String(index + 1),
            account || '—',
            (line.description || '').trim(),
            '',
            '',
            (line.currency || 'USD').trim() || 'USD',
            '1.0000',
            moneyAmount(amount),
            moneyAmount(line.debit),
            moneyAmount(line.credit),
          ]
        })
      : [['—', 'No posting lines', '', '', '', '', '', '', '', '']]

  autoTable(doc, {
    startY: y,
    head: [
      [
        'No',
        'G/L Account',
        'Text',
        'Dep No.',
        'Department',
        'Current',
        'Exchange Rate',
        'Currency Amount',
        'Debit Local Currency Amount',
        'Credit Local Currency Amount',
      ],
    ],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 4,
      textColor: [40, 40, 40],
      lineColor: [180, 180, 180],
      lineWidth: 0.4,
      valign: 'top',
    },
    headStyles: {
      fillColor: PDF_HEAD_RGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: PDF_BRAND_ALT_RGB },
    tableWidth: JOURNAL_COL_WIDTHS.reduce((sum, width) => sum + width, 0),
    columnStyles: {
      0: { cellWidth: JOURNAL_COL_WIDTHS[0], halign: 'center' },
      1: { cellWidth: JOURNAL_COL_WIDTHS[1] },
      2: { cellWidth: JOURNAL_COL_WIDTHS[2] },
      3: { cellWidth: JOURNAL_COL_WIDTHS[3] },
      4: { cellWidth: JOURNAL_COL_WIDTHS[4] },
      5: { cellWidth: JOURNAL_COL_WIDTHS[5], halign: 'center' },
      6: { cellWidth: JOURNAL_COL_WIDTHS[6], halign: 'right' },
      7: { cellWidth: JOURNAL_COL_WIDTHS[7], halign: 'right' },
      8: { cellWidth: JOURNAL_COL_WIDTHS[8], halign: 'right' },
      9: { cellWidth: JOURNAL_COL_WIDTHS[9], halign: 'right' },
    },
    margin: { left: marginX, right: marginX, bottom: 108 },
  })

  const tableWidth = JOURNAL_COL_WIDTHS.reduce((sum, width) => sum + width, 0)
  const creditRight = marginX + tableWidth
  const debitRight = creditRight - JOURNAL_COL_WIDTHS[9]
  const pageCount = doc.getNumberOfPages()
  const totalsY = pageHeight - 78
  const signatureY = pageHeight - 52

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    if (i === pageCount) {
      doc.setDrawColor(180, 180, 180)
      doc.setLineWidth(0.6)
      doc.line(marginX, totalsY - 14, creditRight, totalsY - 14)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)
      doc.text('Total Amount:', marginX, totalsY)
      doc.text(moneyAmount(debitTotal) || '0.00', debitRight, totalsY, { align: 'right' })
      doc.text(moneyAmount(creditTotal) || '0.00', creditRight, totalsY, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.text(
        'Approved by : ________     Reviewed by : ________     Cashier : ________     Applicant : ________',
        marginX,
        signatureY,
      )
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(`-- ${i} of ${pageCount} --`, pageWidth / 2, pageHeight - 28, { align: 'center' })
    doc.text(companyFooterLine(branding?.profile) || companyName, pageWidth / 2, pageHeight - 16, {
      align: 'center',
    })
  }

  downloadPdf(doc, buildJournalEntryPdfFilename(input.journalNumber, input.postingDate))
}
