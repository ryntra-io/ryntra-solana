import { PLAN_ID, RULE_ID, type ExecutionPlanBinding, type RuleBinding } from "@/lib/api/v1/contract";
import { isSpotView, type SpotView } from "@/lib/spot/markets";
import { quickSum } from "@/lib/spot/quick-trade";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchRecordedHere } from "@/lib/launch/recorded.server";

import { solanaServerText } from "../i18n/server.ts";
import { SpotWorkspace } from "./spot-workspace.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Spot") };
}

/**
 * Spot — the trading workspace.
 *
 * One page inside TRADE. Crypto, Memes and Stocks/RWA are categories inside
 * it, never pages of their own. `?mint=` opens a market directly and
 * `?view=` a category, so a market can be shared as a link; anything else in
 * the address opens the default market rather than an error. `?plan=&v=`
 * opens the ticket under a Trading Plan and its version: a reference the
 * server judges for the proven wallet, never a proof of anything; a malformed
 * one is simply not a plan. `?side=&amount=` carry the side and the sum a
 * person chose on an asset page into the ticket once — the quote is asked
 * again here, nothing is carried but the intent, and the address forgets
 * them on arrival so a reload does not re-type them. `?rule=&due=` (1.31.0)
 * opens the ticket as a rule's purchase — a token's reminder lands here — a
 * reference the server judges for the proven wallet, never permission.
 * `?buy=` is a quick sum tapped on a Pulse card: it goes into the ticket as
 * the ticket's own quick sums do, and the exact Review opens on it once the
 * wallet is read — the tap never signs, and the address forgets it.
 */
export default async function SpotPage({ searchParams }: { searchParams: Promise<{ mint?: string; view?: string; plan?: string; v?: string; side?: string; amount?: string; rule?: string; due?: string; buy?: string }> }) {
  const params = await searchParams;
  const mint = params.mint && MINT_SHAPE.test(params.mint) ? params.mint : null;
  const view: SpotView | null = isSpotView(params.view) ? params.view : null;
  const version = params.v && /^[1-9][0-9]{0,3}$/.test(params.v) ? Number(params.v) : null;
  const plan: ExecutionPlanBinding | null = params.plan && PLAN_ID.test(params.plan) && version !== null ? { planId: params.plan, version } : null;
  const side = params.side === "buy" ? "BUY" : params.side === "sell" ? "SELL" : null;
  /* A plain positive decimal, up to nine whole digits and six places; anything else is not an amount. */
  const amount = mint && params.amount && /^\d{1,9}(\.\d{1,6})?$/.test(params.amount) && Number(params.amount) > 0 ? params.amount : null;
  /* A rule's reminder: a well-formed rule id and an instant, or nothing. */
  const dueMs = params.due ? Date.parse(params.due) : Number.NaN;
  const rule: RuleBinding | null = mint && params.rule && RULE_ID.test(params.rule) && Number.isFinite(dueMs) ? { ruleId: params.rule, dueAt: new Date(dueMs).toISOString() } : null;
  const quickUsd = mint && params.buy ? quickSum(params.buy) : null;
  /* A token launched on Ryntra: its launch page is its own, and the header leads there — one read of Ryntra's record,
     never the chain, beside the page's words and cut off after a moment: Spot never waits on the store for a line. */
  const [launched, { text }] = await Promise.all([mint ? launchedHere(mint) : false, solanaServerText()]);
  /* The section's tab «Спот» above already names the page; the title stays for a screen reader and gives its
     line on a laptop to the chart. */
  return (
    <>
      <h1 className="sr-only">{text("Spot")}</h1>
      <SpotWorkspace initialMint={mint} initialView={view} initialPlan={plan} initialSide={side} initialAmount={amount} initialRule={rule} initialQuickUsd={side === "SELL" ? null : quickUsd} launchMint={launched ? mint : null} />
    </>
  );
}

const LAUNCH_READ_MS = 300;

async function launchedHere(mint: string): Promise<boolean> {
  try {
    const network = launchNetwork();
    if (!network) return false;
    const read = launchRecordedHere(getGuardRuntime().store, network.cluster, mint).catch(() => false);
    return await Promise.race([read, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LAUNCH_READ_MS))]);
  } catch {
    return false;
  }
}
