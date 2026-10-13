/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 */

import { useQuery } from '@tanstack/react-query'
import { getStoredCompanyId } from '../api/client'
import { companyProfileService } from '../api/services'
import { currencySymbol, normalizeCurrency, setActiveCurrency } from '../utils/currency'

export function companyProfileKey(companyId: string | null) {
  return ['companyProfile', companyId] as const
}

export function companyNameKey(companyId: string | null) {
  return ['companyName', companyId] as const
}

/** Shown only before the letterhead request returns. */
export const FALLBACK_COMPANY_NAME = 'Grand-Tek Technology'

export function useCompanyProfile() {
  const companyId = getStoredCompanyId()
  return useQuery({
    queryKey: companyProfileKey(companyId),
    queryFn: () => companyProfileService.get(),
    staleTime: 30_000,
  })
}

export function useCompanyLetterhead() {
  const companyId = getStoredCompanyId()
  const query = useQuery({
    queryKey: companyNameKey(companyId),
    queryFn: () => companyProfileService.getPublicName(),
    staleTime: 60_000,
  })
  const name = query.data?.company_name?.trim() || FALLBACK_COMPANY_NAME
  const currency = normalizeCurrency(query.data?.base_currency)
  if (query.data?.base_currency) setActiveCurrency(currency)
  const symbol = currencySymbol(currency)
  const currencyLabel = query.data?.base_currency ? `${currency} ${symbol}` : ''
  const detail = [query.data?.country, currencyLabel].filter(Boolean).join(' · ')
  return { name, detail, currency, symbol }
}

export function useCompanyCurrency(): string {
  return useCompanyLetterhead().currency
}
