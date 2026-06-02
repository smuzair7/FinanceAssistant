import { getGemini, type ModelId } from "./gemini";
import { prisma } from "./db";
import { TOOLS, toolDeclarations, type ToolContext } from "./tools";

// ---------------------------------------------------------------------------
// The agent loop: a bounded tool-calling cycle. The model decides which SQL
// tools to call, we execute them, feed results back, and repeat until it has
// enough to answer (or we hit the step cap). This is the "multi-step / agentic
// reasoning" surface — it gathers what it needs and recovers from tool errors
// instead of being told an exact sequence.
// ---------------------------------------------------------------------------

const MAX_STEPS = 6;

export interface AgentInput {
  userId: string;
  currency: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  model: ModelId;
}

export interface AgentResult {
  text: string;
  toolsUsed: string[];
}

async function buildSystemPrompt(userId: string, currency: string): Promise<string> {
  const facts = await prisma.userFact.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  const today = new Date().toISOString().slice(0, 10);

  const memory = facts.length
    ? facts.map((f) => `- ${f.rawText} (${f.key}=${f.value})`).join("\n")
    : "- (none yet)";

  return [
    "You are a personal finance assistant. You help one user understand and manage their money.",
    `Today's date is ${today}. The user's primary currency is ${currency}.`,
    "",
    "RULES:",
    "- Every number you state about the user's finances MUST come from a tool call. Never estimate or invent figures.",
    "- Translate vague time references (last month, March, this year) into concrete YYYY-MM-DD ranges before calling tools.",
    "- If a question is ambiguous, ask one short clarifying question instead of guessing.",
    "- If the data genuinely cannot answer the question, say so plainly — do not fabricate.",
    "- When the user states a durable preference or fact about themselves, call set_memory so it persists.",
    "- Be concise and concrete. Show key figures. Use the user's currency.",
    "",
    "KNOWN USER CONTEXT (apply this):",
    memory,
  ].join("\n");
}

function toGeminiHistory(history: AgentInput["history"]) {
  return history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const ai = getGemini();
  const ctx: ToolContext = { userId: input.userId, currency: input.currency };
  const systemInstruction = await buildSystemPrompt(input.userId, input.currency);
  const toolsUsed: string[] = [];

  const contents: any[] = [
    ...toGeminiHistory(input.history),
    { role: "user", parts: [{ text: input.message }] },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await ai.models.generateContent({
      model: input.model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
        tools: [{ functionDeclarations: toolDeclarations() }],
      },
    });

    const calls = resp.functionCalls ?? [];
    if (calls.length === 0) {
      return { text: resp.text ?? "I'm not sure how to help with that.", toolsUsed };
    }

    // Record the model's tool-call turn verbatim so the conversation stays valid.
    const modelParts = resp.candidates?.[0]?.content?.parts ?? [];
    contents.push({ role: "model", parts: modelParts });

    // Execute each requested tool; a failure becomes a structured error the
    // model can recover from rather than a crash.
    const responseParts: any[] = [];
    for (const call of calls) {
      const name = call.name as string;
      toolsUsed.push(name);
      const tool = TOOLS[name];
      let result: unknown;
      if (!tool) {
        result = { error: `Unknown tool: ${name}` };
      } else {
        try {
          result = await tool.execute(ctx, (call.args as Record<string, unknown>) ?? {});
        } catch (e) {
          result = { error: e instanceof Error ? e.message : "Tool failed" };
        }
      }
      responseParts.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  // Hit the step cap — make one last call without tools to force an answer.
  const final = await ai.models.generateContent({
    model: input.model,
    contents: [
      ...contents,
      {
        role: "user",
        parts: [
          { text: "Summarise what you found for the user now, using the data already gathered." },
        ],
      },
    ],
    config: { systemInstruction, temperature: 0.3 },
  });
  return { text: final.text ?? "I gathered some data but couldn't finalise an answer.", toolsUsed };
}
