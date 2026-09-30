/**
 * @author: Wendy Yang
 * @date: 2026-09-30
 */

export function matchesSearch(q: string, ...parts: Array<string | number | null | undefined>) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => String(part ?? '').toLowerCase().includes(needle))
}

export function csvCell(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function rowsToCsv(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

export function csvFilename(stem: string, now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${stem}-${now.getFullYear()}-${month}-${day}.csv`
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  const csv = `\uFEFF${rowsToCsv(headers, rows)}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
