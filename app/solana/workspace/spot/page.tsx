import { PLAN_ID, type ExecutionPlanBinding } from "@/lib/api/v1/contract";
import { isSpotView, type SpotView } from "@/lib/spot/markets";

import { PageHead } from "../hub/parts.tsx";
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
 * them on arrival so a reload does not re-type them.
 */
export default async function SpotPage({ searchParams }: { searchParams: Promise<{ mint?: string; view?: string; plan?: string; v?: string; side?: string; amount?: string }> }) {
  const params = await searchParams;
  const mint = params.mint && MINT_SHAPE.test(params.mint) ? params.mint : null;
  const view: SpotView | null = isSpotView(params.view) ? params.view : null;
  const version = params.v && /^[1-9][0-9]{0,3}$/.test(params.v) ? Number(params.v) : null;
  const plan: ExecutionPlanBinding | null = params.plan && PLAN_ID.test(params.plan) && version !== null ? { planId: params.plan, version } : null;
  const side = params.side === "buy" ? "BUY" : params.side === "sell" ? "SELL" : null;
  /* A plain positive decimal, up to nine whole digits and six places; anything else is not an amount. */
  const amount = mint && params.amount && /^\d{1,9}(\.\d{1,6})?$/.test(params.amount) && Number(params.amount) > 0 ? params.amount : null;
  return (
    <>
      <PageHead title="Spot" />
      <SpotWorkspace initialMint={mint} initialView={view} initialPlan={plan} initialSide={side} initialAmount={amount} />
    </>
  );
}
