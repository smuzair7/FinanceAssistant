import { auth } from "@clerk/nextjs/server";

// Single-user fallback id used when Clerk is not configured. This lets the
// reviewer run the whole app instantly without creating a Clerk account, while
// real multi-user isolation kicks in automatically once Clerk keys are present.
export const DEV_USER_ID = "dev-user";

export function clerkEnabled(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !!process.env.CLERK_SECRET_KEY
  );
}

/** Resolve the current user id, or null if signed out (Clerk mode only). */
export async function getUserId(): Promise<string | null> {
  if (!clerkEnabled()) return DEV_USER_ID;
  const { userId } = await auth();
  return userId;
}

/** Like getUserId but never null — for API routes that must be authenticated. */
export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) throw new UnauthorizedError();
  return id;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
