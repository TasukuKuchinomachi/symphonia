import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "symphonia",
  description: "Kanban + Claude Code agent orchestration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-ink-900 text-ink-100">
        <header className="border-b border-ink-700 bg-ink-800/60 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="font-mono text-sm tracking-wider">
              <span className="text-accent-500">●</span> symphonia
            </Link>
            <span className="text-xs text-ink-400">claude-code orchestration · single user · local</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
