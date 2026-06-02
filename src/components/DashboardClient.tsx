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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string) {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ?? ym;
}
function fullMonth(ym: string) {
  const m = Number(ym.slice(5, 7));
  return `${MONTHS[m - 1] ?? ""} ${ym.slice(0, 4)}`;
}

const CAT_COLOR: Record<string, string> = {
  Income: "bg-emerald-100 text-emerald-700",
  Rent: "bg-rose-100 text-rose-700",
  Groceries: "bg-lime-100 text-lime-700",
  Dining: "bg-amber-100 text-amber-700",
  Transport: "bg-sky-100 text-sky-700",
  Subscriptions: "bg-violet-100 text-violet-700",
  Utilities: "bg-cyan-100 text-cyan-700",
  Shopping: "bg-fuchsia-100 text-fuchsia-700",
  Health: "bg-teal-100 text-teal-700",
  Entertainment: "bg-indigo-100 text-indigo-700",
  Travel: "bg-blue-100 text-blue-700",
  Other: "bg-slate-100 text-slate-600",
};
const catBadge = (c: string) => CAT_COLOR[c] ?? "bg-slate-100 text-slate-600";

function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card card-hover p-5 ${className}`}>
      {title && (
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          {title}
        </h3>
      )}
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
  const net = data?.summary.net.cents ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3.5 border-b border-white/60 bg-white/55 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="brand-mark h-8 w-8 rounded-lg grid place-items-center text-white font-bold text-sm">
            L
          </div>
          <span className="font-display text-lg font-semibold text-slate-900">Lumen</span>
          {!clerkOn && (
            <span className="ml-1 rounded-full bg-amber-100/80 text-amber-700 px-2.5 py-0.5 text-[11px] font-medium">
              demo mode
            </span>
          )}
        </div>
        {clerkOn && <UserButton />}
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_440px] overflow-hidden">
        {/* Left: dashboard */}
        <div className="overflow-y-auto scroll-thin p-6 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-slate-400">
              <span className="dot">•</span>
              <span className="dot" style={{ animationDelay: "0.2s" }}>•</span>
              <span className="dot" style={{ animationDelay: "0.4s" }}>•</span>
              <span className="ml-1 text-sm">Loading your finances…</span>
            </div>
          )}

          {data && data.transactionCount === 0 && (
            <div className="card p-10 text-center fade-up">
              <div className="brand-mark mx-auto h-12 w-12 rounded-2xl grid place-items-center text-white text-xl font-bold mb-4">
                L
              </div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Let’s bring in your money
              </h2>
              <p className="text-slate-500 mt-1.5 mb-5 max-w-sm mx-auto">
                Load the demo dataset, connect the mock bank, or import a CSV to get started.
              </p>
              <div className="flex justify-center">
                <ImportPanel onDone={load} />
              </div>
            </div>
          )}

          {data && data.transactionCount > 0 && (
            <>
              {/* Spotlight gradient card */}
              <section
                className="relative overflow-hidden rounded-3xl p-7 text-white fade-up"
                style={{ backgroundImage: "linear-gradient(135deg,#6d28d9 0%,#4f46e5 52%,#0284c7 100%)" }}
              >
                <div className="absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
                <div className="absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
                <div className="relative">
                  <p className="text-sm text-white/70">
                    Spent in {fullMonth(data.summary.range.start)}
                  </p>
                  <p className="mt-1 font-display text-5xl font-semibold tnum">
                    {fmt(data.summary.totalSpent.cents, cur)}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                    <div>
                      <p className="text-xs text-white/60">Income</p>
                      <p className="text-lg font-semibold tnum">{fmt(data.summary.income.cents, cur)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-white/60">Net</p>
                      <p className="text-lg font-semibold tnum">
                        {net >= 0 ? "+" : ""}
                        {fmt(net, cur)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-white/60">Transactions</p>
                      <p className="text-lg font-semibold tnum">
                        {data.transactionCount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Trend */}
              <Card title="Spending — last 6 months">
                <div className="flex items-end gap-3 h-36 pt-2">
                  {data.trend.map((t, i) => {
                    const isLast = i === data.trend.length - 1;
                    return (
                      <div key={t.month} className="group flex-1 flex flex-col items-center justify-end gap-2">
                        <span className="text-[10px] font-medium text-slate-400 opacity-0 group-hover:opacity-100 transition tnum">
                          {fmt(t.spentCents, cur)}
                        </span>
                        <div
                          className="w-full rounded-t-lg transition-all duration-300 group-hover:brightness-110"
                          style={{
                            height: `${Math.max(4, (t.spentCents / maxTrend) * 100)}%`,
                            backgroundImage: isLast
                              ? "linear-gradient(to top,#4f46e5,#22d3ee)"
                              : "linear-gradient(to top,#6366f1,#a5b4fc)",
                          }}
                        />
                        <span className={`text-[11px] ${isLast ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>
                          {monthLabel(t.month)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <div className="grid md:grid-cols-2 gap-5">
                {/* Budgets */}
                <Card title="Budgets">
                  {data.budgets.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No budgets yet. Ask the assistant: <span className="text-slate-500">“set a $400 groceries budget”</span>.
                    </p>
                  ) : (
                    <ul className="space-y-3.5">
                      {data.budgets.map((b) => (
                        <li key={b.category}>
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-slate-700">{b.category}</span>
                            <span className="text-slate-500 tnum">
                              {fmt(b.spent.cents, cur)} / {fmt(b.budget.cents, cur)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, b.pctUsed)}%`,
                                backgroundImage:
                                  b.status === "over"
                                    ? "linear-gradient(90deg,#f43f5e,#fb7185)"
                                    : b.status === "warning"
                                    ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                                    : "linear-gradient(90deg,#10b981,#34d399)",
                              }}
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
                    <ul className="divide-y divide-slate-100/80">
                      {data.recurring.slice(0, 6).map((r) => (
                        <li key={r.merchant} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{r.merchant}</p>
                            <p className="text-[11px] text-slate-400">{r.cadence}</p>
                          </div>
                          <span className="text-sm text-slate-600 tnum shrink-0">
                            {fmt(r.estMonthlyCost?.cents ?? r.monthlyEstimateCents ?? 0, cur)}
                            <span className="text-slate-400 text-xs">/mo</span>
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
                  <ul className="space-y-2.5">
                    {data.anomalies.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between rounded-xl bg-rose-50/60 border border-rose-100 px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                              a.severity === "high" ? "bg-rose-500" : "bg-amber-500"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{a.merchant}</p>
                            <p className="text-[11px] text-slate-400">{a.category} · {a.date}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-rose-600 tnum shrink-0">
                          {fmt(a.amount?.cents ?? a.amountCents ?? 0, cur)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Recent + import */}
              <div className="grid md:grid-cols-2 gap-5">
                <Card title="Recent transactions">
                  <ul className="divide-y divide-slate-100/80">
                    {data.recent.map((t, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${catBadge(t.category)}`}>
                            {t.category}
                          </span>
                          <span className="text-sm text-slate-700 truncate">{t.merchant}</span>
                        </div>
                        <span className={`text-sm tnum shrink-0 ${t.amountCents < 0 ? "text-slate-700" : "text-emerald-600 font-medium"}`}>
                          {t.amountCents >= 0 ? "+" : ""}
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
        <div className="border-l border-white/60 bg-white/30 backdrop-blur-sm h-[calc(100vh-61px)] hidden lg:block">
          <Chat onDataChanged={load} />
        </div>
      </div>

      {/* Mobile chat below */}
      <div className="lg:hidden border-t border-white/60 bg-white/30 h-[75vh]">
        <Chat onDataChanged={load} />
      </div>
    </div>
  );
}
