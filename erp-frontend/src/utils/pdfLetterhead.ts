/**
 * Shared company letterhead for Sales / Purchase / Subcontract order PDFs.
 */

import type { jsPDF } from 'jspdf'
import { companyProfileService } from '../api/services'
import type { CompanyAddress, CompanyProfile, Location } from '../types'

/** Teal rule under the letterhead; grey headings stay independent of the logo. */
export const PDF_RULE_RGB: [number, number, number] = [0, 176, 180]
export const PDF_BRAND_RGB: [number, number, number] = [64, 64, 64]
export const PDF_BRAND_ALT_RGB: [number, number, number] = [245, 245, 245]

export type PdfAddress = CompanyAddress & {
  location_id?: string | null
  state_province?: string | null
}

export type CompanyPdfBranding = {
  profile: CompanyProfile
  logoDataUrl: string | null
}

export function emptyCompanyAddress(): CompanyAddress {
  return {
    location_name: '',
    attention_to: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
  }
}

export function formatPdfAddress(loc: PdfAddress | Location | null | undefined, fallback = '—'): string[] {
  if (!loc) return [fallback]
  const lines: string[] = []
  const name = loc.location_name?.trim()
  if (name) lines.push(name)
  const attn = loc.attention_to?.trim() || loc.contact_person?.trim()
  if (attn) lines.push(`Attn: ${attn}`)
  if (loc.address_line1?.trim()) lines.push(loc.address_line1.trim())
  if (loc.address_line2?.trim()) lines.push(loc.address_line2.trim())
  const cityLine = [loc.city, ('state_province' in loc ? loc.state_province : null) || loc.state, loc.postal_code]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
  const country = loc.country?.trim() || ''
  const locality = [cityLine, country].filter(Boolean).join(' ')
  if (locality) lines.push(locality)
  if (loc.contact_person?.trim() && loc.contact_person.trim() !== attn) {
    lines.push(`Contact: ${loc.contact_person.trim()}`)
  }
  if (loc.contact_email?.trim()) lines.push(loc.contact_email.trim())
  if (loc.contact_phone?.trim()) lines.push(loc.contact_phone.trim())
  if (lines.length === 0) {
    const id = 'location_id' in loc ? loc.location_id : null
    lines.push(id?.trim() || fallback)
  }
  return lines
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read logo'))
    reader.readAsDataURL(blob)
  })
}

export async function loadCompanyPdfBranding(): Promise<CompanyPdfBranding> {
  const profile = await companyProfileService.get()
  if (!profile.has_logo) return { profile, logoDataUrl: null }
  try {
    const blob = await companyProfileService.getLogoBlob()
    const logoDataUrl = await blobToDataUrl(blob)
    return { profile, logoDataUrl: logoDataUrl || null }
  } catch {
    return { profile, logoDataUrl: null }
  }
}

export function drawPdfLetterhead(
  doc: jsPDF,
  branding: CompanyPdfBranding | null | undefined,
  documentLabel: string,
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  const profile = branding?.profile
  const companyName = (profile?.company_name || 'Grand-Tek Technology USA').trim()
  let y = 44
  let textX = marginX

  if (branding?.logoDataUrl) {
    try {
      const format = branding.logoDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'
      const logoW = 72
      const logoH = 40
      doc.addImage(branding.logoDataUrl, format, marginX, y - 18, logoW, logoH, undefined, 'FAST')
      textX = marginX + logoW + 12
    } catch {
      textX = marginX
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(40, 40, 40)
  doc.text(companyName, textX, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(90, 90, 90)
  doc.text(documentLabel, pageWidth - marginX, y, { align: 'right' })
  y += 14

  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  const contactBits = [
    profile?.contact_name?.trim() ? `Contact: ${profile.contact_name.trim()}` : '',
    profile?.contact_email?.trim() || '',
    profile?.contact_phone?.trim() ? `Tel: ${profile.contact_phone.trim()}` : '',
  ].filter(Boolean)
  if (contactBits.length) {
    doc.text(contactBits.join('  ·  '), textX, y)
    y += 12
  } else {
    y += 4
  }

  doc.setDrawColor(...PDF_RULE_RGB)
  doc.setLineWidth(1.5)
  doc.line(marginX, y + 4, pageWidth - marginX, y + 4)
  return y + 26
}

export function drawBillShipBlocks(
  doc: jsPDF,
  billTo: PdfAddress | Location | null | undefined,
  shipTo: PdfAddress | Location | null | undefined,
  startY: number,
  fallbacks: { bill?: string; ship?: string } = {},
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 48
  const colWidth = (pageWidth - marginX * 2 - 24) / 2
  const leftX = marginX
  const rightX = marginX + colWidth + 24
  let y = startY

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Bill To', leftX, y)
  doc.text('Ship To', rightX, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const wrap = (lines: string[]) =>
    lines.flatMap((line) => doc.splitTextToSize(line, colWidth) as string[])
  const billLines = wrap(formatPdfAddress(billTo, fallbacks.bill || '—'))
  const shipLines = wrap(formatPdfAddress(shipTo, fallbacks.ship || '—'))
  const maxLines = Math.max(billLines.length, shipLines.length, 1)
  for (let i = 0; i < maxLines; i += 1) {
    if (billLines[i]) doc.text(billLines[i], leftX, y)
    if (shipLines[i]) doc.text(shipLines[i], rightX, y)
    y += 13
  }
  return y + 18
}

export function companyFooterLine(profile: CompanyProfile | null | undefined): string {
  return `${(profile?.company_name || 'Grand-Tek Technology USA').trim()} · Confidential`
}
