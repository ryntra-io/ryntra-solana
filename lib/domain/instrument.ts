/* Canonical instrument identity (STEP 3/4). One instrument (e.g. NVDA Stock Token on
   Robinhood Chain) can be tradable via SEVERAL routes; the key is route-independent so risk,
   journal and readiness records attach to the instrument, not to a venue symbol. */

import type { ChainId } from "./ids.ts";
import type { CapabilitySource } from "./capability.ts";

export type InstrumentKind = "spot-tokenized-equity" | "spot-crypto" | "rwa-perp" | "crypto-perp";

export type InstrumentKey = {
  chain: ChainId;
  kind: InstrumentKind;
  /** Canonical base symbol, e.g. "NVDA", "BTC". Technical tokens stay English (i18n rule). */
  base: string;
  /** Quote / collateral asset, e.g. "USDG", "USDC". */
  quote: string;
};

/** Stable string form for maps, journal rows and idempotency scopes. */
export function instrumentId(k: InstrumentKey): string {
  return `${k.chain}:${k.kind}:${k.base}/${k.quote}`;
}

/** Registry entry: verified on-chain metadata for one instrument on one chain. */
export type InstrumentRecord = {
  key: InstrumentKey;
  label: string;
  /** Token contract address on the chain, when the instrument IS a token (spot). Null for perps. */
  address: string | null;
  /** Chainlink-style oracle feed address when known. The feed prices the TOKEN, not the underlying share. */
  oracleFeed: string | null;
  /** ERC-8056 uiMultiplier support (corporate-action scaled Stock Tokens). */
  hasUiMultiplier: boolean;
  /** Whether the instrument observes traditional market hours (equities) or trades 24/7 (crypto). */
  marketHours: "equities-rth" | "24-7" | "unknown";
  /** Where the metadata came from + when it was last verified. Unverified entries must say so. */
  source: CapabilitySource;
  verifiedAt: string; // YYYY-MM-DD
};
