/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 */

import { useQuery } from '@tanstack/react-query'
import { companyProfileService } from '../api/services'

export const COMPANY_PROFILE_KEY = ['companyProfile'] as const
export const COMPANY_NAME_KEY = ['companyName'] as const

/** Shown only when the public profile request has not returned a name. */
export const FALLBACK_COMPANY_NAME = 'Grand-Tek Technology USA'

export function useCompanyProfile() {
  return useQuery({
    queryKey: COMPANY_PROFILE_KEY,
    queryFn: () => companyProfileService.get(),
    staleTime: 30_000,
  })
}

export function useCompanyName() {
  const query = useQuery({
    queryKey: COMPANY_NAME_KEY,
    queryFn: () => companyProfileService.getPublicName(),
    staleTime: 60_000,
  })
  const name = query.data?.company_name?.trim()
  return name || FALLBACK_COMPANY_NAME
}
