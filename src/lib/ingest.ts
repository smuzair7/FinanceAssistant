import { prisma } from "./db";
import { parseAmountToCents } from "./money";
import { normalizeMerchant, categorize } from "./categorize";
import { dedupeHash } from "./dedupe";

// ---------------------------------------------------------------------------
// Ingestion pipeline shared by CSV upload, the mock bank, and receipt capture.
// Designed around the brief's "messy dataset" requirement: duplicates, missing
// fields, odd date formats and junk rows must be handled gracefully, never crash.
// ---------------------------------------------------------------------------

export interface RawRow {
  [key: string]: string | number | undefined;
}

export interface NormalizedTxn {
  date: Date;
  amountCents: number;
  currency: string;
  rawDescription: string;
  merchant: string;
  category: string;
  source: string;
  dedupeHash: string;
}

export interface IngestReport {
  imported: number;
  duplicates: number;
  skipped: number;
  skippedReasons: Record<string, number>;
}

/** Find a value by trying several possible header names (case-insensitive). */
function pick(row: RawRow, names: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const name of names) {
    const k = keys.find((k) => k.toLowerCase().trim() === name);
    if (k != null && row[k] != null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  return undefined;
}

/** Robust date parsing across the formats real exports use. */
export function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO-ish: 2024-03-15 or 2024/03/15
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return safeDate(+m[1], +m[2], +m[3]);

  // D/M/Y or M/D/Y — ambiguous. Prefer M/D/Y (US) unless first part > 12.
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    let year = +y;
    if (year < 100) year += 2000;
    let month = +a;
    let day = +b;
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return safeDate(year, month, day);
  }

  // Fall back to Date parsing (handles "15 Mar 2024", "Mar 15, 2024", etc.).
  // Rebuild from local components into UTC so the calendar day never shifts due
  // to the server's timezone.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function safeDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turn one raw row into a normalized transaction, or return why it was skipped.
 * `source` flags the origin so receipts/bank pulls are auditable.
 */
export function normalizeRow(
  row: RawRow,
  source: string,
): { txn: NormalizedTxn } | { skip: string } {
  const dateStr = pick(row, ["date", "transaction date", "posted", "time"]);
  const date = parseDate(dateStr);
  if (!date) return { skip: "bad_or_missing_date" };

  // Amount may be a single signed column or separate debit/credit columns.
  let amountCents: number | null = null;
  const amountStr = pick(row, ["amount", "value", "total"]);
  if (amountStr != null) {
    amountCents = parseAmountToCents(amountStr);
  } else {
    const debit = pick(row, ["debit", "withdrawal", "money out"]);
    const credit = pick(row, ["credit", "deposit", "money in"]);
    if (debit) amountCents = -Math.abs(parseAmountToCents(debit) ?? NaN);
    else if (credit) amountCents = Math.abs(parseAmountToCents(credit) ?? NaN);
  }
  if (amountCents == null || Number.isNaN(amountCents) || amountCents === 0) {
    return { skip: "bad_or_missing_amount" };
  }

  const rawDescription =
    pick(row, ["description", "merchant", "name", "details", "memo", "payee"]) ??
    "";
  if (!rawDescription) return { skip: "missing_description" };

  const merchant = normalizeMerchant(rawDescription);
  const explicitCat = pick(row, ["category"]);
  const category = explicitCat || categorize(rawDescription, merchant);
  const currency = (pick(row, ["currency", "ccy"]) || "USD").toUpperCase().slice(0, 3);

  return {
    txn: {
      date,
      amountCents,
      currency,
      rawDescription,
      merchant,
      category,
      source,
      dedupeHash: dedupeHash({ date, amountCents, merchant }),
    },
  };
}

/** Normalize + persist rows, skipping junk and rejecting duplicates. */
export async function ingestRows(
  userId: string,
  rows: RawRow[],
  source: string,
): Promise<IngestReport> {
  const report: IngestReport = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    skippedReasons: {},
  };

  const toInsert: NormalizedTxn[] = [];
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    const res = normalizeRow(row, source);
    if ("skip" in res) {
      report.skipped++;
      report.skippedReasons[res.skip] = (report.skippedReasons[res.skip] || 0) + 1;
      continue;
    }
    // De-dupe within the file itself before hitting the DB.
    if (seenInBatch.has(res.txn.dedupeHash)) {
      report.duplicates++;
      continue;
    }
    seenInBatch.add(res.txn.dedupeHash);
    toInsert.push(res.txn);
  }

  if (toInsert.length) {
    // SQLite's createMany has no skipDuplicates, so we drop cross-import
    // duplicates explicitly: one indexed lookup of the batch's hashes, then
    // insert only the new ones. Scales fine because the `in` filter hits the
    // [userId, dedupeHash] unique index rather than scanning the table.
    const hashes = toInsert.map((t) => t.dedupeHash);
    const existing = await prisma.transaction.findMany({
      where: { userId, dedupeHash: { in: hashes } },
      select: { dedupeHash: true },
    });
    const existingSet = new Set(existing.map((e) => e.dedupeHash));
    const fresh = toInsert.filter((t) => !existingSet.has(t.dedupeHash));
    report.duplicates += toInsert.length - fresh.length;

    if (fresh.length) {
      const result = await prisma.transaction.createMany({
        data: fresh.map((t) => ({ ...t, userId })),
      });
      report.imported = result.count;
    }
  }

  return report;
}
