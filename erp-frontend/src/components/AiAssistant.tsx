/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { aiService, type AiPendingAction } from '../api/services'
import {
  exportAiChatTurns,
  pairAiChatTurns,
  turnForAssistantMessage,
  type AiChatTurn,
} from '../utils/generateAiChatExport'
import SimpleMarkdown from './SimpleMarkdown'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

function buildPageContext(pathname: string): Record<string, string | undefined> {
  const ctx: Record<string, string | undefined> = { route: pathname }
  const so = pathname.match(/^\/orders\/([^/]+)/)
  if (so) {
    ctx.sales_order_id = so[1]
    ctx.entity_id = so[1]
    ctx.entity_type = 'sales_order'
  }
  const po = pathname.match(/^\/purchase-orders\/([^/]+)/)
  if (po && po[1] !== 'new') {
    ctx.purchase_order_id = po[1]
    ctx.entity_id = po[1]
    ctx.entity_type = 'purchase_order'
  }
  const sco = pathname.match(/^\/subcontract-orders\/([^/]+)/)
  if (sco && sco[1] !== 'new') {
    ctx.subcontract_order_id = sco[1]
    ctx.entity_id = sco[1]
    ctx.entity_type = 'subcontract_order'
  }
  const item = pathname.match(/^\/items\/([^/]+)/)
  if (item && item[1] !== 'new') {
    ctx.item_id = item[1]
    ctx.entity_id = item[1]
    ctx.entity_type = 'item'
  }
  const customer = pathname.match(/^\/customers\/([^/]+)/)
  if (customer && customer[1] !== 'new') {
    ctx.customer_id = customer[1]
    ctx.entity_id = customer[1]
    ctx.entity_type = 'customer'
  }
  const vendor = pathname.match(/^\/vendors\/([^/]+)/)
  if (vendor && vendor[1] !== 'new') {
    ctx.supplier_id = vendor[1]
    ctx.entity_id = vendor[1]
    ctx.entity_type = 'vendor'
  }
  return ctx
}

type AiAssistantProps = {
  open: boolean
  onClose: () => void
}

const DRAWER_WIDTH_KEY = 'erp-ai-drawer-width'
const DEFAULT_DRAWER_WIDTH = 420
const MIN_DRAWER_WIDTH = 360
const SNAP_WIDE_WIDTH = 960

function clampDrawerWidth(width: number): number {
  const max = Math.max(MIN_DRAWER_WIDTH, window.innerWidth - 48)
  return Math.min(max, Math.max(MIN_DRAWER_WIDTH, Math.round(width)))
}

function readStoredDrawerWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY))
    if (Number.isFinite(stored) && stored >= MIN_DRAWER_WIDTH) {
      return clampDrawerWidth(stored)
    }
  } catch {
    /* ignore quota / private mode */
  }
  return DEFAULT_DRAWER_WIDTH
}

function persistDrawerWidth(width: number) {
  try {
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(width))
  } catch {
    /* ignore quota / private mode */
  }
}

