/**
 * Capture live UI screenshots for the in-app User Guide.
 * Requires Vite on :5173, API on :8000, and Google Chrome.
 *
 *   node scripts/capture-help-screenshots.mjs
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '../public/guide-screenshots')
const BASE = process.env.GUIDE_BASE_URL || 'http://127.0.0.1:5173'
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const EMAIL = process.env.GUIDE_EMAIL || 'wendy.yang@grand-tek.com'
const PASSWORD = process.env.GUIDE_PASSWORD || 'Password123!'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function ready(page) {
  await page.waitForSelector('.app-topbar-title', { timeout: 20000 })
  await sleep(600)
}

async function shot(page, name) {
  const dest = path.join(OUT, `${name}.jpg`)
  await page.screenshot({
    path: dest,
    type: 'jpeg',
    quality: 82,
  })
  console.log('saved', dest)
}

async function clickText(page, pattern) {
  await page.evaluate((source) => {
    const re = new RegExp(source, 'i')
    const nodes = [...document.querySelectorAll('button, a, [role="tab"]')]
    const match = nodes.find((el) => re.test((el.textContent || '').trim()))
    match?.click()
  }, pattern)
}

async function scrollToText(page, text) {
  await page.evaluate((needle) => {
    const match = [...document.querySelectorAll('h2, h3, h4, legend, div, span')].find(
      (el) => (el.textContent || '').trim() === needle,
    )
    match?.scrollIntoView({ block: 'center' })
  }, text)
  await sleep(300)
}

const pages = [
  { name: 'dashboard', path: '/' },
  { name: 'sales-orders', path: '/sales-orders' },
  { name: 'sales-order-form', path: '/orders/new' },
  { name: 'purchase-order-form', path: '/purchase-orders/new' },
  { name: 'purchase-order-receive', path: '/purchase-orders/PO-AI-F81EF34E' },
  { name: 'vendor-form', path: '/vendors/SUP-006/edit' },
  { name: 'sco-form', path: '/subcontract-orders/new' },
  { name: 'sco-detail', path: '/subcontract-orders/SCO-00004' },
  { name: 'inventory', path: '/inventory' },
  { name: 'item-detail', path: '/items/PROD-1001G' },
  { name: 'stock-movements', path: '/inventory/movements' },
  { name: 'warehouses', path: '/inventory/warehouses' },
  { name: 'customer-form', path: '/customers/CUST-001/edit' },
  { name: 'sales-invoices', path: '/sales-invoices' },
  { name: 'ar-aging', path: '/accounts-receivable' },
  { name: 'supplier-invoice-form', path: '/supplier-invoices/new' },
  { name: 'ap-aging', path: '/accounts-payable' },
  { name: 'admin-rbac', path: '/admin/rbac' },
  { name: 'admin-import', path: '/admin/data-import' },
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  args: [
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=/tmp/erp-help-chrome-${Date.now()}`,
  ],
})

try {
  await mkdir(OUT, { recursive: true })
  const page = await browser.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('input[type="email"]')
  await page.type('input[type="email"]', EMAIL)
  await page.type('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ])
  await ready(page)
  await shot(page, 'topbar')

  for (const item of pages) {
    await page.goto(`${BASE}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await ready(page)
    if (item.name === 'vendor-form') {
      await scrollToText(page, 'International Banking & Remittance')
      await shot(page, 'vendor-banking')
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(200)
    }
    if (item.name === 'customer-form') {
      await shot(page, 'customer-form')
      await clickText(page, 'Bill-To Locations')
      await sleep(400)
      await shot(page, 'customer-shipto')
      continue
    }
    if (item.name === 'admin-rbac') {
      await shot(page, 'admin-rbac')
      await clickText(page, 'workflows')
      await sleep(500)
      await shot(page, 'admin-workflows')
      continue
    }
    await shot(page, item.name)
  }

  await page.goto(`${BASE}/help/dashboard-overview`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await ready(page)
  await shot(page, 'help-guide')

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await ready(page)
  await page.click('button.help-launcher')
  await page.waitForSelector('.help-drawer', { timeout: 10000 })
  await sleep(400)
  await shot(page, 'help-drawer')
} finally {
  await browser.close()
}
