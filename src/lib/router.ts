import { getGemini, MODELS, type ModelId } from "./gemini";

// ---------------------------------------------------------------------------
// Request router / model selection.
//
// The brief's constraints (fast + economical) pull against quality. We resolve
// that by matching effort to the task instead of sending everything to the most
// expensive model:
//   - obvious lookups            -> flash-lite  (cheap, instant)
//   - open-ended reasoning/advice -> pro         (depth where it pays off)
//   - everything else            -> flash        (the balanced default)
//
// A keyword fast-path handles the clear-cut cases with zero extra latency; only
// genuinely ambiguous messages cost one tiny flash-lite classification call.
// ---------------------------------------------------------------------------

export interface Route {
  model: ModelId;
  tier: "simple" | "balanced" | "complex";
  reason: string;
}

const SIMPLE = /\b(how much|how many|what (was|is) my|biggest|largest|list|show|total|balance|spent on|when did)\b/i;
const COMPLEX = /\b(summar|cut back|save money|advice|recommend|why|explain|more than usual|trend|compare|unusual|forecast|should i|analy)\b/i;

export function heuristicRoute(message: string): Route | null {
  if (COMPLEX.test(message))
    return { model: MODELS.PRO, tier: "complex", reason: "reasoning-heavy (keyword)" };
  if (SIMPLE.test(message))
    return { model: MODELS.LITE, tier: "simple", reason: "simple lookup (keyword)" };
  return null;
}

export async function routeMessage(message: string): Promise<Route> {
  const fast = heuristicRoute(message);
  if (fast) return fast;

  // Ambiguous — spend one cheap classification call rather than guessing.
  try {
    const ai = getGemini();
    const resp = await ai.models.generateContent({
      model: MODELS.LITE,
      contents: `Classify this personal-finance request by effort needed. Reply with ONE word: "simple" (a direct lookup of a number), "complex" (open-ended reasoning, advice, summaries, or comparisons), or "balanced" (anything else).\n\nRequest: "${message}"`,
      config: { temperature: 0, maxOutputTokens: 5 },
    });
    const word = (resp.text ?? "").toLowerCase();
    if (word.includes("simple"))
      return { model: MODELS.LITE, tier: "simple", reason: "classified simple" };
    if (word.includes("complex"))
      return { model: MODELS.PRO, tier: "complex", reason: "classified complex" };
  } catch {
    // fall through to the safe default
  }
  return { model: MODELS.FAST, tier: "balanced", reason: "default balanced" };
}
