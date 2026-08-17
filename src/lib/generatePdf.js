import jsPDF from 'jspdf'
import { getCompany } from './companies'
import { MLC_ICON } from './logo.js'

const BLUE = [0, 123, 199]
const DARK = [26, 32, 44]
const GREY = [107, 114, 128]
const LIGHT_GREY = [245, 247, 250]
const RED = [220, 38, 38]

// A4 is 297mm tall. Content below this Y triggers a new page; the fixed
// footer always sits at FOOTER_Y on every page.
const PAGE_CONTENT_BOTTOM = 268
const FOOTER_Y = 282

// Robustly parse a date from ANY of the formats this app might hand us,
// without ever falling through to the ambiguous `new Date(string)`
// constructor — that constructor guesses MM/DD/YYYY for slash-separated
// strings, which silently turns "05/08/2026" (5 August, UK format) into
// 8 May. Every call site in this file goes through here instead.
function parseFlexibleDate(input) {
  if (!input) return new Date()
  if (input instanceof Date) return input

  const str = String(input).trim()

  // ISO: 2026-08-05 (with optional time component)
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  // UK slash format: 05/08/2026 -> DD/MM/YYYY (what toLocaleDateString('en-GB') produces)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))

  // Already a readable long date like "5 August 2026" — safe to hand to Date()
  // since there's no numeric ambiguity in this format.
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) return parsed

  return new Date()
}

function docToBase64(doc) {
  const dataUri = doc.output('datauristring')
  return dataUri.split(',')[1]
}

function formatLongDate(d) {
  if (!d) return ''
  const date = d instanceof Date ? d : parseFlexibleDate(d)
  if (isNaN(date.getTime())) return String(d)
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

function addDays(d, n) {
  const date = d instanceof Date ? new Date(d) : new Date(d || Date.now())
  date.setDate(date.getDate() + n)
  return date
}

// Simple vector "house" logo — no network fetch required, so it can
// never be the cause of a failed/slow attachment build.
function drawLogo(doc, x, y, width) {
  const height = width * (908 / 832) // match the icon's real (not-quite-square) aspect ratio
  try {
    doc.addImage(MLC_ICON, 'PNG', x, y, width, height)
  } catch (err) {
    doc.setFillColor(...BLUE)
    doc.roundedRect(x, y, width, height, 2, 2, 'F')
  }
  return height
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function drawCompanyHeader(doc, co, docTitle, docNumber, dateStr, extraLines = []) {
  drawLogo(doc, 14, 8, 24)

  doc.setTextColor(...BLUE)
  doc.setFontSize(12.5)
  doc.setFont(undefined, 'bold')
  doc.text(co.name, 43, 16)

  doc.setTextColor(...GREY)
  doc.setFontSize(8.5)
  doc.setFont(undefined, 'normal')
  doc.text(co.address, 43, 21)
  doc.text(co.phone, 43, 25.5)
  doc.text(co.email, 43, 30)
  doc.setFontSize(7.5)
  doc.text(`Co. Reg: ${co.regNumber}`, 43, 34)

  doc.setTextColor(...DARK)
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.text(docTitle, 196, 18, { align: 'right' })

  doc.setFontSize(9.5)
  let y = 25
  doc.setTextColor(...GREY)
  doc.setFont(undefined, 'normal')
  doc.text(`${docTitle === 'TAX INVOICE' ? 'Invoice' : 'Quote'} #: `, 160, y, { align: 'left' })
  doc.setTextColor(...DARK)
  doc.setFont(undefined, 'bold')
  doc.text(docNumber || '', 196, y, { align: 'right' })
  y += 5

  extraLines.forEach(line => {
    doc.setTextColor(...GREY)
    doc.setFont(undefined, 'normal')
    doc.setFontSize(9)
    doc.text(line.label, 148, y)
    doc.setTextColor(...(line.color || DARK))
    doc.setFont(undefined, 'bold')
    doc.text(line.value, 196, y, { align: 'right' })
    y += 5
  })

  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(14, 40, 196, 40)

  return 48 // next Y position
}

function drawBilledToAndJobDetails(doc, startY, { clientName, clientAddress, clientEmail, siteAddress, services }) {
  doc.setFontSize(8)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...BLUE)
  doc.text('BILLED TO', 14, startY)
  doc.text('JOB DETAILS', 110, startY)

  let leftY = startY + 6
  doc.setTextColor(...DARK)
  doc.setFontSize(10.5)
  doc.setFont(undefined, 'bold')
  doc.text(clientName || 'Customer', 14, leftY)
  leftY += 5

  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREY)
  if (clientAddress) {
    const lines = doc.splitTextToSize(clientAddress, 88)
    doc.text(lines, 14, leftY)
    leftY += lines.length * 4.2
  }
  if (clientEmail) {
    doc.text(clientEmail, 14, leftY)
    leftY += 4.2
  }

  let rightY = startY + 6
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  const valueX = 138 // clears both "Site: " and the wider "Services: " label with room to spare
  const valueWrapWidth = 196 - valueX
  if (siteAddress) {
    doc.setFont(undefined, 'bold')
    doc.text('Site: ', 110, rightY)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...GREY)
    const lines = doc.splitTextToSize(siteAddress, valueWrapWidth)
    doc.text(lines, valueX, rightY)
    rightY += lines.length * 4.2
  }
  if (services) {
    doc.setFont(undefined, 'bold')
    doc.setTextColor(...DARK)
    doc.text('Services: ', 110, rightY)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...GREY)
    const svcText = Array.isArray(services) ? services.join(', ') : services
    const lines = doc.splitTextToSize(svcText, valueWrapWidth)
    doc.text(lines, valueX, rightY)
    rightY += lines.length * 4.2
  }

  return Math.max(leftY, rightY) + 6
}

