import { createHash } from "crypto";

// A stable fingerprint for a transaction so the same charge is never imported
// twice (banks re-export overlapping date ranges; users re-upload CSVs). The
// hash is per-user (enforced by the unique index on [userId, dedupeHash]).
export function dedupeHash(input: {
  date: Date;
  amountCents: number;
  merchant: string;
}): string {
  const day = input.date.toISOString().slice(0, 10); // day granularity
  const key = `${day}|${input.amountCents}|${input.merchant.toLowerCase()}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
