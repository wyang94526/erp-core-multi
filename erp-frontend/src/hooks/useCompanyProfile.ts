/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 */

import { useQuery } from '@tanstack/react-query'
import { getStoredCompanyId } from '../api/client'
import { companyProfileService } from '../api/services'

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
  const detail = [query.data?.country, query.data?.base_currency].filter(Boolean).join(' · ')
  return { name, detail }
}