export default function AiAssistant({ open, onClose }: AiAssistantProps) {
  const location = useLocation()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi — I can look up **the whole ERP**: customers, vendors, items/BOMs, orders, inventory, and finance. Try “How many active customers?” or “How many items with BOM details?”.',
    },
  ])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<AiPendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'md' | string | null>(null)
  const [width, setWidth] = useState(DEFAULT_DRAWER_WIDTH)
  const [dragging, setDragging] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({ startX: 0, startWidth: DEFAULT_DRAWER_WIDTH })
  const widthRef = useRef(width)
  widthRef.current = width
  const turns = useMemo(() => pairAiChatTurns(messages), [messages])
  const canExport = turns.length > 0 && !loading

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, loading])

  useEffect(() => {
    if (!open) return
    setWidth(readStoredDrawerWidth())
  }, [open])

  useEffect(() => {
    if (!dragging) return
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (event: globalThis.PointerEvent) => {
      const next = clampDrawerWidth(
        dragRef.current.startWidth + (dragRef.current.startX - event.clientX),
      )
      widthRef.current = next
      setWidth(next)
    }
    const onUp = () => {
      persistDrawerWidth(widthRef.current)
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  useEffect(() => {
    if (!open) return
    const onResize = () => setWidth((current) => clampDrawerWidth(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError(null)
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)
    try {
      const res = await aiService.chat({
        message: text,
        conversation_id: conversationId,
        page_context: buildPageContext(location.pathname),
      })
      setConversationId(res.conversation_id)
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: res.reply },
      ])
      if (res.pending_action?.action_id) {
        setPending(res.pending_action)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat request failed')
    } finally {
      setLoading(false)
    }
  }

  const confirmAction = async () => {
    if (!pending || confirming) return
    setConfirming(true)
    setError(null)
    try {
      const res = await aiService.confirm({
        action_id: pending.action_id,
        conversation_id: conversationId,
      })
      setMessages((prev) => [
        ...prev,
        { id: `c-${Date.now()}`, role: 'assistant', content: res.reply },
      ])
      setPending(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed')
    } finally {
      setConfirming(false)
    }
  }

  const exportTurns = async (target: AiChatTurn[], format: 'pdf' | 'md', exportKey: string) => {
    if (!target.length || exporting) return
    setExporting(exportKey)
    setError(null)
    try {
      await exportAiChatTurns(target, format)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth <= 640) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current }
    setDragging(true)
  }

  const snapResize = () => {
    const wide = clampDrawerWidth(Math.min(SNAP_WIDE_WIDTH, window.innerWidth * 0.7))
    const next = widthRef.current >= wide - 24 ? DEFAULT_DRAWER_WIDTH : wide
    const clamped = clampDrawerWidth(next)
    widthRef.current = clamped
    setWidth(clamped)
    persistDrawerWidth(clamped)
  }

  const nudgeWidth = (delta: number) => {
    const next = clampDrawerWidth(widthRef.current + delta)
    widthRef.current = next
    setWidth(next)
    persistDrawerWidth(next)
  }

  if (!open) return null

  return (
    <>
      <div
        className="ai-drawer-backdrop"
        onClick={dragging ? undefined : onClose}
        aria-hidden
      />
      <aside
        className={`ai-drawer${dragging ? ' ai-drawer-dragging' : ''}`}
        aria-label="AI Assistant"
        style={{ width }}
      >
        <button
          type="button"
          className="ai-drawer-resizer"
          aria-label="Resize AI Assistant"
          title="Drag to resize. Double-click to snap wide or compact."
          onPointerDown={startResize}
          onDoubleClick={snapResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              nudgeWidth(24)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              nudgeWidth(-24)
            } else if (event.key === 'Home') {
              event.preventDefault()
              snapResize()
            }
          }}
        />
        <header className="ai-drawer-header">
          <div>
            <div className="ai-drawer-title">AI Assistant</div>
            <div className="ai-drawer-sub">Grand-Tek Technology USA agent</div>
          </div>
          <div className="ai-drawer-header-actions">
            <button
              type="button"
              className="ai-drawer-export"
              onClick={() => void exportTurns(turns, 'pdf', 'all-pdf')}
              disabled={!canExport || Boolean(exporting)}
              title="Export prompts and responses as PDF"
            >
              {exporting === 'all-pdf' ? <Loader2 size={14} className="ai-export-spin" /> : <FileDown size={14} />}
              PDF
            </button>
            <button
              type="button"
              className="ai-drawer-export"
              onClick={() => void exportTurns(turns, 'md', 'all-md')}
              disabled={!canExport || Boolean(exporting)}
              title="Export prompts and responses as Markdown"
            >
              {exporting === 'all-md' ? <Loader2 size={14} className="ai-export-spin" /> : <FileDown size={14} />}
              MD
            </button>
            <button type="button" className="ai-drawer-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="ai-drawer-messages">
          {messages.map((m) => {
            const turn = m.role === 'assistant' ? turnForAssistantMessage(turns, m.id) : null
            return (
              <div key={m.id} className={`ai-bubble ai-bubble-${m.role}`}>
                {m.role === 'assistant' ? (
                  <SimpleMarkdown content={m.content} onInternalNavigate={onClose} />
                ) : (
                  <p>{m.content}</p>
                )}
                {turn && (
                  <div className="ai-bubble-export-row">
                    <button
                      type="button"
                      className="ai-bubble-export"
                      onClick={() => void exportTurns([turn], 'pdf', `${m.id}-pdf`)}
                      disabled={Boolean(exporting)}
                      title="Export this prompt and response as PDF"
                    >
                      {exporting === `${m.id}-pdf` ? (
                        <Loader2 size={12} className="ai-export-spin" />
                      ) : (
                        <FileDown size={12} />
                      )}
                      PDF
                    </button>
                    <button
                      type="button"
                      className="ai-bubble-export"
                      onClick={() => void exportTurns([turn], 'md', `${m.id}-md`)}
                      disabled={Boolean(exporting)}
                      title="Export this prompt and response as Markdown"
                    >
                      {exporting === `${m.id}-md` ? (
                        <Loader2 size={12} className="ai-export-spin" />
                      ) : (
                        <FileDown size={12} />
                      )}
                      MD
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {loading && (
            <div className="ai-bubble ai-bubble-assistant ai-typing">Thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <div className="ai-drawer-error">{error}</div>}

        <form className="ai-drawer-compose" onSubmit={send}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about customers, BOMs, orders, inventory, finance…"
            rows={2}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </aside>

      {pending && (
        <div className="ai-confirm-overlay" role="dialog" aria-modal="true">
          <div className="ai-confirm-modal">
            <h3>Confirm action</h3>
            <p>{pending.summary}</p>
            {pending.payload && (
              <pre className="ai-confirm-payload">
                {JSON.stringify(pending.payload, null, 2)}
              </pre>
            )}
            <div className="ai-confirm-actions">
              <button
                type="button"
                className="ai-confirm-cancel"
                onClick={() => setPending(null)}
                disabled={confirming}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ai-confirm-ok"
                onClick={() => void confirmAction()}
                disabled={confirming}
              >
                {confirming ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
