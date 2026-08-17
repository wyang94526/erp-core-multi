/**
 * Shared supporting-document list + upload for any ERP document.
 */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { attachmentService } from '../api/services'
import type { DocumentType } from '../types'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx'
const MAX_BYTES = 15 * 1024 * 1024

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

export function DocumentAttachmentsPanel({
  documentType,
  documentId,
}: {
  documentType: DocumentType
  documentId?: string | null
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<number | null>(null)
  const id = (documentId || '').trim()
  const queryKey = ['documentAttachments', documentType, id]

  const { data: files = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => attachmentService.list(documentType, id),
    enabled: Boolean(id),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => attachmentService.upload(documentType, id, file),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey })
      if (inputRef.current) inputRef.current.value = ''
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to upload file')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => attachmentService.remove(attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to delete file')
    },
  })

  const handleFiles = (list: FileList | null) => {
    if (!list?.length) return
    const file = list[0]
    if (file.size > MAX_BYTES) {
      setError('File exceeds the 15 MB limit')
      return
    }
    setError(null)
    uploadMutation.mutate(file)
  }

  const handleView = async (file: (typeof files)[number]) => {
    setError(null)
    setOpeningId(file.id)
    try {
      await attachmentService.view(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open document')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div style={cardStyle}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div style={headerRowStyle}>
        <div>
          <h3 style={headingStyle}>Supporting documents</h3>
          <p style={hintStyle}>PDF, images, and Office files up to 15 MB.</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!id || uploadMutation.isPending}
          style={{
            ...uploadButtonStyle,
            opacity: !id || uploadMutation.isPending ? 0.65 : 1,
            cursor: !id || uploadMutation.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {uploadMutation.isPending ? (
            <>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Uploading…
            </>
          ) : (
            <>
              <Upload size={16} />
              Upload PDF
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {!id && (
        <p style={{ ...hintStyle, margin: 0 }}>Save the document first, then attach supporting files.</p>
      )}

      {error && (
        <div style={errorStyle} role="alert">
          {error}
        </div>
      )}

      {id && isLoading && <p style={hintStyle}>Loading documents…</p>}

      {id && !isLoading && files.length === 0 && (
        <p style={{ ...hintStyle, margin: 0 }}>No supporting documents yet.</p>
      )}

      {files.length > 0 && (
        <ul style={listStyle}>
          {files.map((file) => (
            <li key={file.id} style={itemStyle}>
              <FileText size={18} color="#6a1b9a" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => handleView(file)}
                  disabled={openingId === file.id}
                  title="Open in viewer"
                  style={fileLinkStyle}
                >
                  {file.original_filename}
                </button>
                <div style={metaStyle}>
                  {formatBytes(file.file_size)}
                  {file.uploaded_by_name ? ` · ${file.uploaded_by_name}` : ''}
                  {file.uploaded_at ? ` · ${formatWhen(file.uploaded_at)}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleView(file)}
                disabled={openingId === file.id}
                style={linkButtonStyle}
              >
                {openingId === file.id ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <ExternalLink size={14} />
                )}
                {openingId === file.id ? 'Opening…' : 'View'}
              </button>
              <button
                type="button"
                onClick={() => attachmentService.download(file).catch((err) => setError(err.message))}
                style={linkButtonStyle}
              >
                <Paperclip size={14} />
                Download
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete ${file.original_filename}?`)) {
                    deleteMutation.mutate(file.id)
                  }
                }}
                disabled={deleteMutation.isPending}
                style={deleteButtonStyle}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow)',
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 16,
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 4px 0',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: 'var(--text)',
}

const uploadButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  backgroundColor: '#6a1b9a',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const errorStyle: React.CSSProperties = {
  marginBottom: 12,
  color: '#c62828',
  fontSize: 13,
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  backgroundColor: 'var(--social-bg)',
}

const fileNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--text-h)',
  fontSize: 14,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const fileLinkStyle: React.CSSProperties = {
  ...fileNameStyle,
  display: 'block',
  maxWidth: '100%',
  padding: 0,
  border: 'none',
  background: 'none',
  color: '#1565c0',
  textAlign: 'left',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const metaStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text)',
  marginTop: 2,
}

const linkButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  color: '#1565c0',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
}

const deleteButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  color: '#c62828',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
}
