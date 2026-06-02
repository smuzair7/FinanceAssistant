"use client";

import { useRef, useState } from "react";

export default function ImportPanel({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<Response>, label: string) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const res = await fn();
      const data = await res.json();
      if (data.error) {
        setStatus(`Error: ${data.error}`);
      } else if (typeof data.imported === "number") {
        setStatus(
          `Imported ${data.imported}, ${data.duplicates} duplicate(s), ${data.skipped} skipped.`,
        );
        onDone?.();
      } else if (typeof data.inserted === "number") {
        setStatus(`Loaded ${data.inserted} demo transactions.`);
        onDone?.();
      } else {
        setStatus("Done.");
        onDone?.();
      }
    } catch {
      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => run(() => fetch("/api/seed-demo", { method: "POST" }), "Loading demo data")}
          className="btn-grad px-3.5 py-2 text-sm"
        >
          Load demo data
        </button>
        <button
          disabled={busy}
          onClick={() => run(() => fetch("/api/bank/sync", { method: "POST" }), "Connecting bank")}
          className="btn-ghost px-3.5 py-2 text-sm disabled:opacity-50"
        >
          Connect mock bank
        </button>
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn-ghost px-3.5 py-2 text-sm disabled:opacity-50"
        >
          Upload CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const fd = new FormData();
            fd.append("file", file);
            run(() => fetch("/api/import", { method: "POST", body: fd }), "Importing CSV");
          }}
        />
      </div>
      {status && (
        <p className="text-xs text-slate-500 rounded-lg bg-slate-100/70 px-3 py-2">{status}</p>
      )}
    </div>
  );
}
