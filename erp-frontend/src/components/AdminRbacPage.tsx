import { useEffect, useState } from 'react'
import { adminRbacService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type {
  Permission,
  RoleDetail,
  UserSummary,
  WorkflowDefinition,
} from '../types'

type Tab = 'users' | 'roles' | 'permissions' | 'workflows'

export default function AdminRbacPage() {
  const { hasPermission, refresh } = useAuth()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<UserSummary[]>([])
  const [roles, setRoles] = useState<RoleDetail[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])

  const canManage = hasPermission('admin:manage')

  const load = async () => {
    setError(null)
    try {
      const [u, r, p, w] = await Promise.all([
        adminRbacService.listUsers(),
        adminRbacService.listRoles(),
        adminRbacService.listPermissions(),
        adminRbacService.listWorkflows(),
      ])
      setUsers(u)
      setRoles(r)
      setPermissions(p)
      setWorkflows(w)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load RBAC data')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openAssign = (user: UserSummary) => {
    setSelectedUser(user.id)
    setSelectedRoles((user.roles || []).map((r) => r.role_id))
  }

  const saveRoles = async () => {
    if (!selectedUser || !canManage) return
    setBusy(true)
    setError(null)
    try {
      await adminRbacService.assignRoles(selectedUser, selectedRoles)
      setSelectedUser(null)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign roles')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <h2 style={headingStyle}>Users, Roles & Workflows</h2>
      <p style={subStyle}>
        Manage RBAC assignments and review multi-stage approval definitions.
      </p>

      <div style={tabsStyle}>
        {(['users', 'roles', 'permissions', 'workflows'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            style={{ ...tabBtn, ...(tab === t ? tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <p style={errorStyle}>{error}</p>}

      {tab === 'users' && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Status</th>
              <th style={th}>Roles</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={td}>{u.full_name}</td>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.status || 'ACTIVE'}</td>
                <td style={td}>
                  {(u.roles || []).map((r) => r.role_name).join(', ') || '—'}
                </td>
                <td style={td}>
                  {canManage && (
                    <button type="button" style={linkBtn} onClick={() => openAssign(u)}>
                      Assign roles
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'roles' && (
        <div style={listWrap}>
          {roles.map((r) => (
            <div key={r.role_id} style={cardStyle}>
              <strong>{r.role_name}</strong>
              <div style={muted}>{r.role_id}</div>
              <p style={muted}>{r.description}</p>
              <div style={chipRow}>
                {(r.permissions || []).map((p) => (
                  <span key={p} style={chip}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'permissions' && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Module</th>
              <th style={th}>Description</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.id}>
                <td style={td}>
                  <code>{p.code}</code>
                </td>
                <td style={td}>{p.module}</td>
                <td style={td}>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'workflows' && (
        <div style={listWrap}>
          {workflows.map((w) => (
            <div key={w.id} style={cardStyle}>
              <strong>
                {w.name || w.id}{' '}
                <span style={muted}>
                  ({w.module} · {String(w.min_amount)}
                  {w.max_amount != null ? `–${w.max_amount}` : '+'}
                  {!w.is_active ? ' · inactive' : ''})
                </span>
              </strong>
              {(w.steps || []).length === 0 ? (
                <p style={muted}>Auto-approve (no steps)</p>
              ) : (
                <ol style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
                  {w.steps.map((s) => (
                    <li key={s.id} style={{ fontSize: '13px' }}>
                      {s.step_number}. {s.step_name}
                      {s.required_role_id ? ` · role ${s.required_role_id}` : ''}
                      {s.required_permission ? ` · perm ${s.required_permission}` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedUser && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>Assign roles</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {roles.map((r) => (
                <label key={r.role_id} style={{ fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(r.role_id)}
                    onChange={(e) => {
                      setSelectedRoles((prev) =>
                        e.target.checked
                          ? [...prev, r.role_id]
                          : prev.filter((id) => id !== r.role_id),
                      )
                    }}
                  />{' '}
                  {r.role_name}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSelectedUser(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" onClick={saveRoles} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const pageStyle: React.CSSProperties = { maxWidth: '1100px' }
const headingStyle: React.CSSProperties = { margin: '0 0 4px', color: 'var(--text-h)' }
const subStyle: React.CSSProperties = { margin: '0 0 16px', color: 'var(--text)', fontSize: '14px' }
const tabsStyle: React.CSSProperties = { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
const tabBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const tabActive: React.CSSProperties = { background: 'var(--text-h)', color: '#fff', borderColor: 'transparent' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '13px' }
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '8px' }
const td: React.CSSProperties = { borderBottom: '1px solid var(--border)', padding: '8px', verticalAlign: 'top' }
const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1976d2',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const listWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '12px' }
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '12px 14px',
  background: 'var(--bg)',
}
const muted: React.CSSProperties = { color: 'var(--text)', fontSize: '12px' }
const chipRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }
const chip: React.CSSProperties = {
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: '10px',
  background: '#eceff1',
  color: '#37474f',
}
const errorStyle: React.CSSProperties = { color: '#c62828' }
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}
const modal: React.CSSProperties = {
  background: 'var(--bg)',
  padding: '20px',
  borderRadius: '10px',
  width: 'min(400px, 92vw)',
  border: '1px solid var(--border)',
}
