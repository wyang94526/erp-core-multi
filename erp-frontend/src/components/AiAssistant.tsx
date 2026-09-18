/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { aiService, type AiPendingAction } from '../api/services'
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
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, loading])

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

  if (!open) return null

  return (
    <>
      <div className="ai-drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className="ai-drawer" aria-label="AI Assistant">
        <header className="ai-drawer-header">
          <div>
            <div className="ai-drawer-title">AI Assistant</div>
            <div className="ai-drawer-sub">Grand-Tek Technology USA agent</div>
          </div>
          <button type="button" className="ai-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="ai-drawer-messages">
          {messages.map((m) => (
            <div key={m.id} className={`ai-bubble ai-bubble-${m.role}`}>
              {m.role === 'assistant' ? (
                <SimpleMarkdown content={m.content} />
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          ))}
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