function drawItemsTable(doc, items, startY, renderContinuationHeader) {
  let y = startY

  function drawColumnHeaderRow() {
    doc.setFillColor(...LIGHT_GREY)
    doc.rect(14, y, 182, 8, 'F')
    doc.setFontSize(8)
    doc.setFont(undefined, 'bold')
    doc.setTextColor(...GREY)
    doc.text('DESCRIPTION', 17, y + 5.5)
    doc.text('QTY', 132, y + 5.5, { align: 'center' })
    doc.text('UNIT PRICE', 165, y + 5.5, { align: 'right' })
    doc.text('TOTAL PRICE', 193, y + 5.5, { align: 'right' })
    y += 12
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...DARK)
  }

  drawColumnHeaderRow()
  let subtotal = 0

  ;(items || []).forEach(item => {
    const qty = Number(item.quantity ?? 1)
    const price = Number(item.unit_price ?? item.price ?? 0)
    const lineTotal = qty * price
    subtotal += lineTotal

    doc.setFontSize(9.5)
    const desc = doc.splitTextToSize(item.description || '', 108)
    const rowHeight = Math.max(7, desc.length * 4.6)

    // This row won't fit in what's left on the page -- start a new one
    // (repeating the letterhead and column headers) instead of letting it
    // run into the footer or off the bottom of the page.
    if (y + rowHeight > PAGE_CONTENT_BOTTOM) {
      doc.addPage()
      y = renderContinuationHeader()
      drawColumnHeaderRow()
      doc.setFontSize(9.5)
    }

    doc.text(desc, 17, y)
    doc.text(String(qty), 132, y, { align: 'center' })
    doc.text(`£${fmtMoney(price)}`, 165, y, { align: 'right' })
    doc.setFont(undefined, 'bold')
    doc.text(`£${fmtMoney(lineTotal)}`, 193, y, { align: 'right' })
    doc.setFont(undefined, 'normal')

    const rowBottom = y + rowHeight
    doc.setDrawColor(230, 230, 230)
    doc.line(14, rowBottom - 2, 196, rowBottom - 2)
    // 3mm gap between the separator and the next row's text -- the old
    // version started the next row only 2mm below the line, which wasn't
    // enough clearance for tall characters' ascenders, so text visibly
    // touched the separator on real (non-trivial) descriptions.
    y = rowBottom + 3
  })

  return { y: y + 4, subtotal }
}

// Ensures at least `needed` mm of space remains before the footer; starts a
// new page (repeating the letterhead) first if not. Used before drawing the
// summary box / payment footer, which are shorter and simpler than the line
// items table but still shouldn't be allowed to collide with the footer.
function ensureSpace(doc, y, needed, renderContinuationHeader) {
  if (y + needed > PAGE_CONTENT_BOTTOM) {
    doc.addPage()
    return renderContinuationHeader()
  }
  return y
}

