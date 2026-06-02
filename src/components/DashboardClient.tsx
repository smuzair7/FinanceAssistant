"use client";

import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { fmt } from "@/lib/format";
import Chat from "./Chat";
import ImportPanel from "./ImportPanel";

interface DashboardData {
  currency: string;
  transactionCount: number;
  summary: {
    range: { start: string; end: string };
    income: { cents: number };
    totalSpent: { cents: number };
    net: { cents: number };
    topCategories: { category: string; spent: { cents: number }; count: number }[];
  };
  trend: { month: string; spentCents: number }[];
  recurring: {
    merchant: string;
    cadence: string;
    estMonthlyCost?: { cents: number };
    monthlyEstimateCents?: number;
    typicalAmount?: { cents: number };
    typicalAmountCents?: number;
    lastCharge: string;
  }[];
  anomalies: {
    merchant: string;
    category: string;
    amount?: { cents: number };
    amountCents?: number;
    date: string;
    severity: string;
  }[];
  budgets: {
    category: string;
    budget: { cents: number };
    spent: { cents: number };
    pctUsed: number;
    status: string;
  }[];
  recent: {
    date: string;
    merchant: string;
    category: string;
    amountCents: number;
    currency: string;
    source: string;
  }[];
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function DashboardClient({ clerkOn }: { clerkOn: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cur = data?.currency ?? "USD";
  const maxTrend = Math.max(1, ...(data?.trend.map((t) => t.spentCents) ?? [1]));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-900">Finance Assistant</span>
          {!clerkOn && (
            <span className="rounded bg-amber-100 text-amber-700 px-2 py-0.5 text-xs">
              demo mode
            </span>
          )}
        </div>
        {clerkOn && <UserButton />}
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_420px] overflow-hidden">
        {/* Left: dashboard */}
        <div className="overflow-y-auto scroll-thin p-6 space-y-4">
          {loading && <p className="text-slate-400">Loading…</p>}

          {data && data.transactionCount === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-slate-600 mb-3">
                No transactions yet. Load the demo dataset or import a CSV to get started.
              </p>
              <ImportPanel onDone={load} />
            </div>
          )}

          {data && data.transactionCount > 0 && (
            <>
              {/* Stat row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card title={`Spent (${data.summary.range.start.slice(0, 7)})`}>
                  <p className="text-2xl font-semibold text-slate-900">
                    {fmt(data.summary.totalSpent.cents, cur)}
                  </p>
                </Card>
                <Card title="Income">
                  <p className="text-2xl font-semibold text-emerald-600">
                    {fmt(data.summary.income.cents, cur)}
                  </p>
                </Card>
                <Card title="Net">
                  <p
                    className={`text-2xl font-semibold ${
                      data.summary.net.cents >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {fmt(data.summary.net.cents, cur)}
                  </p>
                </Card>
                <Card title="Transactions">
                  <p className="text-2xl font-semibold text-slate-900">
                    {data.transactionCount.toLocaleString()}
                  </p>
                </Card>
              </div>

              {/* Trend */}
              <Card title="Spending — last 6 months">
                <div className="flex items-end gap-2 h-32">
                  {data.trend.map((t) => (
                    <div key={t.month} className="flex-1 flex flex-col items-center justify-end gap-1">
                      <div
                        className="w-full rounded-t bg-indigo-500/80"
                        style={{ height: `${(t.spentCents / maxTrend) * 100}%` }}
                        title={fmt(t.spentCents, cur)}
                      />
                      <span className="text-[10px] text-slate-400">{t.month.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Budgets */}
                <Card title="Budgets">
                  {data.budgets.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No budgets yet. Ask the assistant: “set a $400 groceries budget”.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {data.budgets.map((b) => (
                        <li key={b.category}>
                          <div className="flex justify-between text-sm">
                            <span>{b.category}</span>
                            <span className="text-slate-500">
                              {fmt(b.spent.cents, cur)} / {fmt(b.budget.cents, cur)}
                            </span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full ${
                                b.status === "over"
                                  ? "bg-rose-500"
                                  : b.status === "warning"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, b.pctUsed)}%` }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {/* Recurring */}
                <Card title="Recurring / subscriptions">
                  {data.recurring.length === 0 ? (
                    <p className="text-sm text-slate-400">None detected.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {data.recurring.slice(0, 6).map((r) => (
                        <li key={r.merchant} className="flex justify-between">
                          <span>
                            {r.merchant}{" "}
                            <span className="text-slate-400">· {r.cadence}</span>
                          </span>
                          <span className="text-slate-600">
                            {fmt(r.estMonthlyCost?.cents ?? r.monthlyEstimateCents ?? 0, cur)}/mo
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              {/* Anomalies */}
              {data.anomalies.length > 0 && (
                <Card title="Unusual activity">
                  <ul className="space-y-2 text-sm">
                    {data.anomalies.map((a, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          <span
                            className={`inline-block w-2 h-2 rounded-full mr-2 ${
                              a.severity === "high" ? "bg-rose-500" : "bg-amber-500"
                            }`}
                          />
                          {a.merchant}{" "}
                          <span className="text-slate-400">· {a.category} · {a.date}</span>
                        </span>
                        <span className="font-medium">
                          {fmt(a.amount?.cents ?? a.amountCents ?? 0, cur)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Recent + import */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card title="Recent transactions">
                  <ul className="space-y-1.5 text-sm">
                    {data.recent.map((t, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="truncate">
                          {t.merchant}{" "}
                          <span className="text-slate-400">· {t.date}</span>
                        </span>
                        <span className={t.amountCents < 0 ? "text-slate-700" : "text-emerald-600"}>
                          {fmt(t.amountCents, t.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title="Import data">
                  <ImportPanel onDone={load} />
                </Card>
              </div>
            </>
          )}
        </div>

        {/* Right: chat */}
        <div className="border-l border-slate-200 bg-slate-50 h-[calc(100vh-57px)] hidden lg:block">
          <Chat onDataChanged={load} />
        </div>
      </div>

      {/* Mobile chat below */}
      <div className="lg:hidden border-t border-slate-200 bg-slate-50 h-[70vh]">
        <Chat onDataChanged={load} />
      </div>
    </div>
  );
}
