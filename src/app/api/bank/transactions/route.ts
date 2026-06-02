import { NextResponse } from "next/server";
import { generateDemoTransactions } from "@/lib/demoData";

export const runtime = "nodejs";

// Mock bank endpoint. Stands in for a real aggregator (Plaid/TrueLayer). It
// returns transactions in a typical bank-export JSON shape so the sync route
// can exercise the same normalization + dedupe pipeline as CSV upload.
export async function GET() {
  const txns = generateDemoTransactions(6).map((t) => ({
    transaction_id: `${t.date.toISOString().slice(0, 10)}-${t.description}-${t.amountCents}`,
    posted_date: t.date.toISOString().slice(0, 10),
    amount: (t.amountCents / 100).toFixed(2),
    description: t.description,
    iso_currency_code: "USD",
  }));
  return NextResponse.json({ account: "Mock Checking ••1234", transactions: txns });
}
