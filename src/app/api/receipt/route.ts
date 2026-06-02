import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { geminiEnabled } from "@/lib/gemini";
import { extractReceipt } from "@/lib/receipt";

export const runtime = "nodejs";

// Extract a receipt image into structured fields. We do NOT write to the DB
// here — extraction can be wrong on messy photos, so we return the parsed data
// plus a confirmation flag and let the user verify before it becomes an expense.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!geminiEnabled()) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 503 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f && typeof f !== "string") file = f as File;
  } catch {
    return NextResponse.json({ error: "Could not read upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");
  const mimeType = file.type || "image/jpeg";

  try {
    const extracted = await extractReceipt(base64, mimeType);
    // Ask the user to confirm when we're unsure or the amount is missing.
    const needsConfirmation = extracted.confidence < 0.7 || extracted.total == null;
    return NextResponse.json({ extracted, needsConfirmation });
  } catch (e) {
    console.error("receipt error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed" },
      { status: 500 },
    );
  }
}
