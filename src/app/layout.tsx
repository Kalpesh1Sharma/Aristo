import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MarginGhost — Supplier Invoice Investigation", description: "Find the money hidden in supplier invoices. Compare invoices against contracts and purchase orders with source cited evidence." };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>}
