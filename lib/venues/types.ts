/* Venue adapter contract — the thin multi-venue seam (NORTH-STAR §3).
   Pure types, no runtime, no I/O. Adding a 2nd venue/partner = implementing these ports;
   the venue-agnostic core (lib/rwa/risk.ts risk engine, lib/chart charting, journal) never
   changes when a venue is added.

   Non-custodial invariant is encoded in the TYPES: `walletSignedExec` is literal `true` and
   `withdrawals` is literal `false` — a venue can never declare withdrawal authority. The order
   ticket reads `capabilities` and renders a control ONLY when the venue truthfully executes it;
   anything Ryntra simulates client-side (e.g. spot conditionals) is labeled as client-side.

   Arcus is the reference implementation (lib/venues/arcus). */

import type { RwaRiskSnapshot, RwaAssetType } from "../rwa/risk";

export type VenueId = "arcus" | "lighter" | "meridian" | "hyperliquid" | "ostium";

/** Normalized instrument asset class across venues (a superset of RwaAssetType). */
export type AssetClass =
  | "spot-tokenized-equity"
  | "spot-crypto"
  | "rwa-perp"
  | "crypto-perp"
  | "option"
  | "prediction";

/** How price is discovered — one DataFeed interface normalizes all four. */
export type QuoteModel = "rfq" | "clob" | "amm" | "oracle";

/** Wallet-connect / signing family. One EVM SigningAdapter covers Arcus + Hyperliquid + Ostium. */
export type SigningFamily = "evm" | "cosmos" | "solana" | "starknet";

export type VenueMeta = {
  id: VenueId;
  label: string;
  /** EVM chain id the venue settles on (Arcus / Robinhood Chain = 4663). NULL when the venue's
      settlement runtime is NOT an EVM chain (Hyperliquid perps settle on HyperCore; the
      associated HyperEVM chain 999 is a separate environment — never a stand-in id here).
      Wallet display network / signing family are SEPARATE concepts: signingFamily says what
      kind of wallet signs; this field says where settlement actually happens. */
  chainId: number | null;
  chainName: string;
  signingFamily: SigningFamily;
  /** For capability-honest copy — never imply live where it is beta/testnet. */
  status: "live" | "beta" | "testnet" | "planned";
  /**
   * Regions the venue or issuer states it does not serve.
   *
   * **Disclosure, never a gate.** Ryntra implements no geographic or IP
   * restriction of its own — founder decision, 2026-08-19: the functionality is
   * built, who may use it is stated in the public documentation and terms, and
   * nothing here inspects a request's origin. This field was named
   * `geoBlocked` and its comment read "gating + disclosure hint", which
   * described a gate that has never existed: nothing in this repository ever
   * read it. The name now matches the model, and `venues.test.mjs` fails the
   * build if any code starts branching on it.
   *
   * It is the venue's statement, not Ryntra's, and it does not predict what a
   * venue will answer — the venue answers for itself and that answer is shown
   * as it comes back.
   */
  venueStatedRestrictions: string[];
};

/**
 * What the venue TRUTHFULLY executes. `withdrawals` is a literal `false` and
 * `walletSignedExec` a literal `true` — non-custody enforced by the type system.
 */
export type VenueCapabilities = {
  spot: boolean;
  spotModel: QuoteModel | null;
  perps: boolean;
  clob: boolean;
  orderbookData: boolean;
  supportsResting: boolean;
  supportsStopTrigger: boolean;
  /** false | "fixed-bundle" (Arcus TPSL groupings) | true (free OCO). */
  supportsOCO: boolean | "fixed-bundle";
  supportsTrailing: boolean;
  /** Venue has server-side spot conditionals? Arcus spot = RFQ (false) → Ryntra simulates, labeled. */
  supportsSpotConditional: boolean;
  nativeTpSl: boolean;
  reduceOnly: boolean;
  funding: boolean;
  liquidation: boolean;
  /** Read positions/fills by public address without an API key. */
  publicAccountData: boolean;
  /** NON-CUSTODY INVARIANT, not a shipped-execution claim: IF execution exists (now or later),
      it is wallet-signed. Whether execution is actually shipped is signaled ONLY by the
      presence of the `exec` port — see `venueExecutionAvailable()`. */
  walletSignedExec: true;
  /** Ryntra never has withdrawal authority. Immutable across every venue. */
  withdrawals: false;
};

