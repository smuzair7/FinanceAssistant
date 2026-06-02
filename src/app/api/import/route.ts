import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getUserId } from "@/lib/auth";
import { ingestRows, type RawRow } from "@/lib/ingest";

export const runtime = "nodejs";

// CSV import. Accepts a multipart file upload OR a raw text body. Returns a
// report of imported / duplicate / skipped rows so the user can see exactly how
// their (often messy) export was handled.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let csvText = "";
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") csvText = await (file as File).text();
    } else {
      csvText = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read upload" }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  const parsed = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const rows = (parsed.data || []).filter(
    (r) => r && typeof r === "object" && Object.keys(r).length > 0,
  );

  const report = await ingestRows(userId, rows, "csv");
  return NextResponse.json({
    ...report,
    parseErrors: parsed.errors?.length ?? 0,
  });
}
