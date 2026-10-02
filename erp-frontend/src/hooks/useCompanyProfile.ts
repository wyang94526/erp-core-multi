/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 */

import { useQuery } from '@tanstack/react-query'
import { companyProfileService } from '../api/services'

export const COMPANY_PROFILE_KEY = ['companyProfile'] as const

export function useCompanyProfile() {
  return useQuery({
    queryKey: COMPANY_PROFILE_KEY,
    queryFn: () => companyProfileService.get(),
    staleTime: 30_000,
  })
}
