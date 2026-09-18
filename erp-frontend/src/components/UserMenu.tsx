/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function UserMenu() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading && !user) {
    return <span className="user-menu-muted">Loading…</span>
  }

  if (!user) {
    return null
  }

  const roleLabel =
    user.roles?.map((r) => r.role_name).join(', ') || user.role_name || 'No role'

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="user-menu">
      <div className="user-menu-info">
        <span className="user-menu-name">{user.full_name}</span>
        <span className="user-menu-roles" title={roleLabel}>
          {roleLabel}
        </span>
      </div>
      <Link to="/change-password" className="user-menu-link">
        Change password
      </Link>
      <button type="button" className="user-menu-logout" onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}
