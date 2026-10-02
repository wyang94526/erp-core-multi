/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 */

import { useQuery } from '@tanstack/react-query'
import { financeSettingsService } from '../api/services'
import type { PeriodCloseStatus } from '../types'
import { periodStatusFor, periodStatusMessage } from '../utils/periodClose'

export const FINANCE_PERIOD_SETTINGS_KEY = ['financePeriodSettings'] as const

export function useFinancePeriodSettings() {
  return useQuery({
    queryKey: FINANCE_PERIOD_SETTINGS_KEY,
    queryFn: () => financeSettingsService.get(),
    staleTime: 30_000,
  })
}

export function usePeriodStatus(
  txnDate: string | Date | null | undefined,
  kind: 'operational' | 'adjustment' = 'operational',
): {
  status: PeriodCloseStatus
  message: string | null
  blocked: boolean
} {
  const query = useFinancePeriodSettings()
  const status = periodStatusFor(txnDate, query.data)
  const message = periodStatusMessage(status, { kind })
  return {
    status,
    message,
    blocked: status === 'HARD_CLOSE' || (status === 'SOFT_CLOSE' && kind === 'operational'),
  }
}
