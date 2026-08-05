import jsPDF from 'jspdf'

// ── Company constants — matches the real invoice template exactly ──
const CO = {
  name: 'My Landlord Certificate LTD',
  address: '134 Merton High Street, London, SW19 1BA',
  phone: '+44 020 3996 1070',
  email: 'info@mylandlordcertificate.co.uk',
  regNumber: '17265132',
  bankAccountName: 'My Landlord Certificate LTD',
  sortCode: '60-83-71',
  accountNumber: '83356126',
}

const BLUE = [0, 123, 199]
const DARK = [26, 32, 44]
const GREY = [107, 114, 128]
const LIGHT_GREY = [245, 247, 250]
const RED = [220, 38, 38]

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
function drawLogo(doc, x, y, size) {
  doc.setFillColor(...BLUE)
  doc.roundedRect(x, y, size, size, 2, 2, 'F')
  doc.setFillColor(255, 255, 255)
  // simple house shape
  const cx = x + size / 2
  doc.triangle(x + size * 0.15, y + size * 0.5, cx, y + size * 0.15, x + size * 0.85, y + size * 0.5, 'F')
  doc.rect(x + size * 0.25, y + size * 0.5, size * 0.5, size * 0.35, 'F')
  doc.setFillColor(128, 209, 0)
  doc.circle(x + size * 0.78, y + size * 0.28, size * 0.14, 'F')
}

function drawCompanyHeader(doc, docTitle, docNumber, dateStr, extraLines = []) {
  drawLogo(doc, 14, 12, 14)

  doc.setTextColor(...BLUE)
  doc.setFontSize(12.5)
  doc.setFont(undefined, 'bold')
  doc.text(CO.name, 31, 17)

  doc.setTextColor(...GREY)
  doc.setFontSize(8.5)
  doc.setFont(undefined, 'normal')
  doc.text(CO.address, 31, 22)
  doc.text(CO.phone, 31, 26.5)
  doc.text(CO.email, 31, 31)
  doc.setFontSize(7.5)
  doc.text(`Co. Reg: ${CO.regNumber}`, 31, 35)

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
    doc.setFontSize(9.5)
    doc.text(line.label, 160, y)
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
  if (siteAddress) {
    doc.setFont(undefined, 'bold')
    doc.text('Site: ', 110, rightY)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...GREY)
    const lines = doc.splitTextToSize(siteAddress, 78)
    doc.text(lines, 122, rightY)
    rightY += lines.length * 4.2
  }
  if (services) {
    doc.setFont(undefined, 'bold')
    doc.setTextColor(...DARK)
    doc.text('Services: ', 110, rightY)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...GREY)
    const svcText = Array.isArray(services) ? services.join(', ') : services
    const lines = doc.splitTextToSize(svcText, 78)
    doc.text(lines, 128, rightY)
    rightY += lines.length * 4.2
  }

  return Math.max(leftY, rightY) + 6
}

function drawItemsTable(doc, items, startY) {
  let y = startY
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

  let subtotal = 0
  doc.setFont(undefined, 'normal')
  doc.setTextColor(...DARK)

  ;(items || []).forEach(item => {
    const qty = Number(item.quantity ?? 1)
    const price = Number(item.unit_price ?? item.price ?? 0)
    const lineTotal = qty * price
    subtotal += lineTotal

    doc.setFontSize(9.5)
    const desc = doc.splitTextToSize(item.description || '', 108)
    doc.text(desc, 17, y)
    doc.text(String(qty), 132, y, { align: 'center' })
    doc.text(`£${price.toFixed(2)}`, 165, y, { align: 'right' })
    doc.setFont(undefined, 'bold')
    doc.text(`£${lineTotal.toFixed(2)}`, 193, y, { align: 'right' })
    doc.setFont(undefined, 'normal')

    y += Math.max(7, desc.length * 4.6)
    doc.setDrawColor(230, 230, 230)
    doc.line(14, y - 2, 196, y - 2)
  })

  return { y: y + 4, subtotal }
}

function drawSummaryBox(doc, startY, { subtotal, discount = 0, total, paid = 0 }) {
  const boxX = 130, boxW = 66
  let y = startY
  const rows = [{ label: 'SUBTOTAL:', value: `£${subtotal.toFixed(2)}` }]
  if (discount > 0) rows.push({ label: 'DISCOUNT:', value: `-£${discount.toFixed(2)}` })
  rows.push({ label: 'TOTAL:', value: `£${total.toFixed(2)}`, bold: true })
  if (paid > 0) rows.push({ label: 'PAID:', value: `£${paid.toFixed(2)}` })

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
  doc.text(`£${balanceDue.toFixed(2)}`, 194, y + 1.5, { align: 'right' })

  return y + 12
}

