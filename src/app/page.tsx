import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId, clerkEnabled } from "@/lib/auth";

export default async function Home() {
  const userId = await getUserId();
  if (userId) redirect("/dashboard");

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <div className="inline-block rounded-full bg-indigo-100 text-indigo-700 px-3 py-1 text-xs font-medium mb-6">
          AI Personal Finance Assistant
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Talk to your money.
        </h1>
        <p className="mt-4 text-slate-600">
          Connect your transactions and ask anything — spending, subscriptions,
          unusual charges, budgets, receipts. The assistant reasons over years of
          history without breaking a sweat.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          {clerkEnabled() ? (
            <>
              <Link
                href="/sign-in"
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium hover:bg-white"
              >
                Create account
              </Link>
            </>
          ) : (
            <Link
              href="/dashboard"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500"
            >
              Open the demo →
            </Link>
          )}
        </div>
        {!clerkEnabled() && (
          <p className="mt-4 text-xs text-slate-400">
            Running in single-user demo mode (no Clerk keys set).
          </p>
        )}
      </div>
    </main>
  );
}
