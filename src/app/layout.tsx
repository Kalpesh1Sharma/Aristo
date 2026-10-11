import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MarginGhost — Supplier Invoice Investigation", description: "Find the money hidden in supplier invoices. Compare invoices against contracts and purchase orders with source cited evidence." };
const themeInit = `(function(){try{var t=localStorage.getItem('mg-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}})()`;
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeInit}} /></head><body>{children}</body></html>}
