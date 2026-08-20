import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrencyPrecise } from '../hooks/useDashboardData'

export type AiMonthTrendPoint = {
  label: string
  orders: number
  amount: number
  series?: string
}

export type AiMonthTrendSpec = {
  type?: string
  title?: string
  countLabel?: string
  amountLabel?: string
  seriesLabel?: string
  points: AiMonthTrendPoint[]
}

type AiMonthTrendChartProps = {
  spec: AiMonthTrendSpec
}

const SERIES_COLORS = ['#1976d2', '#00897b', '#ef6c00', '#7b1fa2', '#c62828', '#5d4037', '#546e7a']

function compactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0)
}

function pivotSeries(points: AiMonthTrendPoint[]): {
  rows: Array<Record<string, string | number>>
  keys: string[]
} {
  const totals = new Map<string, number>()
  for (const point of points) {
    const name = point.series || ''
    if (!name) continue
    totals.set(name, (totals.get(name) || 0) + (Number(point.amount) || 0))
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const top = ranked.slice(0, 6)
  const keys = ranked.length > 6 ? [...top, 'Other'] : top
  const rowsByLabel = new Map<string, Record<string, string | number>>()
  for (const point of points) {
    const row =
      rowsByLabel.get(point.label) ||
      Object.fromEntries(keys.map((key) => [key, 0]))
    row.label = point.label
    const name = point.series || ''
    const key = top.includes(name) ? name : name ? 'Other' : ''
    if (key) row[key] = Number(row[key] || 0) + (Number(point.amount) || 0)
    rowsByLabel.set(point.label, row)
  }
  return { rows: [...rowsByLabel.values()], keys }
}

export default function AiMonthTrendChart({ spec }: AiMonthTrendChartProps) {
  const points = spec.points.filter((row) => row.label)
  if (points.length === 0) return null

  const countLabel = spec.countLabel || 'Orders'
  const amountLabel = spec.amountLabel || 'Amount'
  const { rows: seriesRows, keys: seriesKeys } = pivotSeries(points)
  const stacked = seriesKeys.length > 0
  const chartData = stacked ? seriesRows : points
  const angled = chartData.length > 5

  return (
    <div className="ai-trend-chart" role="img" aria-label={`${spec.title || 'Monthly trend'} chart`}>
      <div className={`ai-trend-chart-plot${stacked ? ' ai-trend-chart-plot-series' : ''}`}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--text)', fontSize: 11 }}
              interval={0}
              angle={angled ? -32 : 0}
              textAnchor={angled ? 'end' : 'middle'}
              height={angled ? 46 : 28}
            />
            {stacked ? (
              <YAxis
                tick={{ fill: 'var(--text)', fontSize: 10 }}
                width={42}
                tickFormatter={(value) => compactMoney(Number(value) || 0)}
              />
            ) : (
              <>
                <YAxis
                  yAxisId="count"
                  allowDecimals={false}
                  width={28}
                  tick={{ fill: 'var(--text)', fontSize: 10 }}
                />
                <YAxis
                  yAxisId="amount"
                  orientation="right"
                  width={42}
                  tick={{ fill: 'var(--text)', fontSize: 10 }}
                  tickFormatter={(value) => compactMoney(Number(value) || 0)}
                />
              </>
            )}
            <Tooltip
              formatter={(value, name) => {
                const numeric = Number(Array.isArray(value) ? value[0] : value) || 0
                if (stacked || String(name) === amountLabel || String(name) === 'amount') {
                  return [formatCurrencyPrecise(numeric), String(name)]
                }
                return [numeric, countLabel]
              }}
              contentStyle={{
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {stacked ? (
              seriesKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={key}
                  stackId="amount"
                  fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                  maxBarSize={28}
                />
              ))
            ) : (
              <>
                <Bar
                  yAxisId="count"
                  dataKey="orders"
                  name={countLabel}
                  fill="#1976d2"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  yAxisId="amount"
                  type="monotone"
                  dataKey="amount"
                  name={amountLabel}
                  stroke="#00897b"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
