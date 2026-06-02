# Personal Finance Assistant

An AI-driven, multi-user finance companion. You sign in, bring in your transaction
history (CSV upload, a mock bank connection, or a photo of a receipt), and then talk
to an assistant in plain language about your money — "how much did I spend on groceries
last month?", "what subscriptions am I paying for?", "where can I cut back?".

This was built as a 6-hour take-home. The interesting engineering is not the feature
count — it's how the system stays **fast, cheap, and correct as the data grows to years
of history and the user base grows to many people at once**. The write-up of decisions
and trade-offs lives in [`DESIGN_NOTES.txt`](./DESIGN_NOTES.txt); this README is the
practical guide to what it is and how to run it.

---

## The core idea

A naive version of this product dumps a user's transactions into the model's context and
asks it to do the math. That breaks immediately: it's slow, it gets expensive on every
request, it hallucinates totals, and it falls over the moment a user has more history than
fits in a context window.

So the central bet here is the opposite:

> **The model never sees raw transactions. It calls SQL-backed tools that return small,
> pre-aggregated answers.** Every figure the assistant states comes from a database
> aggregate, never from the model's imagination.

That one decision is what makes the constraints in the brief solvable at the same time:

- **Fast & cheap** — a "how much did I spend" question is one indexed `GROUP BY`, not a
  context full of rows. Prompt size is flat regardless of history length.
- **Scales 10×–100×** — the database does the heavy lifting; the LLM payload stays a few
  hundred bytes whether you have 400 transactions or 400,000.
- **Correct** — totals are computed in SQL, so the assistant can't misadd.

On top of that sits a **router** that matches model effort to the task (cheap model for
lookups, a heavier one for open-ended advice), and an **agent loop** that lets the model
chain those tools to answer multi-step questions.

---

## Quickstart

