import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { geminiEnabled } from "@/lib/gemini";
import { routeMessage } from "@/lib/router";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";

async function getUserCurrency(userId: string): Promise<string> {
  const top = await prisma.transaction.groupBy({
    by: ["currency"],
    where: { userId },
    _count: true,
    orderBy: { _count: { currency: "desc" } },
    take: 1,
  });
  return top[0]?.currency ?? "USD";
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!geminiEnabled()) {
    return NextResponse.json({
      text: "The assistant isn't configured yet — add a GEMINI_API_KEY to .env to enable chat. (Your data and dashboard still work.)",
      meta: { model: "none", tier: "disabled", toolsUsed: [] },
    });
  }

  const { message } = await req.json();
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Pull recent history from the DB (source of truth) rather than trusting the
  // client; keep it short to control prompt cost.
  const recent = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { role: true, content: true },
  });
  const history = recent.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const currency = await getUserCurrency(userId);

  try {
    const route = await routeMessage(message);
    const result = await runAgent({
      userId,
      currency,
      message,
      history,
      model: route.model,
    });

    const meta = {
      model: route.model,
      tier: route.tier,
      reason: route.reason,
      toolsUsed: result.toolsUsed,
    };

    // Persist both turns.
    await prisma.message.createMany({
      data: [
        { userId, role: "user", content: message },
        { userId, role: "assistant", content: result.text, meta: JSON.stringify(meta) },
      ],
    });

    return NextResponse.json({ text: result.text, meta });
  } catch (e) {
    console.error("chat error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Assistant failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, content: true, meta: true, createdAt: true },
  });
  return NextResponse.json({ messages });
}
