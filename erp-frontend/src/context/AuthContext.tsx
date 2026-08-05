/**
 * AuthContext — JWT-ready identity layer.
 * Today: X-User-Id via localStorage + User Switcher.
 * Later: swap setUserId/login to store Bearer tokens; keep hasPermission.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { adminRbacService, approvalService } from '../api/services'
import type { CurrentUser, UserSummary } from '../types'

const STORAGE_KEY = 'erp.activeUserId'

type AuthContextValue = {
  user: CurrentUser | null
  users: UserSummary[]
  loading: boolean
  setUserId: (id: string) => void
  refresh: () => Promise<void>
  hasPermission: (code: string) => boolean
  hasAnyPermission: (codes: string[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [me, list] = await Promise.all([
        approvalService.me(),
        adminRbacService.listUsers().catch(() => [] as UserSummary[]),
      ])
      setUser(me)
      setUsers(
        list.map((u) => ({
          id: String(u.id),
          email: u.email,
          full_name: u.full_name,
          status: u.status,
          roles: u.roles,
        })),
      )
      if (me?.id && !localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, me.id)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setUserId = useCallback(
    (id: string) => {
      localStorage.setItem(STORAGE_KEY, id)
      refresh()
    },
    [refresh],
  )

  const hasPermission = useCallback(
    (code: string) => {
      if (!user) return false
      if (user.roles?.some((r) => r.role_id === 'ROLE-ADMIN')) return true
      return (user.permissions || []).includes(code)
    },
    [user],
  )

  const hasAnyPermission = useCallback(
    (codes: string[]) => codes.some((c) => hasPermission(c)),
    [hasPermission],
  )

  const value = useMemo(
    () => ({
      user,
      users,
      loading,
      setUserId,
      refresh,
      hasPermission,
      hasAnyPermission,
    }),
    [user, users, loading, setUserId, refresh, hasPermission, hasAnyPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export function getStoredUserId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY)
}
