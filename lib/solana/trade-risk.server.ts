/**
 * The risk verdict as a trade route builds it: read the token's chain facts
 * from the market-data gateway, state the facts this product holds itself —
 * whether an issuer stands behind the token, what the trade is allowed to
 * spend — and hand the whole to the engine (`trade-risk.ts`), which does the
 * judging and never reads anything.
 *
 * One entry per kind of trade, so a Review is never assembled twice from two
 * readings of the same thing: `swapTradeRisk` for a swap, and
 * `tradeRiskVerdict` for the kinds whose evidence comes from their own venue.
 *
 * Until the gateway image carrying `/v1/risk` is deployed, every reading here
 * comes back `NOT_READ` with that reason in those words, and every verdict is
 * `INCOMPLETE` — which is the honest state of this deployment, not a defect to
 * paper over.
 *
 * Server only. It reads, and it signs nothing.
 */

import { lifecycleEventFor, LIFECYCLE_EVENTS_VERSION } from "../stocks/lifecycle-events.ts";
import { eventStateAt } from "../stocks/instrument.ts";
import { isRetiredMint, RETIRED_REASON } from "../stocks/retired.ts";
import type { SolanaPolicyVerdict } from "./contracts.ts";
import type { JupiterOrderQuote } from "./quotes.ts";
import { readTokenRiskFacts, type TokenRiskReading } from "./risk-facts.ts";
import {
  evaluateTradeRisk,
  type TradeKind,
  type TradeRiskBudget,
  type TradeRiskPath,
  type TradeRiskQuote,
  type TradeRiskRwa,
  type TradeRiskSlippage,
  type TradeRiskSource,
  type TradeRiskNetwork,
  type TradeRiskVenue,
  type TradeRiskVerdict,
} from "./trade-risk.ts";

const source = (ref: string, label: string, readAt: Date, slot: number | null = null): TradeRiskSource => ({
  ref,
  label,
  readAt: readAt.toISOString(),
  slot,
});

/**
 * Whether an issuer's own terms govern this token, from Ryntra's own registry
 * of issuer events and withdrawn tokens — the same two lists the quote routes
 * refuse on, read here as a fact with its version on it rather than as a
 * second opinion about them.
 */
export function rwaEligibilityOf(mint: string, now: Date = new Date()): TradeRiskRwa {
  const at = source("ryntra.stocks.lifecycle-events", `Ryntra · issuer events and withdrawn tokens (${LIFECYCLE_EVENTS_VERSION})`, now);
  if (isRetiredMint(mint)) {
    return { state: "NOT_OFFERED", detail: `Ryntra no longer offers this token on either side. ${RETIRED_REASON}`, source: at };
  }
  const event = lifecycleEventFor(mint);
  if (!event) {
    return {
      state: "NOT_A_REAL_WORLD_ASSET",
      detail: "Ryntra's registry records no issuer event and no withdrawal for this mint, so no issuer's own window governs this trade.",
      source: at,
    };
  }
  const state = eventStateAt(event, now.getTime());
  return state === "conversion-open"
    ? { state: "OFFERED", detail: `The issuer's window for this token is open. ${event.note}`, source: at }
    : { state: "ISSUER_WINDOW_CLOSED", detail: `The issuer's window for this token reads as ${state}. ${event.note}`, source: at };
}

/**
 * What a trade a person makes by hand is allowed to spend. The month's ceiling
 * in Ryntra is the ceiling for purchases a saved rule makes without being
 * asked again; a trade signed here and now is not one of those, and saying so
 * is a fact about which limit applies — not a claim that no limit was looked
 * for.
 */
export function manualTradeBudget(now: Date = new Date()): TradeRiskBudget {
  return {
    state: "NOT_UNDER_A_LIMIT",
    detail:
      "This trade is made by hand and signed by you, not by a saved rule, so the month's ceiling for rules' purchases does not govern it.",
    source: source("ryntra.autoinvest-budget", "Ryntra · the month's ceiling for rules' purchases", now),
  };
}

/**
 * One trade's verdict. The caller brings what its own venue knows — the price
 * bound, the route, the quote's time, the venue's state — and this reads the
 * token's chain facts beside it.
 */
