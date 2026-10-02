import type { jsPDF } from 'jspdf'

/**
 * Save a jsPDF document with an explicit filename.
 *
 * jsPDF's doc.save() uses FileSaver + a blob URL. On insecure origins
 * (http://public-ip, like OCI) Chrome often leaves the file as
 * "Unconfirmed ######.crdownload" instead of renaming it to the PDF name.
 */
export function downloadPdf(doc: jsPDF, filename: string): void {
  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'document.pdf'
  const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
    link.remove()
  }, 2000)
}