export type BuilderModel = "none" | "referral" | "builder-code";

/** How (if at all) a non-custodial frontend earns on this venue. */
export type BuilderEconomics = {
  model: BuilderModel;
  /** Human note on the rail (e.g. "10%/3%/2% of referee PERP fees; spot 0% → $0"). */
  note: string;
  /** Per-order builder-fee cap in basis points, when model === "builder-code". */
  maxFeeBps?: number;
  /** True only when revenue can actually accrue for Ryntra's users TODAY. */
  earnsToday: boolean;
};

/** Normalized instrument. Never hardcode symbols/ticks — the catalog is the source of truth. */
export type VenueMarket = {
  symbol: string;
  label: string;
  assetClass: AssetClass;
  quoteModel: QuoteModel;
  collateralAsset: string; // "USDG" | "USDe" | "USDC" | on-chain token
  tickSize: string | null;
  stepSize: string | null;
  minNotional: string | null;
  maxLeverage: number | null;
  online: boolean;
  /** Venue's own market-hours fact when present (Arcus isOutsideRth). */
  isOutsideRth?: boolean;
};

export type VenueCandle = {
  /** Unix SECONDS, normalized across venues. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type VenuePosition = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  liquidationPrice: number | null;
};

export type VenueFill = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  price: number;
  fee: number;
  realizedPnl: number | null;
  /** Unix ms. */
  createdAt: number;
};

export type VenueOrder = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  price: number | null;
  size: number;
  filled: number;
  remaining: number;
};

/** An order the USER'S WALLET signs. The adapter never holds keys or funds. */
export type UnsignedIntent = {
  kind: "spot-swap" | "perp-order";
  venue: VenueId;
  /** Opaque per-venue payload the SigningAdapter turns into a signed request. */
  payload: unknown;
};

export type ExecResult = { ok: boolean; ref: string; error?: string };

/* ---------- ports ---------- */

export interface MarketCatalog {
  listMarkets(): Promise<VenueMarket[]>;
  getMarket(symbol: string): Promise<VenueMarket | null>;
}

export interface MarketDataFeed {
  candles(symbol: string, timeframe: string, hours: number): Promise<VenueCandle[]>;
}

export interface AccountReadFeed {
  positions(address: string): Promise<VenuePosition[]>;
  fills(address: string, limit?: number): Promise<VenueFill[]>;
  orders(address: string): Promise<VenueOrder[]>;
}

/**
 * Builds an UNSIGNED intent and relays it AFTER the wallet signs. Requires an injected
 * signer; structurally incapable of holding keys or funds (non-custodial invariant).
 * Client-only for on-chain venues — omit on read-only/server contexts.
 */
export interface ExecutionAdapter {
  prepare(input: unknown): Promise<UnsignedIntent>;
  relay(signed: unknown): Promise<ExecResult>;
}

/** Supplies venue/asset-specific signals to the shared pure risk engine (classifyRwaRisk). */
export interface RiskSignalSource {
  /** Build a (possibly partial) RwaRiskSnapshot for one symbol; `null` for unmeasured signals. */
  snapshot(symbol: string): Promise<RwaRiskSnapshot | null>;
}

/** The full venue contract. Adding a 2nd venue = implementing these ports. */
export interface VenueAdapter {
  meta: VenueMeta;
  capabilities: VenueCapabilities;
  economics: BuilderEconomics;
  catalog: MarketCatalog;
  data: MarketDataFeed;
  account: AccountReadFeed;
  risk: RiskSignalSource;
  /** Wallet-signed, client-only; optional so read-only venues and server contexts omit it. */
  exec?: ExecutionAdapter;
}

/**
 * Execution is SHIPPED only when the adapter exposes an exec port. Capabilities flags alone
 * (walletSignedExec, supportsResting, …) describe HOW execution behaves when it exists — they
 * never assert that it does. UI gating must use THIS, not the flags.
 */
export function venueExecutionAvailable(venue: VenueAdapter): boolean {
  return venue.exec != null;
}

/** Re-exported for adapters so risk signals stay type-aligned with the engine. */
export type { RwaRiskSnapshot, RwaAssetType };
