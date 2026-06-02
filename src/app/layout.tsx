import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Assistant",
  description: "An AI-driven personal finance companion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const body = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );

  // Only mount ClerkProvider when keys exist; otherwise the app runs in DEV mode.
  return clerkEnabled() ? <ClerkProvider>{body}</ClerkProvider> : body;
}
