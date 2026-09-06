import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DevBar } from "@/components/dev-bar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export const metadata: Metadata = {
  title: {
    default: `${PLATFORM} — Consent-first AI endorsements`,
    template: `%s — ${PLATFORM}`,
  },
  description:
    "The consent-and-rights rails for India's synthetic-endorsement economy. Verified consent, machine-enforced usage rules, C2PA provenance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.NEXT_PUBLIC_DEV_OPEN === "1" && <DevBar />}
      </body>
    </html>
  );
}
