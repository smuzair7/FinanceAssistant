"use client";

import { useEffect, useRef, useState } from "react";

interface Meta {
  model?: string;
  tier?: string;
  reason?: string;
  toolsUsed?: string[];
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: Meta | null;
}

interface ReceiptDraft {
  merchant: string;
  date: string;
  total: string;
  currency: string;
  category: string;
  confidence: number;
  notes: string | null;
}

const TIER_STYLE: Record<string, string> = {
  simple: "bg-emerald-100 text-emerald-700",
  balanced: "bg-sky-100 text-sky-700",
  complex: "bg-violet-100 text-violet-700",
  disabled: "bg-slate-100 text-slate-500",
};

const SUGGESTIONS = [
  "How much did I spend on groceries last month?",
  "What recurring subscriptions do I have?",
  "Any unusual activity recently?",
  "Am I spending more than usual this month?",
  "Where can I cut back?",
];

export default function Chat({ onDataChanged }: { onDataChanged?: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages)) {
          setMessages(
            d.messages.map((m: any) => ({
              ...m,
              meta: m.meta ? JSON.parse(m.meta) : null,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, draft]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.text ?? data.error ?? "Something went wrong.",
          meta: data.meta,
        },
      ]);
      onDataChanged?.();
    } catch {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: `📎 Uploaded receipt: ${file.name}` }]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/receipt", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) {
        setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: `Couldn't read that receipt: ${data.error}` }]);
        return;
      }
      const ex = data.extracted;
      setDraft({
        merchant: ex.merchant ?? "",
        date: ex.date ?? new Date().toISOString().slice(0, 10),
        total: ex.total != null ? String(ex.total) : "",
        currency: ex.currency ?? "USD",
        category: ex.category ?? "",
        confidence: ex.confidence ?? 0,
        notes: ex.notes ?? null,
      });
    } catch {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", content: "Failed to upload the receipt." }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmReceipt() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/receipt/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchant: draft.merchant,
          date: draft.date,
          total: Number(draft.total),
          currency: draft.currency,
          category: draft.category || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: `Recorded ${draft.merchant} for ${draft.currency} ${draft.total} on ${draft.date}.` }]);
        onDataChanged?.();
      } else {
        setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: `Could not save: ${data.error}` }]);
      }
    } finally {
      setDraft(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3.5 border-b border-white/60 bg-white/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <h2 className="font-display font-semibold text-slate-800">Assistant</h2>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">Ask about your money, or upload a receipt.</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4">
        {messages.length === 0 && !draft && (
          <div className="text-sm text-slate-500 space-y-3 fade-up">
            <p className="text-slate-400">Try asking…</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="chip text-left">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`fade-up ${m.role === "user" ? "text-right" : "text-left"}`}>
            <div
              className={`inline-block max-w-[88%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "text-white rounded-br-md shadow-lg shadow-indigo-500/20"
                  : "bg-white/80 border border-white/70 text-slate-800 rounded-bl-md backdrop-blur shadow-sm"
              }`}
              style={
                m.role === "user"
                  ? { backgroundImage: "linear-gradient(135deg,#7c3aed,#4f46e5 60%,#2563eb)" }
                  : undefined
              }
            >
              {m.content}
            </div>
            {m.role === "assistant" && m.meta && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 items-center text-[11px]">
                {m.meta.tier && (
                  <span className={`rounded-md px-1.5 py-0.5 font-medium ${TIER_STYLE[m.meta.tier] ?? "bg-slate-100 text-slate-500"}`}>
                    {m.meta.tier} · {m.meta.model}
                  </span>
                )}
                {m.meta.toolsUsed && m.meta.toolsUsed.length > 0 && (
                  <span className="rounded-md bg-slate-100 text-slate-500 px-1.5 py-0.5">
                    🔧 {m.meta.toolsUsed.join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {draft && (
          <div className="card border-amber-200/80 bg-amber-50/80 p-4 text-sm fade-up">
            <p className="font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
              <span>🧾</span> Confirm this receipt
            </p>
            {draft.confidence < 0.7 && (
              <p className="text-xs text-amber-700 mb-2">
                Low confidence ({Math.round(draft.confidence * 100)}%){draft.notes ? ` — ${draft.notes}` : ""}. Please check the details.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">Merchant
                <input className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5" value={draft.merchant} onChange={(e) => setDraft({ ...draft, merchant: e.target.value })} />
              </label>
              <label className="text-xs text-slate-600">Total
                <input className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 tnum" value={draft.total} onChange={(e) => setDraft({ ...draft, total: e.target.value })} />
              </label>
              <label className="text-xs text-slate-600">Date
                <input className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 tnum" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label className="text-xs text-slate-600">Category
                <input className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={confirmReceipt} disabled={busy} className="btn-grad px-3.5 py-1.5 text-xs">
                Save expense
              </button>
              <button onClick={() => setDraft(null)} className="btn-ghost px-3.5 py-1.5 text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-1 text-slate-400 text-sm">
            <span className="dot">•</span>
            <span className="dot" style={{ animationDelay: "0.2s" }}>•</span>
            <span className="dot" style={{ animationDelay: "0.4s" }}>•</span>
          </div>
        )}
      </div>

      <div className="border-t border-white/60 bg-white/40 backdrop-blur p-3">
        <div className="flex gap-2 items-end">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
          <button
            onClick={() => fileRef.current?.click()}
            title="Upload receipt"
            className="btn-ghost h-10 w-10 text-lg shrink-0"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about your finances…"
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300/60 focus:border-indigo-300"
          />
          <button onClick={() => send(input)} disabled={busy} className="btn-grad px-4 py-2.5 text-sm shrink-0">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
