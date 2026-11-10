import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDX SWRT Engine — Multi-Agent Quantitative Decision & Forensic Audit Dashboard",
  description:
    "100% Free ($0/month), Local-First, Auditable Multi-Agent Quantitative Decision Engine for the Indonesia Stock Exchange (IDX / BEI).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#030712] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
