/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MonthlyTrendPoint } from '../../types/dashboard'
import { formatCurrency } from '../../hooks/useDashboardData'
import { useCompanyCurrency } from '../../hooks/useCompanyProfile'
import { formatMoney } from '../../utils/currency'
import { sectionStyle, sectionTitleStyle } from './dashboardStyles'

type TrendChartProps = {
  data: MonthlyTrendPoint[]
  title?: string
}

export default function TrendChart({
  data,
  title = 'Monthly Sales vs Purchasing',
}: TrendChartProps) {
  const currency = useCompanyCurrency()
  return (
    <div style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--text)', fontSize: 12 }} />
            <YAxis
              tick={{ fill: 'var(--text)', fontSize: 12 }}
              tickFormatter={(v) => formatMoney(Number(v) || 0, currency, { compact: true })}
            />
            <Tooltip
              formatter={(value) => formatCurrency(Number(value) || 0, currency)}
              contentStyle={{
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="salesTotal"
              name="Sales"
              stroke="#1976d2"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="purchasingTotal"
              name="Purchasing"
              stroke="#00897b"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
