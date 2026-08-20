/** Lightweight Markdown renderer for AI chat replies (no extra deps). */

import AiMonthTrendChart, {
  type AiMonthTrendPoint,
  type AiMonthTrendSpec,
} from './AiMonthTrendChart'

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineFormat(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return html
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

function alignFromSeparator(cell: string): 'left' | 'center' | 'right' {
  const token = cell.replace(/\s/g, '')
  if (token.startsWith(':') && token.endsWith(':')) return 'center'
  if (token.endsWith(':')) return 'right'
  return 'left'
}

function renderHeading(line: string): string | null {
  if (/^###\s+/.test(line)) return `<h4>${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`
  if (/^##\s+/.test(line)) return `<h3>${inlineFormat(line.replace(/^##\s+/, ''))}</h3>`
  if (/^#\s+/.test(line)) return `<h3>${inlineFormat(line.replace(/^#\s+/, ''))}</h3>`
  return null
}

function renderMarkdownTable(lines: string[]): string {
  const rows = lines.map((line) => line.trim()).filter(Boolean)
  if (rows.length < 2) return ''
  const header = parseTableRow(rows[0])
  let bodyStart = 1
  let aligns: Array<'left' | 'center' | 'right'> = header.map(() => 'left')
  if (rows[1] && isSeparatorRow(rows[1])) {
    const sep = parseTableRow(rows[1])
    aligns = header.map((_, index) => alignFromSeparator(sep[index] || ''))
    bodyStart = 2
  }
  const th = header
    .map(
      (cell, index) =>
        `<th style="text-align:${aligns[index] || 'left'}">${inlineFormat(cell)}</th>`,
    )
    .join('')
  const body = rows
    .slice(bodyStart)
    .map((line) => {
      const cells = parseTableRow(line)
      const isTotal = /^total$/i.test((cells[0] || '').replace(/\*/g, '').trim())
      const rowClass = isTotal ? ' class="ai-table-total"' : ''
      const tds = cells
        .map((cell, index) => {
          const tag = isTotal ? 'th' : 'td'
          return `<${tag} style="text-align:${aligns[index] || 'left'}">${inlineFormat(cell)}</${tag}>`
        })
        .join('')
      return `<tr${rowClass}>${tds}</tr>`
    })
    .join('')
  return `<table class="ai-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
}

function renderTextBlock(para: string): string {
  const trimmed = para.trim()
  if (!trimmed) return ''
  const rawLines = trimmed.split('\n')
  const pipeLines = rawLines.filter((line) => line.trim().startsWith('|'))
  const otherLines = rawLines.filter((line) => line.trim() && !line.trim().startsWith('|'))
  if (pipeLines.length >= 2) {
    const prefix = otherLines
      .map((line) => renderHeading(line.trim()) || `<p>${inlineFormat(line.trim())}</p>`)
      .join('')
    return `${prefix}${renderMarkdownTable(pipeLines)}`
  }
  const lines = rawLines.map((line) => {
    const heading = renderHeading(line)
    if (heading) return heading
    if (/^[-*]\s+/.test(line)) return `<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`
    return inlineFormat(line)
  })
  const joined = lines.join('<br/>')
  if (lines.every((line) => line.startsWith('<li>'))) return `<ul>${lines.join('')}</ul>`
  if (joined.startsWith('<h')) return joined
  return `<p>${joined}</p>`
}

function renderMarkdownHtml(content: string): string {
  const blocks = content.split(/```/)
  const htmlParts: string[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (i % 2 === 1) {
      const lines = block.split('\n')
      const code = lines[0]?.match(/^[a-zA-Z0-9_-]+$/) ? lines.slice(1).join('\n') : block
      const unfenced = code.replace(/^\n/, '')
      const pipeLines = unfenced.split('\n').filter((line) => line.trim().startsWith('|'))
      if (pipeLines.length >= 2) {
        for (const para of unfenced.split(/\n{2,}/)) {
          const html = renderTextBlock(para)
          if (html) htmlParts.push(html)
        }
        continue
      }
      htmlParts.push(`<pre class="ai-code"><code>${escapeHtml(unfenced)}</code></pre>`)
      continue
    }
    const paragraphs = block.split(/\n{2,}/)
    for (const para of paragraphs) {
      const html = renderTextBlock(para)
      if (html) htmlParts.push(html)
    }
  }
  return htmlParts.join('')
}

function parseMoney(value: string): number {
  const n = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function parseMonthLabel(label: string): { year: number; month: number } | null {
  const match = label.trim().match(/^([A-Za-z]{3})\s+(20\d{2})$/)
  if (!match) return null
  const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === match[1].toLowerCase())
  const year = Number(match[2])
  if (month < 0 || !year) return null
  return { year, month: month + 1 }
}

function fillMonthGaps(points: AiMonthTrendPoint[]): AiMonthTrendPoint[] {
  if (points.length < 2) return points
  const dated = points
    .map((point) => {
      const parsed = parseMonthLabel(point.label)
      return parsed ? { ...point, ...parsed } : null
    })
    .filter((row): row is AiMonthTrendPoint & { year: number; month: number } => Boolean(row))
  if (dated.length < 2) return points
  const start = dated.reduce((min, row) =>
    row.year < min.year || (row.year === min.year && row.month < min.month) ? row : min,
  )
  const end = dated.reduce((max, row) =>
    row.year > max.year || (row.year === max.year && row.month > max.month) ? row : max,
  )
  const span = (end.year - start.year) * 12 + (end.month - start.month) + 1
  if (span > 24) return points
  const byKey = new Map(dated.map((row) => [`${row.year}-${row.month}`, row]))
  const filled: AiMonthTrendPoint[] = []
  let year = start.year
  let month = start.month
  while (year < end.year || (year === end.year && month <= end.month)) {
    const existing = byKey.get(`${year}-${month}`)
    filled.push(
      existing || {
        label: `${MONTH_NAMES[month - 1]} ${year}`,
        orders: 0,
        amount: 0,
      },
    )
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return filled
}

function parseChartSpec(raw: string): AiMonthTrendSpec | null {
  try {
    const data = JSON.parse(raw) as AiMonthTrendSpec
    if (!data || !Array.isArray(data.points) || data.points.length === 0) return null
    return {
      ...data,
      points: data.points.map((point) => ({
        label: String(point.label || ''),
        orders: Number(point.orders) || 0,
        amount: Number(point.amount) || 0,
        series: point.series ? String(point.series) : undefined,
      })),
    }
  } catch {
    return null
  }
}

function extractTrendFromMarkdown(content: string): AiMonthTrendSpec | null {
  const lines = content.split('\n').map((line) => line.trim())
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith('|')) return false
    const cells = parseTableRow(line).map((cell) => cell.toLowerCase())
    return cells.includes('month') && cells.includes('amount')
  })
  if (headerIndex < 0) return null
  const header = parseTableRow(lines[headerIndex]).map((cell) => cell.toLowerCase())
  const monthIdx = header.indexOf('month')
  const amountIdx = header.indexOf('amount')
  const countHeaders = ['orders', 'bills', 'invoices', 'transactions', 'count']
  const countIdx = header.findIndex((cell) => countHeaders.includes(cell))
  const partyIdx = header.findIndex((cell) => cell === 'vendor' || cell === 'customer' || cell === 'supplier')
  const countLabel =
    countIdx >= 0
      ? parseTableRow(lines[headerIndex])[countIdx] || 'Count'
      : 'Orders'
  const partyLabel = partyIdx >= 0 ? parseTableRow(lines[headerIndex])[partyIdx] : ''
  let start = headerIndex + 1
  if (lines[start] && isSeparatorRow(lines[start])) start += 1
  const points: AiMonthTrendPoint[] = []
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) break
    const cells = parseTableRow(lines[i])
    const label = (cells[monthIdx] || '').replace(/\*/g, '').trim()
    if (!label || /^total$/i.test(label)) continue
    points.push({
      label,
      orders: parseMoney(cells[countIdx >= 0 ? countIdx : partyIdx >= 0 ? 2 : 1] || '0'),
      amount: parseMoney(cells[amountIdx] || '0'),
      series: partyIdx >= 0 ? (cells[partyIdx] || '').replace(/\*/g, '').trim() : undefined,
    })
  }
  if (points.length === 0) return null
  const hasSeries = points.some((point) => point.series)
  return {
    type: 'month_trend',
    countLabel,
    amountLabel: 'Amount',
    seriesLabel: partyLabel || undefined,
    points: hasSeries ? points : fillMonthGaps(points),
  }
}

