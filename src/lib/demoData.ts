import { prisma } from "./db";
import { normalizeMerchant } from "./categorize";
import { dedupeHash } from "./dedupe";

// Deterministic synthetic dataset. The brief said a sample CSV "will be
// provided" but none was, so we generate ~18 months of realistic history:
// regular income, rent, a handful of subscriptions, weekly groceries, dining,
// transport, plus a few injected anomalies — enough to exercise every feature.
// A seeded PRNG keeps it reproducible across runs.

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GenTxn {
  date: Date;
  amountCents: number;
  description: string;
  category: string;
}

const CURRENCY = "USD";

export function generateDemoTransactions(months = 18, seed = 42): GenTxn[] {
  const rng = mulberry32(seed);
  const txns: GenTxn[] = [];
  const now = new Date();
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const around = (base: number, pct: number) =>
    Math.round(base * (1 + (rng() - 0.5) * 2 * pct));

  const groceryStores = ["WHOLE FOODS MKT", "TRADER JOE'S", "SAFEWAY #221", "ALDI"];
  const diningSpots = ["CHIPOTLE", "STARBUCKS", "UBER EATS", "DOORDASH", "THE LOCAL BISTRO", "PIZZA HUT"];
  const transport = ["UBER TRIP", "LYFT RIDE", "SHELL OIL", "CHEVRON GAS"];
  const shopping = ["AMAZON.COM", "TARGET", "BEST BUY", "IKEA"];

  for (let m = months - 1; m >= 0; m--) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const y = monthDate.getUTCFullYear();
    const mo = monthDate.getUTCMonth();
    const day = (d: number) => new Date(Date.UTC(y, mo, d, 12));

    // Income — salary on the 1st (a fact the assistant should learn via memory).
    txns.push({ date: day(1), amountCents: around(420000, 0.02), description: "ACME CORP PAYROLL DIRECT DEP", category: "Income" });

    // Fixed costs
    txns.push({ date: day(2), amountCents: -150000, description: "GREENLEAF PROPERTY MGMT RENT", category: "Rent" });
    txns.push({ date: day(5), amountCents: -4500, description: "FITLIFE GYM MEMBERSHIP", category: "Subscriptions" });
    txns.push({ date: day(8), amountCents: -1099, description: "SPOTIFY USA", category: "Subscriptions" });
    txns.push({ date: day(15), amountCents: -1599, description: "NETFLIX.COM", category: "Subscriptions" });
    txns.push({ date: day(18), amountCents: -7000, description: "COMCAST INTERNET", category: "Utilities" });
    txns.push({ date: day(20), amountCents: -6000, description: "VERIZON WIRELESS", category: "Utilities" });

    // Weekly groceries
    for (const d of [4, 11, 18, 25]) {
      txns.push({ date: day(d), amountCents: -around(9000, 0.3), description: `${pick(groceryStores)} POS PURCHASE`, category: "Groceries" });
    }

    // Dining — several per month
    const diningCount = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < diningCount; i++) {
      const d = 1 + Math.floor(rng() * 27);
      txns.push({ date: day(d), amountCents: -around(2500, 0.6), description: `${pick(diningSpots)}`, category: "Dining" });
    }

    // Transport
    const tripCount = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < tripCount; i++) {
      const d = 1 + Math.floor(rng() * 27);
      txns.push({ date: day(d), amountCents: -around(3500, 0.5), description: `${pick(transport)}`, category: "Transport" });
    }

    // Occasional shopping
    if (rng() > 0.4) {
      const d = 1 + Math.floor(rng() * 27);
      txns.push({ date: day(d), amountCents: -around(6000, 0.7), description: `${pick(shopping)}`, category: "Shopping" });
    }
  }

  // --- Injected anomalies (recent), so anomaly detection has something real ---
  const recent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 12, 12));
  txns.push({ date: recent, amountCents: -189900, description: "BEST BUY ELECTRONICS", category: "Shopping" });
  const recent2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 6, 12));
  txns.push({ date: recent2, amountCents: -32000, description: "THE LOCAL BISTRO", category: "Dining" });
  // A new subscription the user may have forgotten (starts 4 months ago, monthly)
  for (let m = 4; m >= 0; m--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 22, 12));
    txns.push({ date: d, amountCents: -2999, description: "CHATGPT SUBSCRIPTION OPENAI", category: "Subscriptions" });
  }

  return txns;
}

/** Insert the demo dataset for a user (idempotent via dedupe hash). */
export async function seedUser(userId: string): Promise<number> {
  const gen = generateDemoTransactions();
  const records = gen.map((t) => {
    const merchant = normalizeMerchant(t.description);
    return {
      userId,
      date: t.date,
      amountCents: t.amountCents,
      currency: CURRENCY,
      rawDescription: t.description,
      merchant,
      category: t.category,
      source: "csv",
      dedupeHash: dedupeHash({ date: t.date, amountCents: t.amountCents, merchant }),
    };
  });

  const hashes = records.map((r) => r.dedupeHash);
  const existing = await prisma.transaction.findMany({
    where: { userId, dedupeHash: { in: hashes } },
    select: { dedupeHash: true },
  });
  const existingSet = new Set(existing.map((e) => e.dedupeHash));
  const fresh = records.filter((r) => !existingSet.has(r.dedupeHash));
  if (fresh.length) await prisma.transaction.createMany({ data: fresh });
  return fresh.length;
}
