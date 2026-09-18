/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Sparkles } from 'lucide-react'
import type { DashboardUrgentSummary } from '../../types/dashboard'

type GreetingBannerProps = {
  fullName: string
  roleName: string
  urgent: DashboardUrgentSummary
}

export default function GreetingBanner({ fullName, roleName, urgent }: GreetingBannerProps) {
  const firstName = fullName.trim().split(/\s+/)[0] || fullName

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #e3f2fd 0%, #f5f9fc 55%, #ffffff 100%)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px 24px',
        marginBottom: '20px',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: '#1976d2',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Sparkles size={20} />
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-h)', fontWeight: 700 }}>
          Welcome back, {firstName}{' '}
          <span style={{ color: '#1565c0', fontWeight: 600 }}>({roleName})</span>
        </h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text)', fontSize: '0.95rem', lineHeight: 1.45 }}>
          {urgent.message}
        </p>
      </div>
    </div>
  )
}