**Prerequisites:** Node 18+ (built on Node 22). A free [Gemini API key](https://aistudio.google.com/apikey)
to enable the assistant. Clerk is optional — see below.

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env        # Windows: copy .env.example .env
#   -> set GEMINI_API_KEY in .env (required for chat + receipts)
#   -> Clerk keys are OPTIONAL (see "Auth modes" below)

# 3. Create the database (SQLite) and generate the client
npx prisma migrate dev

# 4. Seed ~18 months of synthetic demo data for the local user
npm run seed

# 5. Run
npm run dev
```

Open <http://localhost:3000>. You'll land on a dashboard already populated with data.
Try the assistant on the right: *"What recurring subscriptions do I have?"* or upload a
receipt photo with the 📎 button.

> **Without a Gemini key:** the dashboard, data import, dedupe, recurring/anomaly
> detection and budgets all still work — only the chat and receipt OCR need the key.

### Auth modes (build-vs-buy)

Authentication is commodity work, so it's bought, not built — via **Clerk**. But to keep
the app instantly runnable for review, it degrades gracefully:

- **Clerk keys set** → full multi-user auth; every user's data is isolated by their Clerk
  `userId`. Sign-up/sign-in pages and a user button appear automatically.
- **Clerk keys blank** (default) → the app runs in single-user **demo mode** with no
  sign-in, so you can evaluate everything without creating a Clerk account.

The whole app reads identity through one helper (`getUserId()` in `src/lib/auth.ts`), so
nothing downstream knows or cares which mode it's in.

---

## What the assistant can do

| Capability (from the brief) | Status | How it works |
|---|---|---|
| Answer spending questions | ✅ | `query_spending` / `get_largest_transactions` — SQL `GROUP BY` |
| Read a receipt from a photo | ✅ | Gemini vision → structured JSON → confirm → recorded |
| Surface recurring subscriptions | ✅ | Deterministic cadence + stable-amount detection |
| Flag unusual activity | ✅ | Per-category statistical outliers (z-score) |
| Compare across time | ✅ | `compare_periods` over arbitrary ranges |
| Track a budget + warn near limit | ✅ | `set_budget` / `get_budget_status` with status flags |
| Look up unfamiliar charges (online) | ✅ | `lookup_merchant` via Gemini Google Search grounding |
| Summarise finances in plain English | ✅ | `get_financial_summary` → model narrates |
| Suggest where to cut back | ✅ | Summary aggregates → reasoning-tier model |
| Remember user context | ✅ | `set_memory` → injected into the system prompt |
| Multi-user, private data | ✅ | Clerk + per-`userId` scoping on every query |
| Messy data ingestion | ✅ | Dedupe, missing fields, junk rows, mixed date/amount formats |
| Routing & model selection | ✅ | Keyword fast-path + cheap classifier picks the tier |

Edge cases handled deliberately: ambiguous questions get a clarifying question; questions
the data can't answer get an honest "I can't tell from your data" rather than a made-up
number; a re-uploaded receipt or re-imported CSV won't double-count; low-confidence
receipt scans ask you to confirm before recording.

---

## How a request flows

```
User message
   │
   ▼
Router  ──────────────►  flash-lite (simple lookup)  ┐
(keyword fast-path,      flash      (balanced/default) ├─ chosen model
 else 1 cheap call)      pro        (reasoning/advice) ┘
   │
   ▼
Agent loop  ──►  picks SQL-backed tools  ──►  executes against SQLite (indexed)
   │                                              │
   │  ◄───────── compact JSON aggregates ─────────┘
   ▼
Final answer (+ a transparency badge showing the model tier and tools used)
```

The receipt path is separate: image → Gemini vision (forced JSON schema) → user confirms
→ saved through the same dedupe pipeline as every other source.

---

## Project structure

```
src/
  lib/
    analytics.ts   # deterministic SQL aggregates (the large-context strategy)
    tools.ts       # Gemini function declarations + executors
    agent.ts       # bounded tool-calling loop
    router.ts      # model selection (cost/latency routing)
    ingest.ts      # messy-data normalization + dedupe pipeline
    receipt.ts     # vision extraction with confidence + confirm
    categorize.ts  # merchant normalization + rule-based categories
    money.ts       # integer-cents money handling + loose parsing
    demoData.ts    # synthetic dataset generator
    auth.ts        # Clerk with a single-user dev fallback
  app/
    api/           # chat, import, bank, receipt, dashboard, seed-demo
    dashboard/     # the app (server-auth wrapper + client UI)
  components/      # Chat, DashboardClient, ImportPanel
prisma/schema.prisma
scripts/seed.ts
samples/           # clean + intentionally messy CSVs to test the importer
tests/             # unit tests for the deterministic data layer
```

---

## Testing

```bash
npm test            # 17 unit tests over the deterministic data layer
```

These cover the parts that must be correct on every row regardless of the model: money
parsing (US/European/parenthesised/`$`), date disambiguation, merchant normalization,
categorization, dedupe-hash stability, and row normalization (including skip reasons).

Manual end-to-end checks you can run immediately after seeding:

```bash
# Import the intentionally messy sample and watch it report what it handled
curl -X POST -F "file=@samples/transactions_messy.csv" http://localhost:3000/api/import
# -> { imported, duplicates, skipped, skippedReasons: { bad_or_missing_date, ... } }
```

---

## Scaling notes (what changes for production)

The architecture is chosen so the path to scale is a configuration change, not a rewrite:

- **Database:** SQLite is for zero-setup review. The Prisma schema is Postgres-compatible
  — change the `provider` and `DATABASE_URL` and it runs unchanged, with the same indexes.
- **Heavy analytics:** recurring/anomaly detection currently run per request. At scale
  they'd be precomputed on a schedule and cached, and large aggregates moved to
  materialized rollups (per-user, per-month).
- **Bank data:** the mock endpoint stands in for a real aggregator (Plaid/TrueLayer)
  behind the same source-agnostic ingestion pipeline.

See [`DESIGN_NOTES.txt`](./DESIGN_NOTES.txt) for the full reasoning, trade-offs, and what
was intentionally left out.
