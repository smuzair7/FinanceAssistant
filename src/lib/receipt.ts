import { Type } from "@google/genai";
import { getGemini, MODELS } from "./gemini";

// Receipt OCR via Gemini vision with a forced JSON schema. We deliberately ask
// the model for a confidence score and to leave fields null when unreadable,
// so the UI can ask the user to confirm rather than silently recording a wrong
// amount — the brief's blurry/rotated/foreign-language case.

export interface ExtractedReceipt {
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  total: number | null; // major units
  currency: string | null;
  category: string | null;
  lineItems: Array<{ description: string; amount: number }>;
  confidence: number; // 0..1
  notes: string | null;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    merchant: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD" },
    total: { type: Type.NUMBER, nullable: true, description: "Grand total in major units" },
    currency: { type: Type.STRING, nullable: true, description: "ISO code, best guess" },
    category: { type: Type.STRING, nullable: true },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          amount: { type: Type.NUMBER },
        },
        required: ["description", "amount"],
      },
    },
    confidence: { type: Type.NUMBER, description: "0..1 overall extraction confidence" },
    notes: { type: Type.STRING, nullable: true, description: "Anything unclear, rotated, or cut off" },
  },
  required: ["confidence", "lineItems"],
};

export async function extractReceipt(
  base64: string,
  mimeType: string,
): Promise<ExtractedReceipt> {
  const ai = getGemini();
  const resp = await ai.models.generateContent({
    model: MODELS.FAST, // vision-capable, cheap enough for per-receipt use
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text:
              "Extract the receipt into the schema. The image may be blurry, rotated, cut off, or in another language — do your best, set fields you can't read to null, and lower the confidence score accordingly. 'total' is the grand total the customer paid. Pick a category like Groceries, Dining, Shopping, Transport, etc.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
    },
  });

  try {
    const parsed = JSON.parse(resp.text ?? "{}");
    return {
      merchant: parsed.merchant ?? null,
      date: parsed.date ?? null,
      total: parsed.total ?? null,
      currency: parsed.currency ?? null,
      category: parsed.category ?? null,
      lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      notes: parsed.notes ?? null,
    };
  } catch {
    return {
      merchant: null,
      date: null,
      total: null,
      currency: null,
      category: null,
      lineItems: [],
      confidence: 0,
      notes: "Could not parse the receipt. Please enter the details manually.",
    };
  }
}
