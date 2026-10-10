import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MarginGhost — Supplier Recovery Agent", description: "Evidence-first supplier invoice auditing" };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>}
