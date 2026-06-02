import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// When Clerk is configured we run its middleware (required for auth() to work
// in server code). When it isn't, we fall back to a pass-through so the app runs
// in single-user DEV mode with no sign-in — zero setup for a quick review.
const enabled =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

export default enabled ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else + API.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp)).*)",
    "/(api|trpc)(.*)",
  ],
};
