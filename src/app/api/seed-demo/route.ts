import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { seedUser } from "@/lib/demoData";

export const runtime = "nodejs";

// Seed the current user with the synthetic dataset (idempotent). Lets a fresh
// Clerk user populate their account with one click to try the assistant.
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const count = await seedUser(userId);
  return NextResponse.json({ ok: true, inserted: count });
}
