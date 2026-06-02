import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeMerchant, categorize } from "@/lib/categorize";
import { dedupeHash } from "@/lib/dedupe";

export const runtime = "nodejs";

// Persist a confirmed receipt as an expense, through the same dedupe logic as
// every other source so a re-submitted receipt won't double-count.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const merchantRaw = String(body.merchant ?? "").trim();
  const total = Number(body.total);
  if (!merchantRaw || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: "merchant and a positive total are required" }, { status: 400 });
  }

  const date = body.date ? new Date(String(body.date)) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const merchant = normalizeMerchant(merchantRaw);
  const amountCents = -Math.abs(Math.round(total * 100));
  const currency = (String(body.currency || "USD")).toUpperCase().slice(0, 3);
  const category = body.category || categorize(merchantRaw, merchant);
  const hash = dedupeHash({ date, amountCents, merchant });

  try {
    const txn = await prisma.transaction.upsert({
      where: { userId_dedupeHash: { userId, dedupeHash: hash } },
      update: {},
      create: {
        userId,
        date,
        amountCents,
        currency,
        rawDescription: merchantRaw,
        merchant,
        category,
        source: "receipt",
        dedupeHash: hash,
      },
    });
    return NextResponse.json({ ok: true, transaction: txn });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 500 },
    );
  }
}