type ContentPart =
  | { type: 'html'; html: string }
  | { type: 'chart'; spec: AiMonthTrendSpec }

function splitContent(content: string): ContentPart[] {
  const parts: ContentPart[] = []
  const fence = /```ai-chart\s*\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  let hasChart = false
  while ((match = fence.exec(content))) {
    if (match.index > last) {
      const html = renderMarkdownHtml(content.slice(last, match.index))
      if (html) parts.push({ type: 'html', html })
    }
    const spec = parseChartSpec(match[1].trim())
    if (spec) {
      parts.push({ type: 'chart', spec })
      hasChart = true
    }
    last = match.index + match[0].length
  }
  const rest = content.slice(last)
  if (rest) {
    const html = renderMarkdownHtml(rest)
    if (html) parts.push({ type: 'html', html })
  }
  if (!hasChart) {
    const fallback = extractTrendFromMarkdown(content)
    if (fallback) {
      const headingIndex = parts.findIndex((part) => part.type === 'html' && /<h[34]>/.test(part.html))
      const insertAt = headingIndex >= 0 ? headingIndex + 1 : 0
      parts.splice(insertAt, 0, { type: 'chart', spec: fallback })
    }
  }
  return parts
}

export default function SimpleMarkdown({ content }: { content: string }) {
  const parts = splitContent(content)
  return (
    <div className="ai-markdown">
      {parts.map((part, index) =>
        part.type === 'chart' ? (
          <AiMonthTrendChart key={`chart-${index}`} spec={part.spec} />
        ) : (
          <div key={`html-${index}`} dangerouslySetInnerHTML={{ __html: part.html }} />
        ),
      )}
    </div>
  )
}
