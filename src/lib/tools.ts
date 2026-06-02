import { Type, type FunctionDeclaration } from "@google/genai";
import { prisma } from "./db";
import { formatMoney } from "./money";
import { normalizeMerchant, categorize } from "./categorize";
import { dedupeHash } from "./dedupe";
import { getGemini, MODELS } from "./gemini";
import {
  spendingByCategory,
  largestTransactions,
  comparePeriods,
  recurringCharges,
  detectAnomalies,
  budgetStatus,
  financialSummary,
} from "./analytics";

// ---------------------------------------------------------------------------
// Tool registry. Each tool is a thin wrapper over deterministic analytics or a
// single scoped DB write. The model orchestrates these; it never sees raw rows.
// Money is returned both as integer cents and a pre-formatted string so the
// model narrates exact figures instead of re-deriving (and mis-stating) them.
// ---------------------------------------------------------------------------

export interface ToolContext {
  userId: string;
  currency: string;
}

interface ToolDef {
  declaration: FunctionDeclaration;
  execute: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

function money(cents: number, currency: string) {
  return { cents, display: formatMoney(cents, currency) };
}

function parseRange(start: unknown, end: unknown) {
  const s = new Date(String(start));
  const e = new Date(String(end));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
  // Make end inclusive through the whole day.
  e.setUTCHours(23, 59, 59, 999);
  return { start: s, end: e };
}

export const TOOLS: Record<string, ToolDef> = {
  query_spending: {
    declaration: {
      name: "query_spending",
      description:
        "Total spending in a date range, broken down by category. Use for questions like 'how much did I spend on groceries last month'. Dates are YYYY-MM-DD.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING, description: "Start date YYYY-MM-DD" },
          end: { type: Type.STRING, description: "End date YYYY-MM-DD" },
          category: {
            type: Type.STRING,
            description: "Optional category filter, e.g. Groceries, Dining",
          },
        },
        required: ["start", "end"],
      },
    },
    execute: async (ctx, args) => {
      const range = parseRange(args.start, args.end);
      const res = await spendingByCategory(ctx.userId, range, args.category as string | undefined);
      return {
        total: money(res.totalSpentCents, ctx.currency),
        categories: res.categories.map((c) => ({
          category: c.category,
          spent: money(c.spentCents, ctx.currency),
          count: c.count,
        })),
      };
    },
  },

  get_largest_transactions: {
    declaration: {
      name: "get_largest_transactions",
      description:
        "The biggest individual purchases in a date range. Use for 'what was my biggest purchase in March'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING },
          end: { type: Type.STRING },
          limit: { type: Type.NUMBER, description: "How many to return (default 5)" },
          category: { type: Type.STRING },
        },
        required: ["start", "end"],
      },
    },
    execute: async (ctx, args) => {
      const range = parseRange(args.start, args.end);
      const rows = await largestTransactions(
        ctx.userId,
        range,
        (args.limit as number) ?? 5,
        args.category as string | undefined,
      );
      return rows.map((r) => ({ ...r, spent: money(r.spentCents, ctx.currency) }));
    },
  },

  compare_periods: {
    declaration: {
      name: "compare_periods",
      description:
        "Compare spending between two periods to answer 'am I spending more than usual'. Provide both period ranges.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          periodA_start: { type: Type.STRING, description: "Recent period start" },
          periodA_end: { type: Type.STRING },
          periodB_start: { type: Type.STRING, description: "Baseline period start" },
          periodB_end: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ["periodA_start", "periodA_end", "periodB_start", "periodB_end"],
      },
    },
    execute: async (ctx, args) => {
      const a = parseRange(args.periodA_start, args.periodA_end);
      const b = parseRange(args.periodB_start, args.periodB_end);
      const res = await comparePeriods(ctx.userId, a, b, args.category as string | undefined);
      return {
        recent: money(res.periodA.totalSpentCents, ctx.currency),
        baseline: money(res.periodB.totalSpentCents, ctx.currency),
        delta: money(res.deltaCents, ctx.currency),
        pctChange: res.pctChange == null ? null : Math.round(res.pctChange),
      };
    },
  },

  list_recurring_charges: {
    declaration: {
      name: "list_recurring_charges",
      description:
        "Detect recurring charges / subscriptions (Netflix, gym, etc.) the user may have forgotten. No arguments.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    execute: async (ctx) => {
      const items = await recurringCharges(ctx.userId);
      return items.map((i) => ({
        merchant: i.merchant,
        category: i.category,
        cadence: i.cadence,
        typicalAmount: money(i.typicalAmountCents, ctx.currency),
        estMonthlyCost: money(i.monthlyEstimateCents, ctx.currency),
        lastCharge: i.lastCharge,
        occurrences: i.occurrences,
      }));
    },
  },

  detect_anomalies: {
    declaration: {
      name: "detect_anomalies",
      description:
        "Flag recent charges that are unusually large for this user's own pattern. Use for 'any unusual activity'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          lookback_days: { type: Type.NUMBER, description: "Baseline window, default 90" },
        },
      },
    },
    execute: async (ctx, args) => {
      const items = await detectAnomalies(ctx.userId, (args.lookback_days as number) ?? 90);
      return items.map((i: any) => ({
        ...i,
        amount: money(i.amountCents, ctx.currency),
        categoryAverage: money(i.categoryAverageCents, ctx.currency),
      }));
    },
  },

  get_budget_status: {
    declaration: {
      name: "get_budget_status",
      description:
        "Current-month budget usage with warnings when close to or over the limit. No arguments.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    execute: async (ctx) => {
      const items = await budgetStatus(ctx.userId);
      return items.map((b) => ({
        category: b.category,
        budget: money(b.budgetCents, ctx.currency),
        spent: money(b.spentCents, ctx.currency),
        remaining: money(b.remainingCents, ctx.currency),
        pctUsed: b.pctUsed,
        status: b.status,
      }));
    },
  },

  set_budget: {
    declaration: {
      name: "set_budget",
      description:
        "Create or update a monthly budget. amount is in major units (e.g. 400 means $400). Omit category for an overall budget.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER, description: "Budget amount in dollars/pounds" },
          category: { type: Type.STRING, description: "Category, or omit for overall" },
        },
        required: ["amount"],
      },
    },
    execute: async (ctx, args) => {
      const amountCents = Math.round((args.amount as number) * 100);
      const category = (args.category as string | undefined) || null;
      // Avoid an upsert on a nullable compound key (overall budget = null
      // category); find-then-write keeps SQLite's NULL handling predictable.
      const existing = await prisma.budget.findFirst({
        where: { userId: ctx.userId, category, period: "monthly" },
      });
      if (existing) {
        await prisma.budget.update({ where: { id: existing.id }, data: { amountCents } });
      } else {
        await prisma.budget.create({
          data: { userId: ctx.userId, category, amountCents, period: "monthly" },
        });
      }
      return { ok: true, category: category ?? "Overall", budget: money(amountCents, ctx.currency) };
    },
  },

  set_memory: {
    declaration: {
      name: "set_memory",
      description:
        "Remember a durable fact or preference the user states, e.g. 'I get paid on the 1st' or 'don't count rent in my food budget'. Apply it in future answers.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING, description: "Short slug, e.g. payday, exclude_rent" },
          value: { type: Type.STRING, description: "Structured value, e.g. '1' or 'true'" },
          raw_text: { type: Type.STRING, description: "The user's original sentence" },
        },
        required: ["key", "value", "raw_text"],
      },
    },
    execute: async (ctx, args) => {
      await prisma.userFact.upsert({
        where: { userId_key: { userId: ctx.userId, key: String(args.key) } },
        update: { value: String(args.value), rawText: String(args.raw_text) },
        create: {
          userId: ctx.userId,
          key: String(args.key),
          value: String(args.value),
          rawText: String(args.raw_text),
        },
      });
      return { ok: true, remembered: args.raw_text };
    },
  },

  get_financial_summary: {
    declaration: {
      name: "get_financial_summary",
      description:
        "A compact income/spend/net picture with top categories for a period. Use as the basis for plain-English summaries and cut-back suggestions.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING },
          end: { type: Type.STRING },
        },
        required: ["start", "end"],
      },
    },
    execute: async (ctx, args) => {
      const range = parseRange(args.start, args.end);
      const s = await financialSummary(ctx.userId, range);
      return {
        range: s.range,
        income: money(s.incomeCents, ctx.currency),
        totalSpent: money(s.totalSpentCents, ctx.currency),
        net: money(s.netCents, ctx.currency),
        topCategories: s.topCategories.map((c) => ({
          category: c.category,
          spent: money(c.spentCents, ctx.currency),
          count: c.count,
        })),
      };
    },
  },

  record_expense: {
    declaration: {
      name: "record_expense",
      description:
        "Record a new expense the user describes in words (not from a receipt image). amount is in major units.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          merchant: { type: Type.STRING },
          amount: { type: Type.NUMBER, description: "Positive number; stored as spending" },
          date: { type: Type.STRING, description: "YYYY-MM-DD, default today" },
          category: { type: Type.STRING },
        },
        required: ["merchant", "amount"],
      },
    },
    execute: async (ctx, args) => {
      const date = args.date ? new Date(String(args.date)) : new Date();
      if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
      const merchant = normalizeMerchant(String(args.merchant));
      const amountCents = -Math.abs(Math.round((args.amount as number) * 100));
      const category =
        (args.category as string | undefined) || categorize(String(args.merchant), merchant);
      await prisma.transaction.create({
        data: {
          userId: ctx.userId,
          date,
          amountCents,
          currency: ctx.currency,
          rawDescription: String(args.merchant),
          merchant,
          category,
          source: "manual",
          dedupeHash: dedupeHash({ date, amountCents, merchant }),
        },
      });
      return { ok: true, merchant, amount: money(amountCents, ctx.currency), category };
    },
  },

  lookup_merchant: {
    declaration: {
      name: "lookup_merchant",
      description:
        "Identify an unfamiliar merchant or charge by searching the web. Use when the user does not recognise a charge.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "The merchant/charge string to look up" },
        },
        required: ["name"],
      },
    },
    execute: async (_ctx, args) => {
      // Separate, Google-Search-grounded call. Grounding is its own tool in
      // Gemini and can't be mixed with function-calling in one request, so we
      // isolate it here and hand the result back to the agent loop.
      const ai = getGemini();
      const resp = await ai.models.generateContent({
        model: MODELS.FAST,
        contents: `In 1-2 sentences, what is the company or service behind this card charge: "${args.name}"? If unsure, say so plainly.`,
        config: { tools: [{ googleSearch: {} }] },
      });
      const sources =
        resp.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((c: any) => c.web?.uri)
          .filter(Boolean)
          .slice(0, 3) ?? [];
      return { explanation: resp.text ?? "No information found.", sources };
    },
  },
};

export function toolDeclarations(): FunctionDeclaration[] {
  return Object.values(TOOLS).map((t) => t.declaration);
}
