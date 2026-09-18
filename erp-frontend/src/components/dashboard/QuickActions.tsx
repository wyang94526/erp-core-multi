/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link } from 'react-router-dom'
import type { QuickAction } from '../../types/dashboard'
import { sectionStyle, sectionTitleStyle } from './dashboardStyles'

type QuickActionsProps = {
  actions: QuickAction[]
}

export default function QuickActions({ actions }: QuickActionsProps) {
  return (
    <div style={sectionStyle}>
      <h3 style={sectionTitleStyle}>Quick Actions</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.id}
              to={action.to}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: '#e3f2fd',
                color: '#1565c0',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              <Icon size={16} />
              {action.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
