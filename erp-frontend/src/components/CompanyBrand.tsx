/**
 * Letterhead for the shell and sign-in screens.
 * Name, country, and base currency follow the active company.
 */

import { useCompanyLetterhead } from '../hooks/useCompanyProfile'

export function CompanyBrand({
  className,
  heading = false,
}: {
  className: string
  heading?: boolean
}) {
  const { name, detail } = useCompanyLetterhead()
  return (
    <div className={className}>
      {heading ? <h1 className="app-letterhead-name">{name}</h1> : <div>{name}</div>}
      {detail ? <div className="app-letterhead-meta">{detail}</div> : null}
    </div>
  )
}
