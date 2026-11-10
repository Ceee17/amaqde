"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CheckCircle2, History, TrendingUp, Zap } from "lucide-react";

export default function TopNavBar() {
  const pathname = usePathname() || "/";

  const navLinks = [
    {
      href: "/",
      label: "Trade Decision",
      sublabel: "1 Unified Plan",
      icon: TrendingUp,
    },
    {
      href: "/agents",
      label: "AI Team & Models",
      sublabel: "OAuth & Quotas",
      icon: Bot,
    },
    {
      href: "/history",
      label: "Saved History",
      sublabel: "Past Stocks",
      icon: History,
    },
  ];

  return (
    <nav className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl px-5 py-3.5 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      {/* Brand Title */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <BarChart3 className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base sm:text-lg font-extrabold tracking-tight text-white">
              IDX Smart Trade Advisor
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Indonesia Stock Exchange (BEI)
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Simple, One-Click Stock Analysis &bull; Manual Execution Plan (Read-Only Safety)
          </p>
        </div>
      </div>

      {/* Multi-Page Navigation Links */}
      <div className="flex flex-wrap items-center gap-2">
        {navLinks.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
                isActive
                  ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-950/50 font-bold"
                  : "bg-slate-950/80 hover:bg-slate-800 text-slate-200 border-slate-800"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <div className="text-left">
                <div className="leading-none">{item.label}</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    isActive ? "text-slate-900 font-medium" : "text-slate-400"
                  }`}
                >
                  {item.sublabel}
                </div>
              </div>
            </Link>
          );
        })}

        <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-950/70 border border-amber-500/30 text-xs font-medium text-amber-200 ml-1">
          <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Rust Engine Active (&lt;1ms)</span>
        </div>

        <div className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-950/70 border border-indigo-500/30 text-xs font-medium text-indigo-200 ml-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Antigravity OAuth Active</span>
        </div>
      </div>
    </nav>
  );
}