function drawSummaryBox(doc, startY, { subtotal, discount = 0, total, paid = 0 }) {
  const boxX = 130, boxW = 66
  let y = startY
  const rows = [{ label: 'SUBTOTAL:', value: `£${fmtMoney(subtotal)}` }]
  if (discount > 0) rows.push({ label: 'DISCOUNT:', value: `-£${fmtMoney(discount)}` })
  rows.push({ label: 'TOTAL:', value: `£${fmtMoney(total)}`, bold: true })
  if (paid > 0) rows.push({ label: 'PAID:', value: `£${fmtMoney(paid)}` })

  doc.setFontSize(9.5)
  rows.forEach(r => {
    doc.setFont(undefined, r.bold ? 'bold' : 'normal')
    doc.setTextColor(...GREY)
    doc.text(r.label, boxX, y)
    doc.setTextColor(...DARK)
    doc.text(r.value, 196, y, { align: 'right' })
    y += 6.5
  })

  const balanceDue = total - paid
  doc.setFillColor(...LIGHT_GREY)
  doc.rect(boxX, y - 4.5, boxW, 9, 'F')
  doc.setFont(undefined, 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...GREY)
  doc.text('BALANCE DUE:', boxX + 2, y + 1.5)
  doc.setTextColor(...BLUE)
  doc.text(`£${fmtMoney(balanceDue)}`, 194, y + 1.5, { align: 'right' })

  return y + 12
}

function drawInvoiceFooter(doc, startY, co, { invoiceNumber, total, dueDateStr }) {
  doc.setDrawColor(220, 220, 220)
  doc.line(14, startY, 196, startY)
  let y = startY + 8

  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...BLUE)
  doc.text('How to Pay', 14, y)
  y += 5.5
  doc.setFont(undefined, 'normal')
  doc.setTextColor(...DARK)
  doc.setFontSize(8.5)
  doc.text('We accept payment by: Bank Transfer or Pay Online', 14, y)
  y += 6
  doc.setFont(undefined, 'bold')
  doc.text('Bank Details', 14, y)
  y += 5
  doc.setFont(undefined, 'normal')
  doc.text(`Account Name: ${co.bankAccountName}`, 14, y); y += 4.5
  doc.text(`Sort Code: ${co.sortCode}`, 14, y); y += 4.5
  doc.text(`Account Number: ${co.accountNumber}`, 14, y); y += 5.5
  doc.setTextColor(...RED)
  doc.setFont(undefined, 'bold')
  doc.setFontSize(8)
  doc.text('Note: Please Put Invoice Number As Reference', 14, y)

  // Right column
  let ry = startY + 8
  doc.setTextColor(...DARK)
  doc.setFont(undefined, 'bold')
  doc.setFontSize(9.5)
  doc.text(`Invoice #${invoiceNumber}`, 196, ry, { align: 'right' }); ry += 5.5
  doc.text(`£${fmtMoney(total)} due by ${dueDateStr}`, 196, ry, { align: 'right' }); ry += 5.5
  doc.setFont(undefined, 'italic')
  doc.setTextColor(...GREY)
  doc.setFontSize(8)
  doc.text('Payment Upfront Unless Credit Terms Agreed', 196, ry, { align: 'right' })

  return Math.max(y, ry) + 10
}

function drawFooterOnAllPages(doc, co) {
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(230, 230, 230)
    doc.line(14, FOOTER_Y, 196, FOOTER_Y)
    doc.setFontSize(7)
    doc.setTextColor(...GREY)
    doc.setFont(undefined, 'normal')
    doc.text(
      `Company Registration Number ${co.regNumber} · Registered Office: ${co.name}, ${co.address}, United Kingdom`,
      105, FOOTER_Y + 6, { align: 'center' }
    )
    if (pageCount > 1) {
      doc.setFontSize(7)
      doc.setTextColor(...GREY)
      doc.text(`Page ${i} of ${pageCount}`, 105, FOOTER_Y + 10, { align: 'center' })
    }
  }
}

