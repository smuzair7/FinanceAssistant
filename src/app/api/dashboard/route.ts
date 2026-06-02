import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  financialSummary,
  monthlyTrend,
  recurringCharges,
  detectAnomalies,
  budgetStatus,
  startOfMonth,
  endOfMonth,
} from "@/lib/analytics";

export const runtime = "nodejs";

// Aggregated dashboard payload. All figures come from the same analytics layer
// the assistant uses, so the UI and the chat can never disagree.
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const range = { start: startOfMonth(now), end: endOfMonth(now) };

  const [summary, trend, recurring, anomalies, budgets, count, recent] =
    await Promise.all([
      financialSummary(userId, range),
      monthlyTrend(userId, 6),
      recurringCharges(userId),
      detectAnomalies(userId, 90),
      budgetStatus(userId),
      prisma.transaction.count({ where: { userId } }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 10,
        select: { date: true, merchant: true, category: true, amountCents: true, currency: true, source: true },
      }),
    ]);

  const currency = recent[0]?.currency ?? "USD";

  return NextResponse.json({
    currency,
    transactionCount: count,
    summary,
    trend,
    recurring,
    anomalies,
    budgets,
    recent: recent.map((r) => ({
      ...r,
      date: r.date.toISOString().slice(0, 10),
    })),
  });
}
