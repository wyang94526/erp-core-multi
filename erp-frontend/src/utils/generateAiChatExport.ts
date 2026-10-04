/**
 * @author: Wendy Yang
 * @date: 2026-10-04
 *
 * Export AI Assistant prompt/response turns as branded PDF or Markdown.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { downloadTextFile } from './financialReports'
import { downloadPdf } from './pdfDownload'
import {
  companyFooterLine,
  drawPdfLetterhead,
  loadCompanyPdfBranding,
  PDF_BRAND_ALT_RGB,
  PDF_BRAND_RGB,
  type CompanyPdfBranding,
} from './pdfLetterhead'

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type AiChatTurn = {
  id: string
  prompt: string
  userMessageId: string
  responses: { id: string; content: string }[]
}

type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'para'; text: string }

export function pairAiChatTurns(messages: AiChatMessage[]): AiChatTurn[] {
  const turns: AiChatTurn[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        prompt: message.content,
        userMessageId: message.id,
        responses: [],
      })
      continue
    }
    if (message.role !== 'assistant' || !turns.length) continue
    turns[turns.length - 1].responses.push({ id: message.id, content: message.content })
  }
  return turns.filter((turn) => turn.prompt.trim() && turn.responses.some((row) => row.content.trim()))
}

export function turnForAssistantMessage(
  turns: AiChatTurn[],
  assistantMessageId: string,
): AiChatTurn | null {
  return turns.find((turn) => turn.responses.some((row) => row.id === assistantMessageId)) || null
}

function slugPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'conversation'
}

function stampLocalDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildAiChatExportFilename(turns: AiChatTurn[], ext: 'pdf' | 'md', now = new Date()): string {
  const slug = turns.length === 1 ? slugPrompt(turns[0].prompt) : 'conversation'
  return `GTT-USA-AI-${slug}-${stampLocalDate(now)}.${ext}`
}

export function buildAiChatMarkdown(turns: AiChatTurn[], now = new Date()): string {
  const lines = [
    '# GTT-USA ERP AI Assistant',
    '',
    `Exported ${stampLocalDate(now)}`,
    '',
  ]
  turns.forEach((turn, index) => {
    if (index > 0) lines.push('---', '')
    lines.push('## Prompt', '', turn.prompt.trim(), '')
    turn.responses.forEach((response, responseIndex) => {
      lines.push(responseIndex === 0 ? '## Response' : '## Response (follow-up)', '', response.content.trim(), '')
    })
  })
  return lines.join('\n').trim() + '\n'
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEnd = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutEnd.split('|').map((cell) => cell.trim())
}

function isSeparatorRow(line: string): boolean {
  const cells = parseTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/```ai-chart[\s\S]*?```/g, '[Chart omitted in export]')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '').trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const cleaned = stripInlineMarkdown(markdown).replace(/\r\n/g, '\n')
  const lines = cleaned.split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', text: heading[1].trim() })
      i += 1
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = parseTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && !isSeparatorRow(lines[i])) {
        rows.push(parseTableRow(lines[i]))
        i += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].includes('|')) {
      para.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'para', text: para.join(' ').trim() })
  }
  return blocks
}

function ensureSpace(
  doc: jsPDF,
  y: number,
  needed: number,
  branding: CompanyPdfBranding | null | undefined,
): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed <= pageHeight - 48) return y
  doc.addPage()
  return drawPdfLetterhead(doc, branding, 'AI ASSISTANT')
}

function writeWrappedText(
  doc: jsPDF,
  text: string,
  y: number,
  branding: CompanyPdfBranding | null | undefined,
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  const wrapped = doc.splitTextToSize(text, pageWidth - marginX * 2) as string[]
  for (const line of wrapped) {
    y = ensureSpace(doc, y, 14, branding)
    doc.text(line, marginX, y)
    y += 13
  }
  return y
}

function renderMarkdown(
  doc: jsPDF,
  markdown: string,
  startY: number,
  branding: CompanyPdfBranding | null | undefined,
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  let y = startY
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'heading') {
      y = ensureSpace(doc, y, 22, branding)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(30, 30, 30)
      y = writeWrappedText(doc, block.text, y, branding)
      y += 6
      continue
    }
    if (block.type === 'para') {
      y = ensureSpace(doc, y, 16, branding)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(40, 40, 40)
      y = writeWrappedText(doc, block.text, y, branding)
      y += 8
      continue
    }
    y = ensureSpace(doc, y, 28, branding)
    autoTable(doc, {
      startY: y,
      head: [block.headers],
      body: block.rows.length ? block.rows : [['—']],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 3,
        textColor: [40, 40, 40],
        lineColor: [210, 210, 210],
        lineWidth: 0.5,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: PDF_BRAND_RGB,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: PDF_BRAND_ALT_RGB,
      },
      margin: { left: marginX, right: marginX },
      tableWidth: pageWidth - marginX * 2,
    })
    y = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 14
  }
  return y
}

export function generateAiChatPdf(
  turns: AiChatTurn[],
  branding?: CompanyPdfBranding | null,
  now = new Date(),
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 48
  let y = drawPdfLetterhead(doc, branding, 'AI ASSISTANT')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(30, 30, 30)
  doc.text('AI Assistant export', marginX, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(80, 80, 80)
  doc.text(`Exported ${stampLocalDate(now)} · ${turns.length} prompt/response pair(s)`, marginX, y)
  y += 20

  turns.forEach((turn, index) => {
    if (index > 0) {
      y = ensureSpace(doc, y, 36, branding)
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.6)
      doc.line(marginX, y, pageWidth - marginX, y)
      y += 18
    }

    y = ensureSpace(doc, y, 28, branding)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...PDF_BRAND_RGB)
    doc.text('Prompt', marginX, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(30, 30, 30)
    y = writeWrappedText(doc, turn.prompt.trim(), y, branding)
    y += 12

    turn.responses.forEach((response, responseIndex) => {
      y = ensureSpace(doc, y, 24, branding)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...PDF_BRAND_RGB)
      doc.text(responseIndex === 0 ? 'Response' : 'Response (follow-up)', marginX, y)
      y += 14
      y = renderMarkdown(doc, response.content, y, branding)
    })
  })

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

  downloadPdf(doc, buildAiChatExportFilename(turns, 'pdf', now))
}

export async function exportAiChatTurns(
  turns: AiChatTurn[],
  format: 'pdf' | 'md',
): Promise<void> {
  if (!turns.length) {
    throw new Error('Nothing to export yet. Ask a question first.')
  }
  if (format === 'md') {
    downloadTextFile(buildAiChatExportFilename(turns, 'md'), buildAiChatMarkdown(turns), 'text/markdown;charset=utf-8')
    return
  }
  let branding = null
  try {
    branding = await loadCompanyPdfBranding()
  } catch {
    branding = null
  }
  generateAiChatPdf(turns, branding)
}
