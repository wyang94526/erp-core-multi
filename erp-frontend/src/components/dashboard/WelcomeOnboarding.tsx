/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { ReactNode } from 'react'
import { HandHeart, ShieldCheck, UserRound } from 'lucide-react'
import { containerStyle } from './dashboardStyles'
import { useCompanyLetterhead } from '../../hooks/useCompanyProfile'
import { PageHeader } from '../PageHeader'

type WelcomeOnboardingProps = {
  fullName: string
}

export default function WelcomeOnboarding({ fullName }: WelcomeOnboardingProps) {
  const firstName = fullName.trim().split(/\s+/)[0] || fullName || 'there'
  const { name, detail } = useCompanyLetterhead()
  const subtitle = detail ? `Get started with ${name} · ${detail}` : `Get started with ${name}`

  return (
    <div style={containerStyle}>
      <PageHeader title="Welcome" subtitle={subtitle} />

      <section
        style={{
          background:
            'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(147, 51, 234, 0.06) 45%, #ffffff 100%)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '28px 28px 24px',
          boxShadow: 'var(--shadow)',
          marginBottom: 20,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
          }}
        >
          Onboarding
        </p>
        <h3
          style={{
            margin: '10px 0 8px',
            fontSize: '1.75rem',
            color: 'var(--text-h)',
            fontWeight: 700,
          }}
        >
          Welcome, {firstName}
        </h3>
        <p style={{ margin: 0, color: 'var(--text)', fontSize: '1rem', lineHeight: 1.55, maxWidth: 640 }}>
          Your account was created successfully. Your role is currently{' '}
          <strong>Unassigned</strong>, so module access is limited until an administrator
          assigns the right role for your work.
        </p>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <OnboardingCard
          icon={<UserRound size={20} />}
          title="Account ready"
          body="You can sign in anytime with your work email and password."
        />
        <OnboardingCard
          icon={<ShieldCheck size={20} />}
          title="Role pending"
          body="Ask an admin to assign Sales, Purchasing, Inventory, Finance, or another role in Users & Roles."
        />
        <OnboardingCard
          icon={<HandHeart size={20} />}
          title="What happens next"
          body="Once your role is assigned, refresh or sign in again to see your personalized dashboard and menus."
        />
      </div>
    </div>
  )
}

function OnboardingCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <article
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg)',
        padding: '18px 16px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent-bg)',
          color: 'var(--accent)',
          marginBottom: 12,
        }}
      >
        {icon}
      </div>
      <h4 style={{ margin: '0 0 6px', fontSize: '1rem', color: 'var(--text-h)' }}>{title}</h4>
      <p style={{ margin: 0, color: 'var(--text)', fontSize: 14, lineHeight: 1.45 }}>{body}</p>
    </article>
  )
}
