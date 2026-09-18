/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useState } from 'react'
import { adminRbacService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type {
  Permission,
  RoleDetail,
  UserSummary,
  WorkflowDefinition,
  WorkflowStep,
} from '../types'
import {
  WORKFLOW_MODULES,
  WorkflowTreeView,
  humanModule,
} from './WorkflowTreeView'

type Tab = 'users' | 'roles' | 'permissions' | 'workflows'

type RoleFormState = {
  role_id: string
  role_name: string
  description: string
  permission_codes: string[]
}

type PermissionFormState = {
  id: string
  code: string
  module: string
  description: string
}

type BandFormState = {
  id: string
  module: string
  name: string
  min_amount: string
  max_amount: string
  is_active: boolean
  open_ended: boolean
}

type StepFormState = {
  id: string
  step_number: string
  step_name: string
  required_role_id: string
  required_permission: string
  use_role: boolean
}

const emptyRole = (): RoleFormState => ({
  role_id: '',
  role_name: '',
  description: '',
  permission_codes: [],
})

const emptyPermission = (): PermissionFormState => ({
  id: '',
  code: '',
  module: '',
  description: '',
})

const emptyBand = (module = 'SALES_ORDER'): BandFormState => ({
  id: '',
  module,
  name: '',
  min_amount: '0',
  max_amount: '',
  is_active: true,
  open_ended: false,
})

const emptyStep = (stepNumber = 1): StepFormState => ({
  id: '',
  step_number: String(stepNumber),
  step_name: '',
  required_role_id: '',
  required_permission: '',
  use_role: true,
})

function slugId(prefix: string, raw: string): string {
  const clean = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${prefix}-${clean || Date.now()}`
}

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

  const [roleModal, setRoleModal] = useState<'create' | 'edit' | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRole())

  const [permModal, setPermModal] = useState<'create' | 'edit' | null>(null)
  const [editingPermId, setEditingPermId] = useState<string | null>(null)
  const [permForm, setPermForm] = useState<PermissionFormState>(emptyPermission())

  const [bandModal, setBandModal] = useState<'create' | 'edit' | null>(null)
  const [bandForm, setBandForm] = useState<BandFormState>(emptyBand())
  const [editingBandId, setEditingBandId] = useState<string | null>(null)

  const [stepModal, setStepModal] = useState<'create' | 'edit' | null>(null)
  const [stepWorkflow, setStepWorkflow] = useState<WorkflowDefinition | null>(null)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(emptyStep())

  const canManage = hasPermission('admin:manage')

  const permissionModules = useMemo(() => {
    const set = new Set(permissions.map((p) => p.module))
    return [...set].sort()
  }, [permissions])

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
    void load()
  }, [])

  const openAssign = (user: UserSummary) => {
    setSelectedUser(user.id)
    setSelectedRoles((user.roles || []).map((r) => r.role_id))
  }

  const saveUserRoles = async () => {
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

  const openCreateRole = () => {
    setRoleForm(emptyRole())
    setEditingRoleId(null)
    setRoleModal('create')
  }

  const openEditRole = (role: RoleDetail) => {
    setRoleForm({
      role_id: role.role_id,
      role_name: role.role_name,
      description: role.description || '',
      permission_codes: [...(role.permissions || [])],
    })
    setEditingRoleId(role.role_id)
    setRoleModal('edit')
  }

  const saveRole = async () => {
    if (!canManage) return
    setBusy(true)
    setError(null)
    try {
      if (roleModal === 'create') {
        const roleId = roleForm.role_id.trim() || slugId('ROLE', roleForm.role_name)
        await adminRbacService.createRole({
          role_id: roleId,
          role_name: roleForm.role_name.trim(),
          description: roleForm.description.trim() || null,
          permission_codes: roleForm.permission_codes,
        })
      } else if (editingRoleId) {
        await adminRbacService.updateRole(editingRoleId, {
          role_name: roleForm.role_name.trim(),
          description: roleForm.description.trim() || null,
          permission_codes: roleForm.permission_codes,
        })
      }
      setRoleModal(null)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role')
    } finally {
      setBusy(false)
    }
  }

  const deleteRole = async (role: RoleDetail) => {
    if (!canManage) return
    if (!window.confirm(`Delete role "${role.role_name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await adminRbacService.deleteRole(role.role_id)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role')
    } finally {
      setBusy(false)
    }
  }

  const openCreatePermission = () => {
    setPermForm(emptyPermission())
    setEditingPermId(null)
    setPermModal('create')
  }

  const openEditPermission = (perm: Permission) => {
    setPermForm({
      id: perm.id,
      code: perm.code,
      module: perm.module,
      description: perm.description || '',
    })
    setEditingPermId(perm.id)
    setPermModal('edit')
  }

  const savePermission = async () => {
    if (!canManage) return
    setBusy(true)
    setError(null)
    try {
      if (permModal === 'create') {
        const id = permForm.id.trim() || slugId('PERM', permForm.code)
        await adminRbacService.createPermission({
          id,
          code: permForm.code.trim(),
          module: permForm.module.trim(),
          description: permForm.description.trim() || null,
        })
      } else if (editingPermId) {
        await adminRbacService.updatePermission(editingPermId, {
          code: permForm.code.trim(),
          module: permForm.module.trim(),
          description: permForm.description.trim() || null,
        })
      }
      setPermModal(null)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permission')
    } finally {
      setBusy(false)
    }
  }

  const deletePermission = async (perm: Permission) => {
    if (!canManage) return
    if (!window.confirm(`Delete permission "${perm.code}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await adminRbacService.deletePermission(perm.id)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete permission')
    } finally {
      setBusy(false)
    }
  }

  const openAddBand = (module?: string) => {
    setBandForm(emptyBand(module || 'SALES_ORDER'))
    setEditingBandId(null)
    setBandModal('create')
  }

  const openEditBand = (wf: WorkflowDefinition) => {
    setBandForm({
      id: wf.id,
      module: wf.module,
      name: wf.name || '',
      min_amount: String(wf.min_amount ?? 0),
      max_amount: wf.max_amount == null ? '' : String(wf.max_amount),
      is_active: wf.is_active,
      open_ended: wf.max_amount == null,
    })
    setEditingBandId(wf.id)
    setBandModal('edit')
  }

  const saveBand = async () => {
    if (!canManage) return
    setBusy(true)
    setError(null)
    try {
      const minAmount = Number(bandForm.min_amount)
      const maxAmount = bandForm.open_ended
        ? null
        : bandForm.max_amount.trim() === ''
          ? null
          : Number(bandForm.max_amount)
      if (Number.isNaN(minAmount) || (maxAmount != null && Number.isNaN(maxAmount))) {
        throw new Error('Amount values must be numbers')
      }
      if (bandModal === 'create') {
        const id =
          bandForm.id.trim() ||
          slugId(`WF-${bandForm.module.slice(0, 3)}`, bandForm.name || 'BAND')
        await adminRbacService.createWorkflow({
          id,
          module: bandForm.module,
          name: bandForm.name.trim() || null,
          min_amount: minAmount,
          max_amount: maxAmount,
          is_active: bandForm.is_active,
          steps: [],
        })
      } else if (editingBandId) {
        await adminRbacService.updateWorkflow(editingBandId, {
          module: bandForm.module,
          name: bandForm.name.trim() || null,
          min_amount: minAmount,
          max_amount: maxAmount,
          is_active: bandForm.is_active,
        })
      }
      setBandModal(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow band')
    } finally {
      setBusy(false)
    }
  }

  const deleteBand = async (wf: WorkflowDefinition) => {
    if (!canManage) return
    if (!window.confirm(`Delete amount band "${wf.name || wf.id}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await adminRbacService.deleteWorkflow(wf.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow band')
    } finally {
      setBusy(false)
    }
  }

  const openAddStep = (wf: WorkflowDefinition) => {
    const next = (wf.steps || []).reduce((m, s) => Math.max(m, s.step_number), 0) + 1
    setStepWorkflow(wf)
    setEditingStepId(null)
    setStepForm({
      ...emptyStep(next),
      id: `${wf.id}-S${next}`,
      required_role_id: roles[0]?.role_id || '',
    })
    setStepModal('create')
  }

  const openEditStep = (wf: WorkflowDefinition, step: WorkflowStep) => {
    setStepWorkflow(wf)
    setEditingStepId(step.id)
    setStepForm({
      id: step.id,
      step_number: String(step.step_number),
      step_name: step.step_name,
      required_role_id: step.required_role_id || '',
      required_permission: step.required_permission || '',
      use_role: Boolean(step.required_role_id) || !step.required_permission,
    })
    setStepModal('edit')
  }

  const persistWorkflowSteps = async (
    wf: WorkflowDefinition,
    steps: Array<{
      id: string
      step_number: number
      step_name: string
      required_role_id?: string | null
      required_permission?: string | null
    }>,
  ) => {
    await adminRbacService.updateWorkflow(wf.id, { steps })
  }

  const saveStep = async () => {
    if (!canManage || !stepWorkflow) return
    setBusy(true)
    setError(null)
    try {
      const stepNumber = Number(stepForm.step_number)
      if (!stepForm.step_name.trim() || Number.isNaN(stepNumber) || stepNumber < 1) {
        throw new Error('Step name and a valid step number are required')
      }
      if (stepForm.use_role && !stepForm.required_role_id) {
        throw new Error('Select a required role')
      }
      if (!stepForm.use_role && !stepForm.required_permission.trim()) {
        throw new Error('Enter a required permission code')
      }

      const nextStep = {
        id: stepForm.id.trim() || `${stepWorkflow.id}-S${stepNumber}`,
        step_number: stepNumber,
        step_name: stepForm.step_name.trim(),
        required_role_id: stepForm.use_role ? stepForm.required_role_id : null,
        required_permission: stepForm.use_role
          ? null
          : stepForm.required_permission.trim(),
      }

      const existing = [...(stepWorkflow.steps || [])]
      let steps
      if (stepModal === 'create') {
        if (
          existing.some(
            (s) => s.id === nextStep.id || s.step_number === nextStep.step_number,
          )
        ) {
          throw new Error('Step id or step number already exists on this band')
        }
        steps = [...existing, nextStep]
      } else {
        steps = existing.map((s) =>
          s.id === editingStepId
            ? nextStep
            : {
                id: s.id,
                step_number: s.step_number,
                step_name: s.step_name,
                required_role_id: s.required_role_id ?? null,
                required_permission: s.required_permission ?? null,
              },
        )
      }

      await persistWorkflowSteps(stepWorkflow, steps)
      setStepModal(null)
      setStepWorkflow(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow step')
    } finally {
      setBusy(false)
    }
  }

  const deleteStep = async (wf: WorkflowDefinition, step: WorkflowStep) => {
    if (!canManage) return
    if (!window.confirm(`Delete step "${step.step_name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const remaining = (wf.steps || [])
        .filter((s) => s.id !== step.id)
        .sort((a, b) => a.step_number - b.step_number)
        .map((s, idx) => ({
          id: s.id,
          step_number: idx + 1,
          step_name: s.step_name,
          required_role_id: s.required_role_id ?? null,
          required_permission: s.required_permission ?? null,
        }))
      await persistWorkflowSteps(wf, remaining)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow step')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <h2 style={headingStyle}>Users, Roles & Workflows</h2>
      <p style={subStyle}>
        Manage RBAC assignments and multi-stage approval definitions.
        {!canManage && ' (view only — need admin:manage to edit)'}
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
        <div>
          {canManage && (
            <div style={sectionToolbar}>
              <button type="button" style={primaryBtn} onClick={openCreateRole}>
                + Add role
              </button>
            </div>
          )}
          <div style={listWrap}>
            {roles.map((r) => (
              <div key={r.role_id} style={cardStyle}>
                <div style={cardHeader}>
                  <div>
                    <strong>{r.role_name}</strong>
                    <div style={muted}>{r.role_id}</div>
                  </div>
                  {canManage && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" style={linkBtn} onClick={() => openEditRole(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={{ ...linkBtn, color: '#c62828' }}
                        onClick={() => deleteRole(r)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <p style={muted}>{r.description || 'No description'}</p>
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
        </div>
      )}

      {tab === 'permissions' && (
        <div>
          {canManage && (
            <div style={sectionToolbar}>
              <button type="button" style={primaryBtn} onClick={openCreatePermission}>
                + Add permission
              </button>
            </div>
          )}
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Module</th>
                <th style={th}>Description</th>
                {canManage && <th style={th} />}
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
                  {canManage && (
                    <td style={td}>
                      <button
                        type="button"
                        style={linkBtn}
                        onClick={() => openEditPermission(p)}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        style={{ ...linkBtn, color: '#c62828' }}
                        onClick={() => deletePermission(p)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'workflows' && (
        <WorkflowTreeView
          workflows={workflows}
          roles={roles}
          canManage={canManage}
          onAddBand={openAddBand}
          onEditBand={openEditBand}
          onDeleteBand={deleteBand}
          onAddStep={openAddStep}
          onEditStep={openEditStep}
          onDeleteStep={deleteStep}
        />
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
            <div style={modalActions}>
              <button type="button" onClick={() => setSelectedUser(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" onClick={saveUserRoles} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {roleModal && (
        <div style={overlay}>
          <div style={{ ...modal, width: 'min(520px, 94vw)' }}>
            <h3 style={{ marginTop: 0 }}>
              {roleModal === 'create' ? 'Create role' : 'Edit role'}
            </h3>
            {roleModal === 'create' && (
              <label style={fieldLabel}>
                Role ID
                <input
                  style={inputStyle}
                  value={roleForm.role_id}
                  onChange={(e) => setRoleForm((f) => ({ ...f, role_id: e.target.value }))}
                  placeholder="ROLE-CUSTOM (optional — auto from name)"
                />
              </label>
            )}
            <label style={fieldLabel}>
              Role name
              <input
                style={inputStyle}
                value={roleForm.role_name}
                onChange={(e) => setRoleForm((f) => ({ ...f, role_name: e.target.value }))}
              />
            </label>
            <label style={fieldLabel}>
              Description
              <textarea
                style={{ ...inputStyle, minHeight: '70px' }}
                value={roleForm.description}
                onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <div style={fieldLabel}>
              Permissions
              <div style={permCheckGrid}>
                {permissions.map((p) => (
                  <label key={p.id} style={{ fontSize: '12px' }}>
                    <input
                      type="checkbox"
                      checked={roleForm.permission_codes.includes(p.code)}
                      onChange={(e) => {
                        setRoleForm((f) => ({
                          ...f,
                          permission_codes: e.target.checked
                            ? [...f.permission_codes, p.code]
                            : f.permission_codes.filter((c) => c !== p.code),
                        }))
                      }}
                    />{' '}
                    {p.code}
                  </label>
                ))}
              </div>
            </div>
            <div style={modalActions}>
              <button type="button" onClick={() => setRoleModal(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={saveRole}
                disabled={busy || !roleForm.role_name.trim()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {permModal && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>
              {permModal === 'create' ? 'Create permission' : 'Edit permission'}
            </h3>
            {permModal === 'create' && (
              <label style={fieldLabel}>
                Permission ID
                <input
                  style={inputStyle}
                  value={permForm.id}
                  onChange={(e) => setPermForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="PERM-CUSTOM (optional)"
                />
              </label>
            )}
            <label style={fieldLabel}>
              Code
              <input
                style={inputStyle}
                value={permForm.code}
                onChange={(e) => setPermForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="module:action"
              />
            </label>
            <label style={fieldLabel}>
              Module
              <input
                style={inputStyle}
                list="perm-modules"
                value={permForm.module}
                onChange={(e) => setPermForm((f) => ({ ...f, module: e.target.value }))}
              />
              <datalist id="perm-modules">
                {permissionModules.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label style={fieldLabel}>
              Description
              <textarea
                style={{ ...inputStyle, minHeight: '70px' }}
                value={permForm.description}
                onChange={(e) => setPermForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <div style={modalActions}>
              <button type="button" onClick={() => setPermModal(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={savePermission}
                disabled={busy || !permForm.code.trim() || !permForm.module.trim()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bandModal && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>
              {bandModal === 'create' ? 'Add amount band' : 'Edit amount band'}
            </h3>
            {bandModal === 'create' && (
              <label style={fieldLabel}>
                Workflow ID
                <input
                  style={inputStyle}
                  value={bandForm.id}
                  onChange={(e) => setBandForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="Auto-generated if blank"
                />
              </label>
            )}
            <label style={fieldLabel}>
              Module
              <select
                style={inputStyle}
                value={bandForm.module}
                onChange={(e) => setBandForm((f) => ({ ...f, module: e.target.value }))}
                disabled={bandModal === 'edit'}
              >
                {WORKFLOW_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {humanModule(m)}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Name
              <input
                style={inputStyle}
                value={bandForm.name}
                onChange={(e) => setBandForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label style={fieldLabel}>
              Min amount
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                value={bandForm.min_amount}
                onChange={(e) => setBandForm((f) => ({ ...f, min_amount: e.target.value }))}
              />
            </label>
            <label
              style={{
                ...fieldLabel,
                flexDirection: 'row',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <input
                type="checkbox"
                checked={bandForm.open_ended}
                onChange={(e) =>
                  setBandForm((f) => ({ ...f, open_ended: e.target.checked }))
                }
              />
              Open-ended max (no upper limit)
            </label>
            {!bandForm.open_ended && (
              <label style={fieldLabel}>
                Max amount
                <input
                  style={inputStyle}
                  type="number"
                  step="0.01"
                  value={bandForm.max_amount}
                  onChange={(e) => setBandForm((f) => ({ ...f, max_amount: e.target.value }))}
                />
              </label>
            )}
            <label
              style={{
                ...fieldLabel,
                flexDirection: 'row',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <input
                type="checkbox"
                checked={bandForm.is_active}
                onChange={(e) => setBandForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
            <div style={modalActions}>
              <button type="button" onClick={() => setBandModal(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" onClick={saveBand} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stepModal && stepWorkflow && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ marginTop: 0 }}>
              {stepModal === 'create' ? 'Add approval step' : 'Edit approval step'}
            </h3>
            <p style={muted}>
              Band: {stepWorkflow.name || stepWorkflow.id} ({humanModule(stepWorkflow.module)})
            </p>
            {stepModal === 'create' && (
              <label style={fieldLabel}>
                Step ID
                <input
                  style={inputStyle}
                  value={stepForm.id}
                  onChange={(e) => setStepForm((f) => ({ ...f, id: e.target.value }))}
                />
              </label>
            )}
            <label style={fieldLabel}>
              Step number
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={stepForm.step_number}
                onChange={(e) => setStepForm((f) => ({ ...f, step_number: e.target.value }))}
              />
            </label>
            <label style={fieldLabel}>
              Step name
              <input
                style={inputStyle}
                value={stepForm.step_name}
                onChange={(e) => setStepForm((f) => ({ ...f, step_name: e.target.value }))}
              />
            </label>
            <label
              style={{
                ...fieldLabel,
                flexDirection: 'row',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <input
                type="checkbox"
                checked={stepForm.use_role}
                onChange={(e) => setStepForm((f) => ({ ...f, use_role: e.target.checked }))}
              />
              Gate by role (uncheck to gate by permission code)
            </label>
            {stepForm.use_role ? (
              <label style={fieldLabel}>
                Required role
                <select
                  style={inputStyle}
                  value={stepForm.required_role_id}
                  onChange={(e) =>
                    setStepForm((f) => ({ ...f, required_role_id: e.target.value }))
                  }
                >
                  <option value="">Select role…</option>
                  {roles.map((r) => (
                    <option key={r.role_id} value={r.role_id}>
                      {r.role_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label style={fieldLabel}>
                Required permission
                <input
                  style={inputStyle}
                  list="step-perms"
                  value={stepForm.required_permission}
                  onChange={(e) =>
                    setStepForm((f) => ({ ...f, required_permission: e.target.value }))
                  }
                />
                <datalist id="step-perms">
                  {permissions.map((p) => (
                    <option key={p.id} value={p.code} />
                  ))}
                </datalist>
              </label>
            )}
            <div style={modalActions}>
              <button
                type="button"
                onClick={() => {
                  setStepModal(null)
                  setStepWorkflow(null)
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="button" onClick={saveStep} disabled={busy}>
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
const subStyle: React.CSSProperties = {
  margin: '0 0 16px',
  color: 'var(--text)',
  fontSize: '14px',
}
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
  flexWrap: 'wrap',
}
const tabBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const tabActive: React.CSSProperties = {
  background: 'var(--text-h)',
  color: '#fff',
  borderColor: 'transparent',
}
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  padding: '8px',
}
const td: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  padding: '8px',
  verticalAlign: 'top',
}
const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1976d2',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: '13px',
}
const sectionToolbar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '12px',
}
const listWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '12px' }
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '12px 14px',
  background: 'var(--bg)',
}
const cardHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'flex-start',
}
const muted: React.CSSProperties = { color: 'var(--text)', fontSize: '12px' }
const chipRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '8px',
}
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
  width: 'min(420px, 92vw)',
  border: '1px solid var(--border)',
  maxHeight: '90vh',
  overflow: 'auto',
}
const modalActions: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginTop: '16px',
  justifyContent: 'flex-end',
}
const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '13px',
  marginBottom: '10px',
  color: 'var(--text-h)',
}
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: '13px',
}
const permCheckGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '6px',
  maxHeight: '220px',
  overflow: 'auto',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '8px',
  marginTop: '4px',
}