function drawInvoiceFooter(doc, startY, { invoiceNumber, total, dueDateStr }) {
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
  doc.text(`Account Name: ${CO.bankAccountName}`, 14, y); y += 4.5
  doc.text(`Sort Code: ${CO.sortCode}`, 14, y); y += 4.5
  doc.text(`Account Number: ${CO.accountNumber}`, 14, y); y += 5.5
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
  doc.text(`£${total.toFixed(2)} due by ${dueDateStr}`, 196, ry, { align: 'right' }); ry += 5.5
  doc.setFont(undefined, 'italic')
  doc.setTextColor(...GREY)
  doc.setFontSize(8)
  doc.text('Payment Upfront Unless Credit Terms Agreed', 196, ry, { align: 'right' })

  return Math.max(y, ry) + 10
}

function drawBottomStrip(doc, y) {
  doc.setDrawColor(230, 230, 230)
  doc.line(14, y, 196, y)
  doc.setFontSize(7)
  doc.setTextColor(...GREY)
  doc.setFont(undefined, 'normal')
  doc.text(
    `Company Registration Number ${CO.regNumber} · Registered Office: ${CO.name}, ${CO.address}, United Kingdom`,
    105, y + 6, { align: 'center' }
  )
}

// ── PUBLIC: Invoice ──────────────────────────────────────────────
export function buildInvoicePdf({
  invoiceNumber, date, dueDays = 3,
  clientName, clientAddress, clientEmail,
  siteAddress, services,
  lineItems, total, discount = 0, paid = 0, vatRate = 0,
}) {
  const doc = new jsPDF()
  const issueDate = parseFlexibleDate(date)
  const dueDate = addDays(issueDate, dueDays)

  let y = drawCompanyHeader(doc, 'TAX INVOICE', invoiceNumber, formatLongDate(issueDate), [
    { label: 'Date: ', value: formatLongDate(issueDate) },
    { label: 'Due: ', value: formatLongDate(dueDate), color: RED },
  ])

  y = drawBilledToAndJobDetails(doc, y, { clientName, clientAddress, clientEmail, siteAddress, services })

  const { y: afterTable, subtotal } = drawItemsTable(doc, lineItems, y)
  const computedTotal = total != null ? Number(total) : subtotal

  y = drawSummaryBox(doc, afterTable + 4, { subtotal, discount, total: computedTotal, paid })
  y = drawInvoiceFooter(doc, y, { invoiceNumber, total: computedTotal, dueDateStr: formatLongDate(dueDate) })
  drawBottomStrip(doc, Math.min(y, 275))

  return { doc, base64: docToBase64(doc), filename: `Invoice_${invoiceNumber || 'INV'}.pdf` }
}

// ── PUBLIC: Quote ────────────────────────────────────────────────
export function buildQuotePdf({
  quoteNumber, date, validUntil,
  clientName, clientAddress, clientEmail,
  siteAddress, services,
  lineItems, total, notes,
}) {
  const doc = new jsPDF()
  const issueDate = parseFlexibleDate(date)

  let y = drawCompanyHeader(doc, 'QUOTE', quoteNumber, formatLongDate(issueDate), [
    { label: 'Date: ', value: formatLongDate(issueDate) },
    { label: 'Valid Until: ', value: validUntil ? formatLongDate(validUntil) : 'N/A' },
  ])

  y = drawBilledToAndJobDetails(doc, y, { clientName, clientAddress, clientEmail, siteAddress, services })

  const { y: afterTable, subtotal } = drawItemsTable(doc, lineItems, y)
  const computedTotal = total != null ? Number(total) : subtotal

  y = drawSummaryBox(doc, afterTable + 4, { subtotal, total: computedTotal, paid: 0 })

  doc.setDrawColor(220, 220, 220)
  doc.line(14, y, 196, y)
  y += 8
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.setFont(undefined, 'normal')
  doc.text('To accept this quote, please reply to this email or call us on ' + CO.phone + '.', 14, y)
  y += 6
  if (notes) {
    doc.setFont(undefined, 'italic')
    doc.setTextColor(...GREY)
    doc.setFontSize(8.5)
    doc.text(doc.splitTextToSize(notes, 180), 14, y)
    y += 10
  }

  drawBottomStrip(doc, Math.min(y + 6, 275))

  return { doc, base64: docToBase64(doc), filename: `Quote_${quoteNumber || 'QT'}.pdf` }
}
