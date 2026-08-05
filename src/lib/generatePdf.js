import jsPDF from 'jspdf'

// Converts a jsPDF document to a clean base64 string (no data URI prefix)
// This is exactly what the gmail-reply edge function expects for attachment_base64
function docToBase64(doc) {
  const dataUri = doc.output('datauristring')
  return dataUri.split(',')[1]
}

const BRAND = { blue: [0, 147, 219], dark: [31, 41, 55], grey: [107, 114, 128] }

function drawHeader(doc, title, docNumber) {
  doc.setFillColor(...BRAND.blue)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont(undefined, 'bold')
  doc.text('My Landlord Certificate', 14, 17)
  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.text('020 3996 1070  |  info@mylandlordcertificate.co.uk', 14, 23)

  doc.setTextColor(...BRAND.dark)
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.text(title, 196, 40, { align: 'right' })
  doc.setFontSize(11)
  doc.setFont(undefined, 'normal')
  doc.setTextColor(...BRAND.grey)
  doc.text(docNumber, 196, 47, { align: 'right' })
}

function drawLineItemsTable(doc, items, startY) {
  let y = startY
  doc.setFillColor(245, 247, 250)
  doc.rect(14, y, 182, 8, 'F')
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...BRAND.dark)
  doc.text('Description', 16, y + 5.5)
  doc.text('Qty', 140, y + 5.5)
  doc.text('Unit Price', 160, y + 5.5)
  doc.text('Total', 190, y + 5.5, { align: 'right' })
  y += 12

  doc.setFont(undefined, 'normal')
  let subtotal = 0
  ;(items || []).forEach(item => {
    const qty = Number(item.quantity || 1)
    const price = Number(item.unit_price ?? item.price ?? 0)
    const lineTotal = qty * price
    subtotal += lineTotal

    doc.setFontSize(9.5)
    const desc = doc.splitTextToSize(item.description || '', 118)
    doc.text(desc, 16, y)
    doc.text(String(qty), 140, y)
    doc.text(`£${price.toFixed(2)}`, 160, y)
    doc.text(`£${lineTotal.toFixed(2)}`, 190, y, { align: 'right' })
    y += Math.max(6, desc.length * 5)
    doc.setDrawColor(230, 230, 230)
    doc.line(14, y, 196, y)
    y += 3
  })

  return { y, subtotal }
}

export function buildInvoicePdf({ invoiceNumber, date, clientName, clientAddress, siteAddress, lineItems, total, vatRate = 0, notes, bankName = 'My Landlord Certificate LTD', sortCode = '60-83-71', accountNumber = '83356126' }) {
  const doc = new jsPDF()
  drawHeader(doc, 'INVOICE', invoiceNumber || '')

  doc.setFontSize(10)
  doc.setTextColor(...BRAND.grey)
  doc.text('Bill To:', 14, 40)
  doc.setTextColor(...BRAND.dark)
  doc.setFont(undefined, 'bold')
  doc.text(clientName || 'Customer', 14, 46)
  doc.setFont(undefined, 'normal')
  if (clientAddress) doc.text(doc.splitTextToSize(clientAddress, 90), 14, 51)

  doc.setTextColor(...BRAND.grey)
  doc.text(`Date: ${date || new Date().toLocaleDateString('en-GB')}`, 196, 55, { align: 'right' })
  if (siteAddress) {
    doc.text('Site Address:', 196, 60, { align: 'right' })
    doc.text(doc.splitTextToSize(siteAddress, 80), 196, 65, { align: 'right' })
  }

  const { y, subtotal } = drawLineItemsTable(doc, lineItems, 72)
  let finalY = y + 4

  const computedTotal = total != null ? Number(total) : subtotal
  doc.setFont(undefined, 'bold')
  doc.setFontSize(11)
  doc.text('Total Due:', 160, finalY + 6)
  doc.setTextColor(...BRAND.blue)
  doc.text(`£${computedTotal.toFixed(2)}`, 190, finalY + 6, { align: 'right' })
  finalY += 16

  doc.setTextColor(...BRAND.dark)
  doc.setFontSize(9.5)
  doc.setFont(undefined, 'bold')
  doc.text('Payment Details', 14, finalY)
  doc.setFont(undefined, 'normal')
  doc.text(`Bank: ${bankName}`, 14, finalY + 6)
  doc.text(`Sort Code: ${sortCode}`, 14, finalY + 11)
  doc.text(`Account: ${accountNumber}`, 14, finalY + 16)
  doc.text(`Reference: ${invoiceNumber || ''}`, 14, finalY + 21)

  if (notes) {
    doc.setFont(undefined, 'italic')
    doc.setTextColor(...BRAND.grey)
    doc.text(doc.splitTextToSize(notes, 180), 14, finalY + 32)
  }

  return { doc, base64: docToBase64(doc), filename: `${invoiceNumber || 'Invoice'}.pdf` }
}

export function buildQuotePdf({ quoteNumber, date, validUntil, clientName, clientAddress, siteAddress, lineItems, total, notes }) {
  const doc = new jsPDF()
  drawHeader(doc, 'QUOTE', quoteNumber || '')

  doc.setFontSize(10)
  doc.setTextColor(...BRAND.grey)
  doc.text('Quote For:', 14, 40)
  doc.setTextColor(...BRAND.dark)
  doc.setFont(undefined, 'bold')
  doc.text(clientName || 'Customer', 14, 46)
  doc.setFont(undefined, 'normal')
  if (clientAddress) doc.text(doc.splitTextToSize(clientAddress, 90), 14, 51)

  doc.setTextColor(...BRAND.grey)
  doc.text(`Date: ${date || new Date().toLocaleDateString('en-GB')}`, 196, 55, { align: 'right' })
  doc.text(`Valid Until: ${validUntil || 'N/A'}`, 196, 60, { align: 'right' })
  if (siteAddress) {
    doc.text('Site Address:', 196, 65, { align: 'right' })
    doc.text(doc.splitTextToSize(siteAddress, 80), 196, 70, { align: 'right' })
  }

  const { y, subtotal } = drawLineItemsTable(doc, lineItems, 78)
  let finalY = y + 4
  const computedTotal = total != null ? Number(total) : subtotal

  doc.setFont(undefined, 'bold')
  doc.setFontSize(11)
  doc.text('Total:', 160, finalY + 6)
  doc.setTextColor(...BRAND.blue)
  doc.text(`£${computedTotal.toFixed(2)}`, 190, finalY + 6, { align: 'right' })
  finalY += 16

  doc.setTextColor(...BRAND.dark)
  doc.setFontSize(9.5)
  doc.setFont(undefined, 'normal')
  doc.text('To accept this quote, please reply to this email or call us on 020 3996 1070.', 14, finalY)

  if (notes) {
    doc.setFont(undefined, 'italic')
    doc.setTextColor(...BRAND.grey)
    doc.text(doc.splitTextToSize(notes, 180), 14, finalY + 10)
  }

  return { doc, base64: docToBase64(doc), filename: `${quoteNumber || 'Quote'}.pdf` }
}
