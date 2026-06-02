import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { ingestRows, type RawRow } from "@/lib/ingest";

export const runtime = "nodejs";

// "Connect bank" action: pull from the mock bank endpoint and run the results
// through the shared ingestion pipeline. Field names differ from CSV on purpose
// — the importer maps them, proving the pipeline is source-agnostic.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const origin = req.nextUrl.origin;
  const res = await fetch(`${origin}/api/bank/transactions`, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: "Bank fetch failed" }, { status: 502 });
  }
  const data = await res.json();

  const rows: RawRow[] = (data.transactions ?? []).map((t: any) => ({
    date: t.posted_date,
    amount: t.amount,
    description: t.description,
    currency: t.iso_currency_code,
  }));

  const report = await ingestRows(userId, rows, "bank");
  return NextResponse.json({ account: data.account, ...report });
}
