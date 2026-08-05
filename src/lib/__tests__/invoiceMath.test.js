import { describe, it, expect } from 'vitest';
import { calculateInvoiceTotals, validateItems, nextInvoiceNumber } from '../invoiceMath.js';

describe('calculateInvoiceTotals', () => {
  it('computes a simple subtotal without VAT', () => {
    const items = [{ quantity: 2, rate: 100, discount: 0 }];
    expect(calculateInvoiceTotals(items, false, 0)).toEqual({ subtotal: 200, vat: 0, total: 200 });
  });

  it('applies percentage discounts per line item', () => {
    const items = [{ quantity: 2, rate: 100, discount: 10 }];
    const totals = calculateInvoiceTotals(items, false, 0);
    expect(totals.subtotal).toBe(180);
    expect(totals.total).toBe(180);
  });

  it('applies VAT on top of the discounted subtotal', () => {
    const items = [{ quantity: 2, rate: 100, discount: 10 }];
    const totals = calculateInvoiceTotals(items, true, 0.075);
    expect(totals.subtotal).toBe(180);
    expect(totals.vat).toBe(13.5);
    expect(totals.total).toBe(193.5);
  });

  it('uses a 7.5% default tax rate when none is supplied', () => {
    const items = [{ quantity: 1, rate: 100, discount: 0 }];
    expect(calculateInvoiceTotals(items, true, null)).toEqual({ subtotal: 100, vat: 7.5, total: 107.5 });
  });

  it('rounds to 2 decimal places', () => {
    const items = [{ quantity: 3, rate: 10.99, discount: 0 }];
    const totals = calculateInvoiceTotals(items, true, 0.075);
    expect(totals.subtotal).toBe(32.97);
    expect(totals.vat).toBe(2.47);
    expect(totals.total).toBe(35.44);
  });

  it('handles a 100% discount (zero total)', () => {
    const items = [{ quantity: 5, rate: 100, discount: 100 }];
    expect(calculateInvoiceTotals(items, true, 0.075)).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });

  it('does not throw on non-numeric item fields (coerces to 0)', () => {
    const items = [{ quantity: 'abc', rate: 'xyz', discount: 'bad' }];
    const totals = calculateInvoiceTotals(items, true, 0.075);
    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('accumulates multiple line items', () => {
    const items = [
      { quantity: 1, rate: 100, discount: 0 },
      { quantity: 2, rate: 50, discount: 20 },
      { quantity: 1, rate: 10, discount: 0 },
    ];
    const totals = calculateInvoiceTotals(items, false, 0);
    expect(totals.subtotal).toBe(190);
  });
});

describe('validateItems', () => {
  it('rejects empty / non-array input', () => {
    expect(validateItems(undefined)).toBe('At least one line item is required');
    expect(validateItems([])).toBe('At least one line item is required');
    expect(validateItems('nope')).toBe('At least one line item is required');
  });

  it('rejects missing description', () => {
    expect(validateItems([{ quantity: 1, rate: 10 }])).toBe('Item 1: description is required');
    expect(validateItems([{ description: '  ', quantity: 1, rate: 10 }])).toBe('Item 1: description is required');
  });

  it('accepts a valid item', () => {
    expect(validateItems([{ description: 'Consulting', quantity: 2, rate: 100, discount: 5 }])).toBe(null);
  });

  it('rejects quantity that is not a finite number > 0', () => {
    expect(validateItems([{ description: 'x', quantity: 0, rate: 10 }])).toMatch(/quantity/);
    expect(validateItems([{ description: 'x', quantity: -1, rate: 10 }])).toMatch(/quantity/);
    expect(validateItems([{ description: 'x', quantity: 'abc', rate: 10 }])).toMatch(/quantity/);
    expect(validateItems([{ description: 'x', quantity: null, rate: 10 }])).toMatch(/quantity/);
  });

  it('accepts numeric quantity strings', () => {
    expect(validateItems([{ description: 'x', quantity: '2', rate: 10 }])).toBe(null);
  });

  it('rejects negative rate', () => {
    expect(validateItems([{ description: 'x', quantity: 1, rate: -5 }])).toMatch(/rate/);
  });

  it('rejects non-finite rate', () => {
    expect(validateItems([{ description: 'x', quantity: 1, rate: 'abc' }])).toMatch(/rate/);
  });

  it('rejects discount outside 0-100', () => {
    expect(validateItems([{ description: 'x', quantity: 1, rate: 10, discount: 101 }])).toMatch(/discount/);
    expect(validateItems([{ description: 'x', quantity: 1, rate: 10, discount: -1 }])).toMatch(/discount/);
    expect(validateItems([{ description: 'x', quantity: 1, rate: 10, discount: 'abc' }])).toMatch(/discount/);
  });

  it('allows discount to be omitted', () => {
    expect(validateItems([{ description: 'x', quantity: 1, rate: 10 }])).toBe(null);
  });
});

describe('nextInvoiceNumber', () => {
  it('starts at INV-0001 with no previous invoice', () => {
    expect(nextInvoiceNumber(null)).toBe('INV-0001');
    expect(nextInvoiceNumber(undefined)).toBe('INV-0001');
  });

  it('increments the numeric suffix', () => {
    expect(nextInvoiceNumber('INV-0042')).toBe('INV-0043');
  });

  it('handles numbers larger than 4 digits', () => {
    expect(nextInvoiceNumber('INV-99999')).toBe('INV-100000');
  });

  it('falls back to INV-0001 for a number-less string', () => {
    expect(nextInvoiceNumber('ABC')).toBe('INV-0001');
  });
});
