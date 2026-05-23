import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VerseLink — AI Bible Study Companion",
  description:
    "Ask what Scripture says about anything. Get semantically relevant verses, not keyword matches.",
  verification: {
    google: "6JGECuWsdfThE86hJoBqlRIrSpSzmoUx5PoAoi6uYr0",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${geist.className} min-h-full bg-stone-50 text-stone-900 antialiased`}>
        <nav className="border-b border-stone-200 bg-white px-6 py-3 flex items-center gap-6">
          <a href="/" className="text-lg font-semibold tracking-tight text-stone-800">
            VerseLink
          </a>
          <a href="/ask" className="text-sm text-stone-500 hover:text-stone-800">
            Ask
          </a>
          <a href="/bible/john/1" className="text-sm text-stone-500 hover:text-stone-800">
            Browse Bible
          </a>
          <a href="/topics" className="text-sm text-stone-500 hover:text-stone-800">
            Topics
          </a>
          <a href="/search" className="text-sm text-stone-500 hover:text-stone-800">
            Search
          </a>
          <a href="/evals" className="text-sm text-stone-500 hover:text-stone-800">
            Evals
          </a>
        </nav>
        <div className="px-6 py-10">{children}</div>
      </body>
    </html>
  );
}
