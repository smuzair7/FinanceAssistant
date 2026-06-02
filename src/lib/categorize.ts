// Deterministic merchant normalization + categorization.
// This is intentionally *code, not a model call*: it runs on every imported row,
// so it must be instant and free. The LLM is reserved for genuinely ambiguous
// reasoning, not for labelling thousands of rows.

export const CATEGORIES = [
  "Income",
  "Rent",
  "Groceries",
  "Dining",
  "Transport",
  "Subscriptions",
  "Utilities",
  "Shopping",
  "Health",
  "Entertainment",
  "Travel",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Strip the noise banks add to descriptions: card numbers, dates, store ids,
// "POS", reference codes, trailing locations, etc.
export function normalizeMerchant(raw: string): string {
  if (!raw) return "Unknown";
  let s = raw.toUpperCase();
  s = s.replace(/\b(POS|PURCHASE|PAYMENT|DEBIT|CARD|VISA|MASTERCARD|ACH|XX+\d*)\b/g, " ");
  s = s.replace(/\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, " "); // dates
  s = s.replace(/#?\d{3,}/g, " "); // long numbers / store ids
  s = s.replace(/\b[A-Z]{2}\b$/g, " "); // trailing state codes
  s = s.replace(/[^A-Z0-9& ]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Title-case the cleaned result for display.
  const titled = s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return titled || "Unknown";
}

// Keyword → category rules. First match wins. Cheap and good enough; the
// assistant can correct/override via memory if a user disagrees.
const RULES: Array<[RegExp, Category]> = [
  [/payroll|salary|paycheck|direct dep|deposit|interest/i, "Income"],
  [/rent|landlord|property mgmt|leasing/i, "Rent"],
  [/whole foods|trader joe|safeway|kroger|aldi|tesco|sainsbury|grocery|market|costco|walmart/i, "Groceries"],
  [/uber eats|doordash|grubhub|restaurant|cafe|coffee|starbucks|mcdonald|chipotle|pizza|dining|bar &/i, "Dining"],
  [/uber|lyft|transit|metro|subway mta|gas|shell|chevron|exxon|parking|fuel/i, "Transport"],
  [/netflix|spotify|hulu|disney|youtube premium|prime video|icloud|dropbox|notion|github|openai|chatgpt|gym|membership|patreon/i, "Subscriptions"],
  [/electric|water|gas company|internet|comcast|verizon|at&t|t-mobile|utility|power/i, "Utilities"],
  [/amazon|target|best buy|ikea|etsy|ebay|store|shop/i, "Shopping"],
  [/pharmacy|cvs|walgreens|doctor|dental|clinic|hospital|health/i, "Health"],
  [/cinema|movie|theater|steam|playstation|xbox|concert|ticketmaster/i, "Entertainment"],
  [/airline|airbnb|hotel|expedia|flight|booking\.com|delta|united air/i, "Travel"],
];

export function categorize(rawDescription: string, merchant: string): Category {
  const hay = `${rawDescription} ${merchant}`;
  for (const [re, cat] of RULES) if (re.test(hay)) return cat;
  return "Other";
}
