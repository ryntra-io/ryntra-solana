"use client";

import { PlusCircle, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { ASSISTANT } from "@/app/shell/domains";
import type { AgentContext } from "@/lib/api/v1/contract";
import { rynHref } from "@/lib/agent/context";

import { usdValueIn, walletValue } from "./wallet-view-model";
import { useWalletData } from "./wallet-data";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLAN = /^\/app\/strategies\/plans\/([A-Za-z0-9_-]{4,64})$/;

/**
 * The screen a question is asked about, as the assistant's context: the token
 * open in Spot, on a launch's page or in its passport; the plan open in the
 * builder's record; the person's portfolio; else the page itself where the
 * assistant knows it. Null where the screen has nothing to say about itself.
 */
export function screenContext(pathname: string, params: Pick<URLSearchParams, "get">): AgentContext | null {
  const mint = params.get("mint");
  if ((pathname === "/app/spot" || pathname === "/app/assets") && mint && BASE58.test(mint)) return { kind: "asset", mint };
  const launch = /^\/app\/launch\/([^/]+)$/.exec(pathname);
  if (launch && BASE58.test(launch[1])) return { kind: "asset", mint: launch[1] };
  const plan = PLAN.exec(pathname);
  if (plan) return { kind: "plan", planId: plan[1] };
  if (pathname === "/app/portfolio") return { kind: "portfolio" };
  if (pathname === "/app/activity" || pathname.startsWith("/app/receipts")) return { kind: "page", page: "activity" };
  if (pathname === "/app/spot") return { kind: "page", page: "spot" };
  if (pathname === "/app/swap") return { kind: "page", page: "swap" };
  if (pathname.startsWith("/app/stocks/")) return { kind: "page", page: "stocks" };
  if (pathname === "/app/markets") return { kind: "page", page: "trends" };
  if (pathname.startsWith("/app/bots") || pathname.startsWith("/app/strategies")) return { kind: "page", page: "strategies" };
  return null;
}

/** «Спитати Ryntra» — the assistant on every screen, with the screen as its context. */
export function AskRyntraButton({ locale }: { locale: WorkspaceLocale }) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  if (pathname === ASSISTANT.href) return null;
  const href = rynHref(screenContext(pathname, params ?? new URLSearchParams()));
  const label = ASSISTANT.ask[locale];
  return (
    <Link className="ry-ask" href={href} prefetch={false} aria-label={label} title={label}>
      <Sparkle size={16} weight="bold" aria-hidden="true" />
      <span className="ry-ask-label">{label}</span>
    </Link>
  );
}

/**
 * Beside the wallet: what it holds, when every token in it is read and
 * priced, and «Поповнити». A wallet read in part, or holding a token the
 * catalogue does not price, shows no sum — a partial figure is not the
 * balance, and unknown is not $0.
 */
export function WalletBalance({ locale }: { locale: WorkspaceLocale }) {
  const { owner, holdings } = useWalletData();
  const known = owner !== null && holdings.status === "ready" && holdings.complete;
  const total = known ? walletValue(holdings.data) : null;
  const topUp = locale === "uk" ? "Поповнити" : "Top up";
  return (
    <div className="ry-balance">
      {total && total.unpriced === 0 && total.priced > 0 ? (
        <Link className="ry-balance-sum" href="/app/portfolio" prefetch={false} translate="no" title={locale === "uk" ? "Баланс гаманця" : "Wallet balance"}>
          {usdValueIn(total.total, locale)}
        </Link>
      ) : null}
      <Link className="ry-balance-topup" href="/app/top-up" prefetch={false}>
        <PlusCircle size={16} weight="bold" aria-hidden="true" />
        <span>{topUp}</span>
      </Link>
    </div>
  );
}
