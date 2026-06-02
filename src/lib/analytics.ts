import { prisma } from "./db";

// ---------------------------------------------------------------------------
// Deterministic analytics. Every figure the assistant ever states comes from
// here — SQL aggregates over indexed columns, never from the model guessing.
//
// This is the answer to "handle data 10x-100x larger than the sample": the
// database does the heavy lifting and returns a few hundred bytes of summary,
// so prompt size and latency stay flat no matter how much history exists.
// ---------------------------------------------------------------------------

export interface DateRange {
  start: Date;
  end: Date;
}

// --- date helpers (UTC, to match how dates are stored) ---------------------
export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
}
export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

/** Total spending grouped by category over a range. Spending = debits (<0). */
export async function spendingByCategory(
  userId: string,
  range: DateRange,
  category?: string,
) {
  const grouped = await prisma.transaction.groupBy({
    by: ["category"],
    where: {
      userId,
      date: { gte: range.start, lte: range.end },
      amountCents: { lt: 0 },
      ...(category ? { category } : {}),
    },
    _sum: { amountCents: true },
    _count: true,
  });

  const categories = grouped
    .map((g) => ({
      category: g.category,
      spentCents: Math.abs(g._sum.amountCents ?? 0),
      count: g._count,
    }))
    .sort((a, b) => b.spentCents - a.spentCents);

  const totalSpentCents = categories.reduce((s, c) => s + c.spentCents, 0);
  return { totalSpentCents, categories };
}

/** Total income (credits) over a range. */
export async function totalIncome(userId: string, range: DateRange) {
  const agg = await prisma.transaction.aggregate({
    where: { userId, date: { gte: range.start, lte: range.end }, amountCents: { gt: 0 } },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

/** The N largest individual purchases in a range. */
export async function largestTransactions(
  userId: string,
  range: DateRange,
  limit = 5,
  category?: string,
) {
  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: range.start, lte: range.end },
      amountCents: { lt: 0 },
      ...(category ? { category } : {}),
    },
    orderBy: { amountCents: "asc" }, // most negative first = biggest spend
    take: Math.min(limit, 20),
    select: { date: true, merchant: true, category: true, amountCents: true },
  });
  return txns.map((t) => ({
    date: t.date.toISOString().slice(0, 10),
    merchant: t.merchant,
    category: t.category,
    spentCents: Math.abs(t.amountCents),
  }));
}

/** Compare spending between two periods (optionally for one category). */
export async function comparePeriods(
  userId: string,
  periodA: DateRange,
  periodB: DateRange,
  category?: string,
) {
  const [a, b] = await Promise.all([
    spendingByCategory(userId, periodA, category),
    spendingByCategory(userId, periodB, category),
  ]);
  const deltaCents = a.totalSpentCents - b.totalSpentCents;
  const pctChange =
    b.totalSpentCents === 0 ? null : (deltaCents / b.totalSpentCents) * 100;
  return {
    periodA: { ...periodA, totalSpentCents: a.totalSpentCents },
    periodB: { ...periodB, totalSpentCents: b.totalSpentCents },
    deltaCents,
    pctChange,
  };
}

/** Spend per calendar month for the last N months (dashboard + trend). */
export async function monthlyTrend(userId: string, months = 6) {
  const now = new Date();
  const start = startOfMonth(addMonths(now, -(months - 1)));
  const rows = await prisma.transaction.findMany({
    where: { userId, date: { gte: start }, amountCents: { lt: 0 } },
    select: { date: true, amountCents: true },
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = addMonths(start, i);
    buckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const r of rows) {
    const key = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + Math.abs(r.amountCents));
  }
  return [...buckets.entries()].map(([month, spentCents]) => ({ month, spentCents }));
}

/**
 * Recurring-charge detection — deterministic, not an LLM call.
 * Strategy: find merchants with >=3 debits (cheap groupBy), then for those
 * candidates check that the gaps between charges are regular (weekly / monthly
 * / yearly) and the amounts are stable. Only candidate rows are fetched, so
 * this stays light even on years of data.
 */
