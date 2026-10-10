/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="auth-loading" role="status">
        Restoring session…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />
  }

  return <>{children}</>
}
