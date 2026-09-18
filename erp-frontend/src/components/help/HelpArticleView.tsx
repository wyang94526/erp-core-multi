/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { HelpArticle, HelpCalloutKind } from '../../data/userGuideData'

const CALLOUT_LABEL: Record<HelpCalloutKind, string> = {
  tip: 'Tip',
  important: 'Important',
  required: 'Required Fields',
}

type HelpArticleViewProps = {
  article: HelpArticle
  compact?: boolean
}

export default function HelpArticleView({ article, compact = false }: HelpArticleViewProps) {
  return (
    <article className="help-article" aria-labelledby={`help-title-${article.id}`}>
      <header className="help-article-header">
        <h2 id={`help-title-${article.id}`} className="help-article-title">
          {article.title}
        </h2>
        <p className="help-article-summary">{article.summary}</p>
      </header>

      {article.callouts && article.callouts.length > 0 && (
        <div className="help-callout-list">
          {article.callouts.map((callout) => (
            <p key={`${callout.kind}-${callout.text}`} className={`help-callout help-callout-${callout.kind}`}>
              <span className="help-callout-badge">{CALLOUT_LABEL[callout.kind]}</span>
              {callout.text}
            </p>
          ))}
        </div>
      )}

      {article.screenshots && article.screenshots.length > 0 && (
        <div className="help-screenshots">
          {article.screenshots.map((shot) => (
            <figure key={shot.src + shot.caption} className="help-screenshot">
              <img
                className={`help-screenshot-img${compact ? ' compact' : ''}`}
                src={shot.src}
                alt={shot.caption}
              />
              <figcaption>{shot.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <Accordion title="Step-by-step" defaultOpen>
        <ol className="help-steps">
          {article.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </Accordion>

      {article.tips && article.tips.length > 0 && (
        <Accordion title="Tips" defaultOpen={!compact}>
          <ul className="help-list">
            {article.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </Accordion>
      )}

      {article.faqs && article.faqs.length > 0 && (
        <Accordion title="FAQs" defaultOpen={false}>
          <dl className="help-faq">
            {article.faqs.map((faq) => (
              <div key={faq.question}>
                <dt>{faq.question}</dt>
                <dd>{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </Accordion>
      )}

      {article.troubleshooting && article.troubleshooting.length > 0 && (
        <Accordion title="Common Issues & Troubleshooting" defaultOpen={compact}>
          <dl className="help-faq">
            {article.troubleshooting.map((item) => (
              <div key={item.issue}>
                <dt>{item.issue}</dt>
                <dd>{item.fix}</dd>
              </div>
            ))}
          </dl>
        </Accordion>
      )}

      {compact && (
        <p className="help-open-full">
          <Link to={`/help/${article.id}`}>Open full article in User Guide →</Link>
        </p>
      )}
    </article>
  )
}

function Accordion({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="help-accordion">
      <h3>
        <button
          type="button"
          className="help-accordion-trigger"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{title}</span>
          <span aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </h3>
      {open && <div className="help-accordion-body">{children}</div>}
    </section>
  )
}