export async function recurringCharges(userId: string) {
  const since = addMonths(new Date(), -18);

  const candidates = await prisma.transaction.groupBy({
    by: ["merchant"],
    where: { userId, date: { gte: since }, amountCents: { lt: 0 } },
    _count: true,
    having: { merchant: { _count: { gte: 3 } } },
  });
  if (!candidates.length) return [];

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: since },
      amountCents: { lt: 0 },
      merchant: { in: candidates.map((c) => c.merchant) },
    },
    select: { merchant: true, date: true, amountCents: true, category: true },
    orderBy: { date: "asc" },
  });

  const byMerchant = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, []);
    byMerchant.get(r.merchant)!.push(r);
  }

  const results: Array<{
    merchant: string;
    category: string;
    cadence: string;
    typicalAmountCents: number;
    occurrences: number;
    lastCharge: string;
    monthlyEstimateCents: number;
  }> = [];

  for (const [merchant, txns] of byMerchant) {
    if (txns.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < txns.length; i++) {
      const days =
        (txns[i].date.getTime() - txns[i - 1].date.getTime()) / 86_400_000;
      gaps.push(days);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const gapStd = Math.sqrt(
      gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length,
    );

    // Amounts should be stable for a true subscription.
    const amounts = txns.map((t) => Math.abs(t.amountCents));
    const avgAmt = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const amtSpread =
      Math.max(...amounts) - Math.min(...amounts) <= avgAmt * 0.25;

    let cadence: string | null = null;
    let perMonth = 0;
    if (avgGap >= 6 && avgGap <= 8) (cadence = "weekly"), (perMonth = 4.33);
    else if (avgGap >= 12 && avgGap <= 16) (cadence = "biweekly"), (perMonth = 2.17);
    else if (avgGap >= 26 && avgGap <= 35) (cadence = "monthly"), (perMonth = 1);
    else if (avgGap >= 85 && avgGap <= 95) (cadence = "quarterly"), (perMonth = 1 / 3);
    else if (avgGap >= 350 && avgGap <= 380) (cadence = "yearly"), (perMonth = 1 / 12);

    // Regular gap (low relative std) + stable amount => recurring.
    if (cadence && gapStd / avgGap < 0.35 && amtSpread) {
      results.push({
        merchant,
        category: txns[txns.length - 1].category,
        cadence,
        typicalAmountCents: Math.round(avgAmt),
        occurrences: txns.length,
        lastCharge: txns[txns.length - 1].date.toISOString().slice(0, 10),
        monthlyEstimateCents: Math.round(avgAmt * perMonth),
      });
    }
  }

  return results.sort((a, b) => b.monthlyEstimateCents - a.monthlyEstimateCents);
}

/**
 * Anomaly detection — statistical, per category. For each category we build a
 * baseline (mean + std of past charges) and flag recent transactions that sit
 * well above it. Robust enough to surface "that one huge charge" without ML.
 */
export async function detectAnomalies(userId: string, lookbackDays = 90) {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const recentCutoff = new Date(Date.now() - 30 * 86_400_000);

  const rows = await prisma.transaction.findMany({
    where: { userId, date: { gte: since }, amountCents: { lt: 0 } },
    select: { id: true, date: true, merchant: true, category: true, amountCents: true },
  });

  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(Math.abs(r.amountCents));
  }

  const stats = new Map<string, { mean: number; std: number }>();
  for (const [cat, amts] of byCat) {
    if (amts.length < 4) continue; // not enough history to judge
    const mean = amts.reduce((s, a) => s + a, 0) / amts.length;
    const std = Math.sqrt(amts.reduce((s, a) => s + (a - mean) ** 2, 0) / amts.length);
    stats.set(cat, { mean, std });
  }

  const flagged = rows
    .filter((r) => r.date >= recentCutoff)
    .map((r) => {
      const s = stats.get(r.category);
      if (!s || s.std === 0) return null;
      const amt = Math.abs(r.amountCents);
      const z = (amt - s.mean) / s.std;
      if (z >= 2.5 && amt > s.mean * 1.5) {
        return {
          date: r.date.toISOString().slice(0, 10),
          merchant: r.merchant,
          category: r.category,
          amountCents: amt,
          categoryAverageCents: Math.round(s.mean),
          severity: z >= 4 ? "high" : "medium",
        };
      }
      return null;
    })
    .filter(Boolean);

  return flagged;
}

/** Budgets vs current-month spend, with status flags. */
export async function budgetStatus(userId: string) {
  const budgets = await prisma.budget.findMany({ where: { userId } });
  if (!budgets.length) return [];
  const now = new Date();
  const range = { start: startOfMonth(now), end: endOfMonth(now) };
  const { totalSpentCents, categories } = await spendingByCategory(userId, range);
  const byCat = new Map(categories.map((c) => [c.category, c.spentCents]));

  return budgets.map((b) => {
    const spent = b.category ? byCat.get(b.category) ?? 0 : totalSpentCents;
    const pct = b.amountCents > 0 ? (spent / b.amountCents) * 100 : 0;
    return {
      category: b.category ?? "Overall",
      budgetCents: b.amountCents,
      spentCents: spent,
      remainingCents: b.amountCents - spent,
      pctUsed: Math.round(pct),
      status: pct >= 100 ? "over" : pct >= 80 ? "warning" : "ok",
    };
  });
}

/** A compact, period-scoped financial picture for summaries and cut-back tips. */
export async function financialSummary(userId: string, range: DateRange) {
  const [{ totalSpentCents, categories }, income] = await Promise.all([
    spendingByCategory(userId, range),
    totalIncome(userId, range),
  ]);
  return {
    range: {
      start: range.start.toISOString().slice(0, 10),
      end: range.end.toISOString().slice(0, 10),
    },
    incomeCents: income,
    totalSpentCents,
    netCents: income - totalSpentCents,
    topCategories: categories.slice(0, 8),
  };
}
