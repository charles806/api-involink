import PDFDocument from 'pdfkit';

const EMERALD = '#059669';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e4ebe6';
const LIGHT = '#ecfdf5';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Build a professional, printable invoice PDF buffer.
// `payload` shape matches what the invoice detail endpoint returns,
// joined with the business owner's public profile + a resolved `status`.
export function buildInvoicePdf({
  invoice_number,
  issue_date,
  due_date,
  status,
  items = [],
  subtotal,
  vat,
  total,
  vat_enabled,
  notes,
  clients = {},
  business = {},
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        bufferPages: true,
        info: { Title: `Invoice ${invoice_number}` },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const biller = business?.business_name || business?.name || 'Invoice';

      // --- Branded header band ---
      doc.roundedRect(doc.page.margins.left, doc.y, pageWidth, 66, 6).fill(EMERALD);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(biller, doc.page.margins.left + 16, doc.y + 15, { width: pageWidth * 0.6, ellipsis: true });
      if (business?.business_address) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#e6f4ee')
          .text(business.business_address, doc.page.margins.left + 16, doc.y + 4, { width: pageWidth * 0.62 });
      }
      // Invoice number / date (right-aligned)
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('INVOICE', doc.page.margins.left + pageWidth - 120, doc.page.margins.top + 16, { width: 104, align: 'right' });
      doc
        .fontSize(14)
        .text(String(invoice_number), doc.page.margins.left + pageWidth - 120, doc.y + 2, { width: 104, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor('#e6f4ee');
      if (issue_date) {
        doc.text(`Date: ${formatDate(issue_date)}`, doc.page.margins.left + pageWidth - 120, doc.y + 2, { width: 104, align: 'right' });
      }

      doc.y = doc.page.margins.top + 80;

      // --- Bill To / meta ---
      const billToX = doc.page.margins.left;
      const metaX = doc.page.margins.left + pageWidth - 150;

      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('BILL TO', billToX, doc.y);
      doc.moveDown(0.2);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(clients?.name || 'Unknown Client', billToX, doc.y);
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      if (clients?.email) {
        doc.text(clients.email, billToX, doc.y + 2);
        doc.y += 2;
      }
      if (clients?.phone) doc.text(clients.phone);
      if (clients?.address) doc.text(clients.address);

      // Meta column (issue/due/status)
      const metaStartY = doc.y;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('DUE DATE', metaX, doc.page.margins.top + 80);
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(formatDate(due_date), metaX, doc.y + 2);
      doc.moveDown(0.5);
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('STATUS', metaX, doc.y + 4);
      doc.fillColor(status === 'paid' ? EMERALD : INK).font('Helvetica-Bold').fontSize(10)
        .text(String(status || 'draft').toUpperCase(), metaX, doc.y + 2);

      doc.y = Math.max(metaStartY, doc.y) + 22;

      // --- Items table ---
      const tableTop = doc.y;
      const rowHeight = 22;
      const colWidths = [pageWidth * 0.42, 0.1 * pageWidth, 0.16 * pageWidth, 0.16 * pageWidth];

      const drawRow = (y, cells, opts = {}) => {
        const { header = false } = opts;
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica');
        doc.fontSize(header ? 8 : 9);
        doc.fillColor(MUTED);
        doc.text(cells[0], doc.page.margins.left, y, { width: colWidths[0], lineBreak: false });
        doc.text(cells[1], doc.page.margins.left + colWidths[0] + 6, y, { width: colWidths[1] - 6, align: 'right', lineBreak: false });
        doc.text(cells[2], doc.page.margins.left + colWidths[0] + colWidths[1] + 10, y, { width: colWidths[2] - 8, align: 'right', lineBreak: false });
        doc.text(cells[3], doc.page.margins.left + colWidths[0] + colWidths[1] + colWidths[2] + 14, y, { width: colWidths[3] - 12, align: 'right', lineBreak: false });
      };

      // Header
      drawRow(tableTop, ['Description', 'Qty', 'Rate', 'Amount'], { header: true });
      doc.y = tableTop + 12;
      doc.moveTo(doc.page.margins.left, tableTop + 14).lineTo(doc.page.margins.left + pageWidth, tableTop + 14).strokeColor(LINE).lineWidth(1).stroke();

      // Rows
      let rowY = tableTop + 14 + 8;
      for (const item of items) {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const discount = Number(item.discount) || 0;
        const lineTotal = round2(qty * rate * (1 - discount / 100));
        const desc = `${item.description || ''}${item.unit ? ` (${item.unit})` : ''}`;

        // Check page overflow
        if (rowY + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          rowY = doc.page.margins.top + 8;
        }

        drawRow(rowY, [desc, String(qty), formatNaira(rate), formatNaira(lineTotal)]);
        if (item.discount > 0) {
          doc.fillColor('#b45309').font('Helvetica').fontSize(8)
            .text(`-${item.discount}%`, doc.page.margins.left + colWidths[0] + 6, rowY, { width: colWidths[1] + colWidths[2] - 14, align: 'right', lineBreak: false });
          doc.fillColor(MUTED);
        }
        rowY += rowHeight;
      }

      // Bottom border of items
      doc.moveTo(doc.page.margins.left, rowY).lineTo(doc.page.margins.left + pageWidth, rowY).strokeColor(LINE).lineWidth(1).stroke();

      // --- Totals ---
      const totalsX = doc.page.margins.left + pageWidth - 180;
      doc.y = rowY + 18;
      const totalsTop = doc.y;

      const totalRow = (label, value, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        doc.fillColor(bold ? '#065f46' : MUTED).text(label, totalsX, doc.y, { width: 90 });
        doc.fillColor(bold ? '#065f46' : INK).font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .text(value, totalsX + 90, doc.y, { width: 90, align: 'right' });
        doc.moveDown(bold ? 0.6 : 0.4);
      };

      totalRow('Subtotal', formatNaira(subtotal));
      if (vat_enabled && vat > 0) totalRow('VAT', formatNaira(vat));
      // Total box
      doc.moveDown(0.2);
      const boxY = doc.y;
      doc.roundedRect(totalsX, boxY, 180, 34, 6).fill(LIGHT);
      doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(11);
      doc.text('Total Due', totalsX + 12, boxY + 11, { width: 84 });
      doc.font('Helvetica-Bold').fontSize(12).text(formatNaira(total), totalsX + 96, boxY + 9, { width: 78, align: 'right' });
      doc.y = boxY + 34;

      doc.y = Math.max(totalsTop, doc.y) + 6;

      // --- Notes ---
      if (notes) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
        doc.moveDown(0.5);
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('NOTES', doc.page.margins.left, doc.y);
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(notes, doc.page.margins.left, doc.y, { width: pageWidth });
      }

      // --- Footer ---
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(MUTED)
          .text(`Generated by Involink — ${biller}`, doc.page.margins.left, doc.page.height - 40, { align: 'center', width: pageWidth });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
