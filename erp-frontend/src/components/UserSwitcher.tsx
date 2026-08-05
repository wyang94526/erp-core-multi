import { useAuth } from '../context/AuthContext'

export default function UserSwitcher() {
  const { user, users, setUserId, loading } = useAuth()

  if (loading && !user) {
    return <span style={mutedStyle}>Loading user…</span>
  }

  return (
    <label style={wrapStyle}>
      <span style={labelStyle}>Acting as</span>
      <select
        style={selectStyle}
        value={user?.id || ''}
        onChange={(e) => setUserId(e.target.value)}
        aria-label="Switch active user"
      >
        {users.length === 0 && user && (
          <option value={user.id}>{user.full_name}</option>
        )}
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name}
            {u.roles?.length ? ` (${u.roles.map((r) => r.role_name).join(', ')})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginLeft: 'auto',
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text)',
  whiteSpace: 'nowrap',
}

const selectStyle: React.CSSProperties = {
  maxWidth: '280px',
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  fontFamily: 'inherit',
  background: 'var(--bg)',
  color: 'var(--text-h)',
}

const mutedStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: '12px',
  color: 'var(--text)',
}
