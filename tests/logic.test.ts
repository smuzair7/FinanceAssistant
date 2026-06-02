import { describe, it, expect } from "vitest";
import { parseAmountToCents } from "../src/lib/money";
import { normalizeMerchant, categorize } from "../src/lib/categorize";
import { dedupeHash } from "../src/lib/dedupe";
import { parseDate, normalizeRow } from "../src/lib/ingest";

// These cover the deterministic data layer — the parts that must be correct and
// fast on every imported row, independent of any model or database.

describe("parseAmountToCents", () => {
  it("parses plain US amounts", () => {
    expect(parseAmountToCents("-82.14")).toBe(-8214);
    expect(parseAmountToCents("4200.00")).toBe(420000);
  });
  it("handles currency symbols and thousands separators", () => {
    expect(parseAmountToCents("-$1,234.56")).toBe(-123456);
  });
  it("treats parentheses as negative", () => {
    expect(parseAmountToCents("(54.30)")).toBe(-5430);
  });
  it("handles European decimal commas", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
  });
  it("returns null for junk", () => {
    expect(parseAmountToCents("not money")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses ISO", () => {
    expect(parseDate("2026-05-03")?.toISOString().slice(0, 10)).toBe("2026-05-03");
  });
  it("disambiguates D/M/Y when day > 12", () => {
    expect(parseDate("15/05/2026")?.toISOString().slice(0, 10)).toBe("2026-05-15");
  });
  it("parses written dates", () => {
    expect(parseDate("Mar 15 2026")?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });
  it("rejects junk", () => {
    expect(parseDate("this is not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("normalizeMerchant", () => {
  it("strips card/POS noise and store ids", () => {
    expect(normalizeMerchant("WHOLE FOODS MKT POS PURCHASE")).toBe("Whole Foods Mkt");
    expect(normalizeMerchant("SHELL OIL 34221")).toBe("Shell Oil");
    expect(normalizeMerchant("AMAZON.COM*A1B2C3")).toContain("Amazon");
  });
});

describe("categorize", () => {
  it("maps known merchants to categories", () => {
    expect(categorize("NETFLIX.COM", "Netflix Com")).toBe("Subscriptions");
    expect(categorize("WHOLE FOODS MKT", "Whole Foods")).toBe("Groceries");
    expect(categorize("ACME CORP PAYROLL", "Acme Corp Payroll")).toBe("Income");
    expect(categorize("RANDOM UNKNOWN THING", "Random")).toBe("Other");
  });
});

describe("dedupeHash", () => {
  it("is stable for identical inputs", () => {
    const a = dedupeHash({ date: new Date("2026-05-03"), amountCents: -8214, merchant: "Whole Foods" });
    const b = dedupeHash({ date: new Date("2026-05-03"), amountCents: -8214, merchant: "whole foods" });
    expect(a).toBe(b);
  });
  it("differs when amount differs", () => {
    const a = dedupeHash({ date: new Date("2026-05-03"), amountCents: -8214, merchant: "X" });
    const b = dedupeHash({ date: new Date("2026-05-03"), amountCents: -8215, merchant: "X" });
    expect(a).not.toBe(b);
  });
});

describe("normalizeRow", () => {
  it("normalizes a clean row", () => {
    const res = normalizeRow(
      { date: "2026-05-03", description: "NETFLIX.COM", amount: "-15.99" },
      "csv",
    );
    expect("txn" in res).toBe(true);
    if ("txn" in res) {
      expect(res.txn.amountCents).toBe(-1599);
      expect(res.txn.category).toBe("Subscriptions");
    }
  });
  it("skips rows with no date", () => {
    const res = normalizeRow({ description: "X", amount: "-1.00" }, "csv");
    expect("skip" in res && res.skip).toBe("bad_or_missing_date");
  });
  it("skips rows with no amount", () => {
    const res = normalizeRow({ date: "2026-05-03", description: "X" }, "csv");
    expect("skip" in res && res.skip).toBe("bad_or_missing_amount");
  });
  it("maps separate debit/credit columns", () => {
    const res = normalizeRow({ date: "2026-05-03", description: "X", debit: "20.00" }, "csv");
    expect("txn" in res && res.txn.amountCents).toBe(-2000);
  });
});
