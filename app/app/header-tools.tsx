"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentContext } from "@/lib/api/v1/contract";

import { shownRaw, USDC_MINT, usdcFigure } from "./wallet-view-model";
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
  if (pathname === "/app/activity" || pathname.startsWith("/app/receipts") || pathname === "/app/fees") return { kind: "page", page: "activity" };
  if (pathname === "/app/spot") return { kind: "page", page: "spot" };
  if (pathname === "/app/swap") return { kind: "page", page: "swap" };
  if (pathname.startsWith("/app/stocks/")) return { kind: "page", page: "stocks" };
  if (pathname === "/app/markets") return { kind: "page", page: "trends" };
  if (pathname.startsWith("/app/bots") || pathname.startsWith("/app/strategies")) return { kind: "page", page: "strategies" };
  return null;
}

/**
 * The USDC the connected wallet holds, for the core's header (B1): the balance is shown there and on Home, nowhere
 * else. Unknown is not zero: a read that failed, or a partial read with no USDC in it, shows no figure; a complete
 * read with no USDC is «0.00». While the wallet is being read the header draws a skeleton of the same size.
 */
export function useUsdcBalance(locale: WorkspaceLocale): Readonly<{ value: string | null; loading: boolean }> {
  const { owner, holdings } = useWalletData();
  if (owner === null) return { value: null, loading: false };
  if (holdings.status === "loading" || holdings.status === "idle") return { value: null, loading: true };
  if (holdings.status !== "ready") return { value: null, loading: false };
  const usdc = holdings.data.find((holding) => holding.mint === USDC_MINT);
  if (usdc) return { value: usdcFigure(shownRaw(usdc), usdc.decimals, locale), loading: false };
  return { value: holdings.complete ? usdcFigure(0n, 6, locale) : null, loading: false };
}
