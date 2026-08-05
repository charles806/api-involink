// Pure invoice math helpers — shared by routes and unit-tested directly.

function calculateInvoiceTotals(items, vatEnabled, taxRate) {
  const subtotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    const discount = parseFloat(item.discount) || 0;
    const lineTotal = qty * rate;
    const afterDiscount = lineTotal - (lineTotal * (discount / 100));
    return sum + afterDiscount;
  }, 0);

  const vat = vatEnabled ? subtotal * (parseFloat(taxRate) || 0.075) : 0;
  const total = subtotal + vat;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'At least one line item is required';
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.description || typeof item.description !== 'string' || !item.description.trim()) {
      return `Item ${i + 1}: description is required`;
    }
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `Item ${i + 1}: quantity must be a number greater than 0`;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return `Item ${i + 1}: rate must be a number and cannot be negative`;
    }
    if (item.discount !== undefined && item.discount !== null && item.discount !== '') {
      const discount = Number(item.discount);
      if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
        return `Item ${i + 1}: discount must be a number between 0 and 100`;
      }
    }
  }
  return null;
}

// Auto-generate the next invoice number from the most recent one, e.g. INV-0001 -> INV-0002.
function nextInvoiceNumber(lastInvoiceNumber) {
  let nextNum = 1;
  if (lastInvoiceNumber) {
    const match = String(lastInvoiceNumber).match(/(\d+)$/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }
  return `INV-${String(nextNum).padStart(4, '0')}`;
}

export  { calculateInvoiceTotals, validateItems, nextInvoiceNumber };
