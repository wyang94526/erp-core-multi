/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * AuthContext — JWT session + RBAC helpers.
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
import { getStoredAuthToken, setStoredAuthToken } from '../api/client'
import { authService } from '../api/services'
import type { CurrentUser } from '../types'

type AuthContextValue = {
  user: CurrentUser | null
  token: string | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (
    fullName: string,
    email: string,
    password: string,
    securityQuestion: string,
    securityAnswer: string,
  ) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
  hasPermission: (code: string) => boolean
  hasAnyPermission: (codes: string[]) => boolean
  hasAnyRole: (roleIds: string[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const stored = getStoredAuthToken()
    if (!stored) {
      setUser(null)
      setToken(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const me = await authService.me()
      setUser(me)
      setToken(stored)
    } catch {
      setStoredAuthToken(null)
      setUser(null)
      setToken(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login({ email, password })
    setStoredAuthToken(result.access_token)
    setToken(result.access_token)
    setUser(result.user)
  }, [])

  const register = useCallback(
    async (
      fullName: string,
      email: string,
      password: string,
      securityQuestion: string,
      securityAnswer: string,
    ) => {
      const result = await authService.register({
        full_name: fullName,
        email,
        password,
        security_question: securityQuestion,
        security_answer: securityAnswer,
      })
      setStoredAuthToken(result.access_token)
      setToken(result.access_token)
      setUser(result.user)
    },
    [],
  )

  const logout = useCallback(() => {
    setStoredAuthToken(null)
    setToken(null)
    setUser(null)
  }, [])

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

  const hasAnyRole = useCallback(
    (roleIds: string[]) => {
      if (!user) return false
      if (user.roles?.some((r) => r.role_id === 'ROLE-ADMIN')) return true
      const owned = new Set(user.roles?.map((r) => r.role_id) || [])
      return roleIds.some((id) => owned.has(id))
    },
    [user],
  )

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: Boolean(user && token),
      login,
      register,
      logout,
      refresh,
      hasPermission,
      hasAnyPermission,
      hasAnyRole,
    }),
    [
      user,
      token,
      loading,
      login,
      register,
      logout,
      refresh,
      hasPermission,
      hasAnyPermission,
      hasAnyRole,
    ],
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
