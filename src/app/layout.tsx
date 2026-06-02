import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lumen — talk to your money",
  description: "An AI-driven personal finance companion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const body = (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body>
        <div className="aurora" aria-hidden />
        {children}
      </body>
    </html>
  );

  // Only mount ClerkProvider when keys exist; otherwise the app runs in DEV mode.
  return clerkEnabled() ? <ClerkProvider>{body}</ClerkProvider> : body;
}
