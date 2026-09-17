export type PaginationMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type PaginatedList<T> = {
  data: T[]
  pagination: PaginationMeta
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function unwrapListRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  const obj = asRecord(raw)
  if (obj && Array.isArray(obj.data)) return obj.data as T[]
  return []
}

export function parsePagination(
  raw: unknown,
  skip: number,
  limit: number,
  rowCount: number,
): PaginationMeta {
  const obj = asRecord(raw)
  const meta = asRecord(obj?.pagination)
  const safeLimit = Number(meta?.limit ?? limit) || 0
  const total = Number(meta?.total)
  const resolvedTotal = Number.isFinite(total) ? total : skip + rowCount
  const pageFromMeta = Number(meta?.page)
  const totalPagesFromMeta = Number(meta?.totalPages ?? meta?.total_pages)
  const pageSize = safeLimit > 0 ? safeLimit : 1
  return {
    page: Number.isFinite(pageFromMeta) && pageFromMeta > 0 ? pageFromMeta : Math.floor(Math.max(skip, 0) / pageSize) + 1,
    limit: safeLimit,
    total: Math.max(0, resolvedTotal),
    totalPages: Number.isFinite(totalPagesFromMeta)
      ? totalPagesFromMeta
      : resolvedTotal > 0
        ? Math.ceil(resolvedTotal / pageSize)
        : 0,
  }
}

export function parsePagedList<T>(raw: unknown, skip: number, limit: number): PaginatedList<T> {
  const data = unwrapListRows<T>(raw)
  return {
    data,
    pagination: parsePagination(raw, skip, limit, data.length),
  }
}

export function formatPaginationLabel(opts: {
  skip: number
  pageCount: number
  total: number
  noun?: string
}): string {
  const noun = opts.noun || 'result'
  const plural = `${noun}s`
  const total = Math.max(0, Number(opts.total) || 0)
  if (total === 0) return `Showing 0 ${plural}`
  if (total === 1) return `Showing 1 ${noun}`
  const start = opts.pageCount === 0 ? 0 : opts.skip + 1
  const end = opts.skip + opts.pageCount
  return `Showing ${start} to ${end} of ${total} ${plural}`
}
