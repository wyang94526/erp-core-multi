/**
 * Shared page header for reports, summary lists, and document pages.
 * Matches Sales Invoice / Supplier Invoice (documentPageStyles).
 */

import type { ReactNode } from 'react'
import {
  actionRowStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
} from '../utils/documentPageStyles'

type PageHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <header style={documentPageHeaderStyle}>
      <div style={documentPageTitleBlockStyle}>
        <h1 style={documentPageTitleStyle}>{title}</h1>
        {subtitle ? <div style={documentPageSubStyle}>{subtitle}</div> : null}
      </div>
      {children ? (
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>{children}</div>
        </div>
      ) : null}
    </header>
  )
}

export default PageHeader
