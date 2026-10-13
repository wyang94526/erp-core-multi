/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState } from 'react'
import { getStoredCompanyId, setStoredCompanyId } from '../api/client'
import { companyService } from '../api/services'
import type { Company, CompanyMembership } from '../types'
import { currencySymbol } from '../utils/currency'

function companyOptionLabel(company: Company) {
  const symbol = currencySymbol(company.base_currency)
  return `${company.code} — ${company.name} · ${company.base_currency} ${symbol}`
}

export function CompanySwitcher() {
  const [rows, setRows] = useState<CompanyMembership[]>([])
  const [selected, setSelected] = useState(getStoredCompanyId() ?? '')

  useEffect(() => {
    let cancelled = false
    companyService
      .mine()
      .then((memberships) => {
        if (cancelled) return
        setRows(memberships)
        const stored = getStoredCompanyId()
        const match = memberships.find((row) => row.company.id === stored)
        const fallback = memberships.find((row) => row.is_default) ?? memberships[0]
        const next = match?.company.id ?? fallback?.company.id ?? ''
        if (next && next !== stored) {
          setStoredCompanyId(next)
        }
        setSelected(next)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (rows.length === 0) return null

  const parents = rows
    .filter((row) => !row.company.parent_company_id)
    .sort((a, b) => a.company.code.localeCompare(b.company.code))
  const childrenOf = (parentId: string) =>
    rows
      .filter((row) => row.company.parent_company_id === parentId)
      .sort((a, b) => a.company.code.localeCompare(b.company.code))
  const groupedParentIds = new Set(parents.map((row) => row.company.id))
  const loose = rows.filter(
    (row) => row.company.parent_company_id && !groupedParentIds.has(row.company.parent_company_id),
  )

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span>Company</span>
      <select
        aria-label="Active company"
        value={selected}
        onChange={(event) => {
          const next = event.target.value
          setSelected(next)
          setStoredCompanyId(next)
          window.location.reload()
        }}
        style={{ maxWidth: 420 }}
      >
        {parents.map((parent) => {
          const children = childrenOf(parent.company.id)
          if (children.length === 0) {
            return (
              <option key={parent.company.id} value={parent.company.id}>
                {companyOptionLabel(parent.company)}
              </option>
            )
          }
          return (
            <optgroup key={parent.company.id} label={companyOptionLabel(parent.company)}>
              <option value={parent.company.id}>
                {companyOptionLabel(parent.company)}
              </option>
              {children.map((row) => (
                <option key={row.company.id} value={row.company.id}>
                  {companyOptionLabel(row.company)}
                </option>
              ))}
            </optgroup>
          )
        })}
        {loose.map((row) => (
          <option key={row.company.id} value={row.company.id}>
            {companyOptionLabel(row.company)}
          </option>
        ))}
      </select>
    </label>
  )
}