// ── PUBLIC: Invoice ──────────────────────────────────────────────
export function buildInvoicePdf({
  invoiceNumber, date, dueDays = 3,
  clientName, clientAddress, clientEmail,
  siteAddress, services,
  lineItems, total, discount = 0, paid = 0, vatRate = 0,
  // Pass either company: 'standard' | 'remedials', or a full override object
  // with the same shape as an entry in COMPANIES (name/address/phone/email/
  // regNumber/bankAccountName/sortCode/accountNumber). Defaults to Standard.
  company = 'standard',
}) {
  const co = typeof company === 'string' ? getCompany(company) : { ...getCompany('standard'), ...company }
  const doc = new jsPDF()
  const issueDate = parseFlexibleDate(date)
  const dueDate = addDays(issueDate, dueDays)

  const extraLines = [
    { label: 'Date: ', value: formatLongDate(issueDate) },
    { label: 'Due: ', value: formatLongDate(dueDate), color: RED },
  ]
  // Redraws the same letterhead (logo/company info/doc title/date) on every
  // continuation page -- this is what makes the header "fixed" across a
  // multi-page document rather than only appearing once on page 1.
  const renderContinuationHeader = () => drawCompanyHeader(doc, co, 'TAX INVOICE', invoiceNumber, formatLongDate(issueDate), extraLines)

  let y = renderContinuationHeader()
  y = drawBilledToAndJobDetails(doc, y, { clientName, clientAddress, clientEmail, siteAddress, services })

  const { y: afterTable, subtotal } = drawItemsTable(doc, lineItems, y, renderContinuationHeader)
  const computedTotal = total != null ? Number(total) : subtotal

  y = ensureSpace(doc, afterTable, 40, renderContinuationHeader)
  y = drawSummaryBox(doc, y + 4, { subtotal, discount, total: computedTotal, paid })

  y = ensureSpace(doc, y, 45, renderContinuationHeader)
  drawInvoiceFooter(doc, y, co, { invoiceNumber, total: computedTotal, dueDateStr: formatLongDate(dueDate) })

  drawFooterOnAllPages(doc, co)

  return { doc, base64: docToBase64(doc), filename: `Invoice_${invoiceNumber || 'INV'}.pdf` }
}

// ── PUBLIC: Quote ────────────────────────────────────────────────
export function buildQuotePdf({
  quoteNumber, date, validUntil,
  clientName, clientAddress, clientEmail,
  siteAddress, services,
  lineItems, total, notes,
  company = 'standard',
}) {
  const co = typeof company === 'string' ? getCompany(company) : { ...getCompany('standard'), ...company }
  const doc = new jsPDF()
  const issueDate = parseFlexibleDate(date)

  const extraLines = [
    { label: 'Date: ', value: formatLongDate(issueDate) },
    { label: 'Valid Until: ', value: validUntil ? formatLongDate(validUntil) : 'N/A' },
  ]
  const renderContinuationHeader = () => drawCompanyHeader(doc, co, 'QUOTE', quoteNumber, formatLongDate(issueDate), extraLines)

  let y = renderContinuationHeader()
  y = drawBilledToAndJobDetails(doc, y, { clientName, clientAddress, clientEmail, siteAddress, services })

  const { y: afterTable, subtotal } = drawItemsTable(doc, lineItems, y, renderContinuationHeader)
  const computedTotal = total != null ? Number(total) : subtotal

  y = ensureSpace(doc, afterTable, 40, renderContinuationHeader)
  y = drawSummaryBox(doc, y + 4, { subtotal, total: computedTotal, paid: 0 })

  // Quotes never show bank/account details -- that's invoice-only. Just the
  // acceptance line and any notes.
  y = ensureSpace(doc, y, 30, renderContinuationHeader)
  doc.setDrawColor(220, 220, 220)
  doc.line(14, y, 196, y)
  y += 8

  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.setFont(undefined, 'normal')
  doc.text('To accept this quote, please reply to this email or call us on ' + co.phone + '.', 14, y)
  y += 6
  if (notes) {
    y = ensureSpace(doc, y, 15, renderContinuationHeader)
    doc.setFont(undefined, 'italic')
    doc.setTextColor(...GREY)
    doc.setFontSize(8.5)
    doc.text(doc.splitTextToSize(notes, 180), 14, y)
    y += 10
  }

  drawFooterOnAllPages(doc, co)

  return { doc, base64: docToBase64(doc), filename: `Quote_${quoteNumber || 'QT'}.pdf` }
}
