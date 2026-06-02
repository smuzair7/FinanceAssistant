import { GoogleGenAI } from "@google/genai";

// Model tiers — the core of the cost/latency routing story.
//  - LITE  : router classification + simple single-lookup narration (cheapest)
//  - FAST  : the default agent loop, receipt vision, grounded web lookups
//  - PRO   : open-ended reasoning that benefits from depth (summaries, advice)
export const MODELS = {
  LITE: "gemini-2.5-flash-lite",
  FAST: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export function geminiEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!geminiEnabled()) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env to enable the assistant.",
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}