export async function tradeRiskVerdict(
  args: Readonly<{
    trade: Readonly<{ kind: TradeKind; network: TradeRiskNetwork; mint: string }>;
    assetReview?: SolanaPolicyVerdict | null;
    slippage: TradeRiskSlippage | null;
    path: TradeRiskPath | null;
    quote: TradeRiskQuote | null;
    venue: TradeRiskVenue | null;
    /** Omitted means a trade made by hand; a rule's purchase passes its own reading. */
    budget?: TradeRiskBudget | null;
    /** Omitted means read from Ryntra's own issuer registry for this mint. */
    rwa?: TradeRiskRwa | null;
    chain?: TokenRiskReading;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
    now?: Date;
  }>,
): Promise<TradeRiskVerdict> {
  const now = args.now ?? new Date();
  const chain =
    args.chain ??
    (await readTokenRiskFacts({
      mint: args.trade.mint,
      env: args.env,
      fetchImpl: args.fetchImpl,
      timeoutMs: args.timeoutMs,
      now: () => now,
    }));
  return evaluateTradeRisk({
    now,
    evidence: {
      trade: args.trade,
      chain,
      assetReview: args.assetReview ?? null,
      slippage: args.slippage,
      path: args.path,
      quote: args.quote,
      venue: args.venue,
      budget: args.budget === undefined ? manualTradeBudget(now) : args.budget,
      rwa: args.rwa === undefined ? rwaEligibilityOf(args.trade.mint, now) : args.rwa,
    },
  });
}

/**
 * The venue's own terms of one swap, as its quote states them. Every figure
 * comes out of the normalized order — the price bound from the least the trade
 * may receive, the route from the legs the router resolved, the time from when
 * the quote was read — so none of it is the venue's prose about itself.
 */
export function swapTradeTerms(
  order: JupiterOrderQuote,
  now: Date = new Date(),
): Readonly<{ slippage: TradeRiskSlippage; path: TradeRiskPath | null; quote: TradeRiskQuote; venue: TradeRiskVenue }> {
  const at = source(order.source.ref, order.source.label, new Date(Date.parse(order.observedAt) || now.getTime()));
  const quoted = BigInt(order.outAmountRaw);
  const minimum = BigInt(order.minReceivedRaw);
  /* The bound the chain enforces is the least the trade may receive against
     the quote, not the figure the venue labels beside it. */
  const enforcedBps = quoted > 0n ? Number(((quoted - minimum) * 10_000n) / quoted) : null;
  return {
    slippage: {
      kind: "BOUNDED",
      statedBps: order.slippageBps,
      enforcedBps,
      basis: `The quote is ${order.outAmountRaw} raw units and the least this trade may receive is ${order.minReceivedRaw}.`,
      source: at,
    },
    path:
      order.route.length > 0
        ? { hops: order.route.map((hop) => ({ label: `${hop.inAmountRaw} → ${hop.outAmountRaw}`, venue: hop.label })), source: at }
        : null,
    quote: { readAt: order.observedAt, expiresAt: order.reviewExpiresAt, source: at },
    venue: {
      id: order.provider,
      label: `Jupiter ${order.router}`,
      /* A keyless lane answers, and answers slower and less often; it is not
         the lane this product runs on, and a Review says which one it got. */
      status: order.access === "production" ? "LIVE" : "RECOVERY",
      detail:
        order.access === "production"
          ? `Priced on its keyed lane (${order.tier}), ${order.mode}.`
          : `Priced on the explicit keyless lane (${order.tier}), which is rate-limited and may answer with an older book.`,
      source: at,
    },
  };
}

/**
 * The verdict over a swap: the terms of its own quote, the chain facts of the
 * mint the person would end up holding, and — where the caller built one — the
 * review over that mint, whose refusals are folded in and named.
 */
export async function swapTradeRisk(
  args: Readonly<{
    order: JupiterOrderQuote;
    assetReview?: SolanaPolicyVerdict | null;
    now?: Date;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
    chain?: TokenRiskReading;
  }>,
): Promise<TradeRiskVerdict> {
  const now = args.now ?? new Date();
  const terms = swapTradeTerms(args.order, now);
  return tradeRiskVerdict({
    trade: { kind: "SWAP", network: "mainnet", mint: args.order.outputMint },
    assetReview: args.assetReview ?? null,
    ...terms,
    chain: args.chain,
    env: args.env,
    fetchImpl: args.fetchImpl,
    timeoutMs: args.timeoutMs,
    now,
  });
}
