/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { itemBomService } from '../api/services'
import type { ItemBOMHeader } from '../types'

export function BomVersionToolbar({
  itemId,
  selectedHeaderId,
  onSelect,
  disabled,
}: {
  itemId: string
  selectedHeaderId: number | null
  onSelect: (headerId: number | null) => void
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: headers = [] } = useQuery({
    queryKey: ['itemBomHeaders', itemId],
    queryFn: () => itemBomService.listHeaders(itemId),
    enabled: Boolean(itemId),
  })

  const selected =
    headers.find((h) => h.bom_header_id === selectedHeaderId) ??
    headers.find((h) => h.status === 'active') ??
    headers[headers.length - 1] ??
    null

  useEffect(() => {
    if (selected && selected.bom_header_id !== selectedHeaderId) {
      onSelect(selected.bom_header_id)
    }
  }, [selected, selectedHeaderId, onSelect])

  const invalidate = async (header?: ItemBOMHeader) => {
    await queryClient.invalidateQueries({ queryKey: ['itemBomHeaders', itemId] })
    await queryClient.invalidateQueries({ queryKey: ['itemBom', itemId] })
    if (header) onSelect(header.bom_header_id)
  }

  const createVersion = useMutation({
    mutationFn: () =>
      itemBomService.createVersion(itemId, {
        copy_from_header_id: selected?.bom_header_id,
      }),
    onSuccess: (header) => invalidate(header),
  })

  const activate = useMutation({
    mutationFn: () => itemBomService.activateVersion(itemId, selected!.bom_header_id),
    onSuccess: (header) => invalidate(header),
  })

  const readOnly = selected?.status === 'obsolete'

  return (
    <div style={barStyle}>
      <label style={labelStyle}>
        Version
        <select
          value={selected?.bom_header_id ?? ''}
          onChange={(event) => onSelect(Number(event.target.value) || null)}
          disabled={!headers.length}
          style={selectStyle}
        >
          {headers.length === 0 ? (
            <option value="">v1 (will be created)</option>
          ) : (
            headers.map((header) => (
              <option key={header.bom_header_id} value={header.bom_header_id}>
                v{header.version_no} · {header.status}
              </option>
            ))
          )}
        </select>
      </label>
      <button
        type="button"
        style={btnStyle}
        disabled={disabled || createVersion.isPending}
        onClick={() => createVersion.mutate()}
      >
        {createVersion.isPending ? 'Copying…' : 'New version'}
      </button>
      <button
        type="button"
        style={btnStyle}
        disabled={disabled || !selected || selected.status === 'active' || activate.isPending}
        onClick={() => activate.mutate()}
      >
        {activate.isPending ? 'Activating…' : 'Activate'}
      </button>
      {readOnly ? (
        <span style={noteStyle}>Obsolete versions are read-only.</span>
      ) : (
        <span style={noteStyle}>
          Subcontract orders pin the active version at create time.
        </span>
      )}
    </div>
  )
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
  alignItems: 'center',
  marginBottom: '12px',
}
const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: 'var(--text-h)',
  fontWeight: 600,
}
const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
}
const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '13px',
}
const noteStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--text)' }
