import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId, clerkEnabled } from "@/lib/auth";

const FEATURES = [
  "Ask in plain English",
  "Scan receipts",
  "Spot forgotten subscriptions",
  "Catch unusual charges",
];

export default async function Home() {
  const userId = await getUserId();
  // In Clerk mode, a signed-in user skips the marketing page. In demo mode there
  // is always a user, so we still show the landing as a welcome screen.
  if (clerkEnabled() && userId) redirect("/dashboard");

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl text-center fade-up">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="brand-mark h-9 w-9 rounded-xl grid place-items-center text-white font-bold">
            L
          </div>
          <span className="font-display text-xl font-semibold text-slate-900">Lumen</span>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-indigo-700 backdrop-blur mb-7">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          AI personal finance assistant
        </div>

        <h1 className="font-display text-5xl sm:text-6xl font-bold leading-[1.05] text-slate-900">
          Talk to your <span className="gradient-text">money.</span>
        </h1>

        <p className="mt-5 text-lg text-slate-600 max-w-xl mx-auto leading-relaxed">
          Connect your transactions and just ask. Lumen reasons over years of
          history — spending, subscriptions, unusual charges, budgets, receipts —
          and answers in seconds.
        </p>

        <div className="mt-9 flex flex-wrap gap-3 justify-center">
          {clerkEnabled() ? (
            <>
              <Link href="/sign-in" className="btn-grad px-6 py-3 text-[15px]">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn-ghost px-6 py-3 text-[15px]">
                Create account
              </Link>
            </>
          ) : (
            <Link href="/dashboard" className="btn-grad px-7 py-3 text-[15px]">
              Open the demo
              <span className="ml-2">→</span>
            </Link>
          )}
        </div>

        <div className="mt-12 flex flex-wrap gap-2 justify-center">
          {FEATURES.map((f) => (
            <span
              key={f}
              className="rounded-full border border-slate-200/70 bg-white/60 px-3.5 py-1.5 text-sm text-slate-600 backdrop-blur"
            >
              {f}
            </span>
          ))}
        </div>

        {!clerkEnabled() && (
          <p className="mt-10 text-xs text-slate-400">
            Running in single-user demo mode — no sign-in required.
          </p>
        )}
      </div>
    </main>
  );
}
