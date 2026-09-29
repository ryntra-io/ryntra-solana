/* Canonical instrument registry for Robinhood Chain (STEP 4). Derives InstrumentRecords from
   the two LIVE sources the product already trusts:
     - the Arcus spot token list (symbol/address/decimals — fetched from the router, never hardcoded)
     - the Chainlink reference-data directory feed map (lib/rwa/oracle-feeds.ts)
   Pure builder — callers fetch, this derives. Every record carries source + verifiedAt; an
   instrument without a feed keeps oracleFeed=null (shown as unknown downstream, never faked). */

import type { OracleFeed } from "../rwa/oracle-feeds.ts";
import type { InstrumentRecord, InstrumentKind } from "./instrument.ts";

export type InstrumentSourceToken = {
  symbol: string;
  address: string;
  decimals: number;
  /** Category from the venue overview when known (e.g. "CRYPTO"); null/absent = assume equity. */
  category?: string | null;
};

const QUOTE_ASSET = "USDG";

function kindOf(t: InstrumentSourceToken): InstrumentKind {
  return (t.category ?? "").toUpperCase() === "CRYPTO" ? "spot-crypto" : "spot-tokenized-equity";
}

/**
 * Build the registry keyed by instrumentId. USDG itself is the quote asset, not an instrument.
 * `verifiedAt` should be the date the source lists were actually fetched, not a constant.
 */
export function buildInstrumentRegistry(
  tokens: readonly InstrumentSourceToken[],
  feeds: Record<string, OracleFeed>,
  verifiedAt: string
): InstrumentRecord[] {
  const out: InstrumentRecord[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const symbol = (t.symbol ?? "").trim();
    if (!symbol || symbol === QUOTE_ASSET) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(t.address ?? "")) continue; // an instrument without a real address is not verifiable
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const kind = kindOf(t);
    out.push({
      key: { chain: "robinhood-chain", kind, base: symbol, quote: QUOTE_ASSET },
      label: symbol,
      address: t.address,
      oracleFeed: feeds[symbol]?.proxy ?? null,
      // ERC-8056 uiMultiplier is a Stock Token feature; actual presence is still verified on-read
      // (readStockTokenOnchain throws for non-tokens) — this flag only says "expected".
      hasUiMultiplier: kind === "spot-tokenized-equity",
      marketHours: kind === "spot-tokenized-equity" ? "equities-rth" : "24-7",
      source: "live-probe", // both inputs are live fetches (Arcus router + Chainlink directory)
      verifiedAt,
    });
  }
  return out;
}
