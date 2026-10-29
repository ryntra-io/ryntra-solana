/**
 * The token's risk in one line by «Купити» (SOL-C12, UX-151, UX-156): the facts a person reads before an order, without
 * a verdict — whether Jupiter verified the address, whether the issuer can still mint or freeze, how deep the market
 * is, how much the ten largest holders hold, how many holders there are and how old the market is. The same figures as the strip and the
 * «Ризик» panel, from the one market read; a figure not read is left out rather than said as a zero.
 *
 * SOL is the network's own coin, USDC and USDT are the dollars the page quotes in, a tokenized stock carries its issuer's line and its deadline (SOL-C4), and a token
 * Ryntra no longer supports carries its state: none of them has this line.
 *
 * Pure.
 */

import { isUnsupportedMarket, marketAgeDays, type SpotMarket } from "../../../../lib/spot/markets.ts";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
/* The dollars Ryntra quotes in: their issuers keep the right to freeze by design, and no one buys them for their risk. */
const DOLLAR_MINTS: ReadonlySet<string> = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

export type RiskFact =
  | Readonly<{ kind: "flagged" }>
  | Readonly<{ kind: "unverified" }>
  | Readonly<{ kind: "mint-on" }>
  | Readonly<{ kind: "freeze-on" }>
  | Readonly<{ kind: "liquidity"; usd: number }>
  | Readonly<{ kind: "top"; pct: number }>
  | Readonly<{ kind: "holders"; count: number }>
  | Readonly<{ kind: "age"; days: number }>;

/** Whether a fact is one to read twice: it stands in the caution colour, the rest in the line's own. */
export function cautionFact(fact: RiskFact): boolean {
  return fact.kind === "flagged" || fact.kind === "unverified" || fact.kind === "mint-on" || fact.kind === "freeze-on";
}

type RiskMarket = Pick<SpotMarket, "mint" | "verified" | "category" | "issuer" | "holders" | "firstPoolAt" | "audit" | "liquidityUsd">;

/** The facts of the line, in the order a person reads them: who checked it, what the issuer can still do, who holds it. */
export function riskFactsOf(market: RiskMarket | null, now: number): readonly RiskFact[] {
  if (!market || market.mint === WRAPPED_SOL_MINT || DOLLAR_MINTS.has(market.mint) || market.category === "stock" || isUnsupportedMarket(market)) return [];
  const facts: RiskFact[] = [];
  if (market.audit.suspicious) facts.push({ kind: "flagged" });
  else if (!market.verified) facts.push({ kind: "unverified" });
  if (market.audit.mintAuthorityDisabled === false) facts.push({ kind: "mint-on" });
  if (market.audit.freezeAuthorityDisabled === false) facts.push({ kind: "freeze-on" });
  if (market.liquidityUsd !== null && Number.isFinite(market.liquidityUsd)) facts.push({ kind: "liquidity", usd: market.liquidityUsd });
  const top = market.audit.topHoldersPct;
  if (top !== null && Number.isFinite(top)) facts.push({ kind: "top", pct: top });
  if (market.holders !== null && Number.isFinite(market.holders)) facts.push({ kind: "holders", count: market.holders });
  const days = marketAgeDays(market, now);
  if (days !== null) facts.push({ kind: "age", days });
  return facts;
}
