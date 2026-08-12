/** Lightweight Markdown renderer for AI chat replies (no extra deps). */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineFormat(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return html
}

export default function SimpleMarkdown({ content }: { content: string }) {
  const blocks = content.split(/```/)
  const htmlParts: string[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (i % 2 === 1) {
      const lines = block.split('\n')
      const code = lines[0]?.match(/^[a-zA-Z0-9_-]+$/) ? lines.slice(1).join('\n') : block
      htmlParts.push(`<pre class="ai-code"><code>${escapeHtml(code.replace(/^\n/, ''))}</code></pre>`)
      continue
    }
    const paragraphs = block.split(/\n{2,}/)
    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (!trimmed) continue
      const lines = trimmed.split('\n').map((line) => {
        if (/^###\s+/.test(line)) return `<h4>${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`
        if (/^##\s+/.test(line)) return `<h3>${inlineFormat(line.replace(/^##\s+/, ''))}</h3>`
        if (/^#\s+/.test(line)) return `<h3>${inlineFormat(line.replace(/^#\s+/, ''))}</h3>`
        if (/^[-*]\s+/.test(line)) return `<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`
        return inlineFormat(line)
      })
      const joined = lines.join('<br/>')
      if (lines.every((l) => l.startsWith('<li>'))) {
        htmlParts.push(`<ul>${lines.join('')}</ul>`)
      } else if (joined.startsWith('<h')) {
        htmlParts.push(joined)
      } else {
        htmlParts.push(`<p>${joined}</p>`)
      }
    }
  }

  return (
    <div
      className="ai-markdown"
      dangerouslySetInnerHTML={{ __html: htmlParts.join('') }}
    />
  )
}
