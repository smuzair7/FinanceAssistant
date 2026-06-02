import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-6">
      <div className="flex items-center gap-2.5 fade-up">
        <div className="brand-mark h-9 w-9 rounded-xl grid place-items-center text-white font-bold">
          L
        </div>
        <span className="font-display text-xl font-semibold text-slate-900">Lumen</span>
      </div>
      <SignUp />
    </main>
  );
}
