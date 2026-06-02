import { redirect } from "next/navigation";
import { getUserId, clerkEnabled } from "@/lib/auth";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const userId = await getUserId();
  if (!userId) redirect(clerkEnabled() ? "/sign-in" : "/");
  return <DashboardClient clerkOn={clerkEnabled()} />;
}
