/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type FormEvent } from 'react'
import { exchangeRateService } from '../api/services'
import type { ExchangeRate } from '../types'
import {
  adminCardStyle,
  adminErrorStyle,
  adminFieldStyle,
  adminFormRow,
  adminInputStyle,
  adminPageStyle,
  adminTableStyle,
  adminTdStyle,
  adminThStyle,
  adminTheadStyle,
} from '../utils/adminPageStyles'
import { headerButtonStyle, primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

export default function ExchangeRatesPage() {
  const [rows, setRows] = useState<ExchangeRate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('EUR')
  const [rate, setRate] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))

  const load = () => {
    exchangeRateService.list().then(setRows).catch((err: Error) => setError(err.message))
  }

  useEffect(() => {
    load()
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await exchangeRateService.create({
        quote_currency: currency.trim().toUpperCase(),
        rate_to_base: Number(rate),
        effective_date: effectiveDate,
      })
      setRate('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rate')
    }
  }

  const refresh = async () => {
    setError(null)
    try {
      await exchangeRateService.refresh(effectiveDate)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh rates')
    }
  }

  return (
    <div style={adminPageStyle}>
      <PageHeader
        title="Exchange rates"
        subtitle="Rates are units of the company base currency for one unit of the quote currency. Documents keep the rate from their order date."
      />
      {error ? <p role="alert" style={adminErrorStyle}>{error}</p> : null}
      <form onSubmit={onSubmit} style={{ ...adminCardStyle, ...adminFormRow }}>
        <label style={adminFieldStyle}>
          Quote currency
          <input
            aria-label="Quote currency"
            style={{ ...adminInputStyle, width: 90 }}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={3}
            required
          />
        </label>
        <label style={adminFieldStyle}>
          Rate to base
          <input
            aria-label="Rate to base"
            style={adminInputStyle}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </label>
        <label style={adminFieldStyle}>
          Effective date
          <input
            aria-label="Effective date"
            style={adminInputStyle}
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
          />
        </label>
        <button type="submit" style={{ ...primaryButtonStyle, alignSelf: 'end' }}>
          Save rate
        </button>
        <button type="button" style={{ ...headerButtonStyle, alignSelf: 'end' }} onClick={() => void refresh()}>
          Refresh from Frankfurter
        </button>
      </form>
      <div style={adminCardStyle}>
        <table style={adminTableStyle}>
          <thead>
            <tr style={adminTheadStyle}>
              <th style={adminThStyle}>Date</th>
              <th style={adminThStyle}>Currency</th>
              <th style={adminThStyle}>Rate to base</th>
              <th style={adminThStyle}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={adminTdStyle}>{row.effective_date}</td>
                <td style={adminTdStyle}>{row.quote_currency}</td>
                <td style={adminTdStyle}>{row.rate_to_base}</td>
                <td style={adminTdStyle}>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
