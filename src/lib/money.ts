// All money is handled as signed integer minor units (cents/pence).
// Debits (spending) are negative; credits (income) are positive.

export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    // Unknown currency code — fall back to a plain number with the code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Parse a loose money string ("$1,234.56", "(45.00)", "1.234,56") to cents. */
export function parseAmountToCents(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Parentheses denote negatives in many bank exports: (45.00) => -45.00
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negative = true;

  // Strip currency symbols / letters / spaces, keep digits and separators.
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  // Decide decimal separator. If both present, the last one is the decimal.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // European format: 1.234,56
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // US format: 1,234.56
      s = s.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    // Only commas — treat as thousands unless it looks like a decimal (,dd)
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  const value = Number.parseFloat(s);
  if (Number.isNaN(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -Math.abs(cents) : cents;
}

export const absCents = (c: number) => Math.abs(c);
