/**
 * Company name from Company Profile, used in the shell and sign-in screens.
 */

import { useCompanyName } from '../hooks/useCompanyProfile'

export function CompanyBrand({
  className,
  heading = false,
}: {
  className: string
  heading?: boolean
}) {
  const name = useCompanyName()
  if (heading) {
    return <h1 className={className}>{name}</h1>
  }
  return <div className={className}>{name}</div>
}
