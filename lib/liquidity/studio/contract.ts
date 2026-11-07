/**
 * Liquidity Studio's venue contract on Solana: what a pools venue
 * gives the screens — a pool, a person's positions, a preview of an add, a
 * remove or a claim, and the unsigned transactions the person's wallet signs.
 *
 * The core (`@ryntra/core` 0.2.0, contracts A6) knows only the flag
 * `liquidity`; the shape of a liquidity venue is agreed by the design line in
 * ryntra-core together with the EVM networks' own liquidity venues
 * (Uniswap v4 / v3, Aero). Until that contract lands, this file is the
 * Solana side of it, written in the core's own vocabulary — `Amount` in base
 * units, `CapabilityState`, `FeeRow`, `Refusal` — so it gives way to the
 * core's import field for field rather than being rewritten.
 *
 * Rules the types carry:
 * - money is an `Amount` — a decimal string of base units, never a float;
 *   a price is a decimal string of the quote token per one base token, for
 *   reading only, never for sizing money;
 * - the chain is the truth of ownership: a position is read from the program's
 *   accounts, an indexer is only a cache, and every read carries its slot and
 *   time (`ChainSource`);
 * - the person signs: a build returns unsigned transactions for the owner's
 *   wallet. The only key a build signs with is the fresh key of a new
 *   position account (DLMM) or of a new position's NFT (DAMM v2) — a key that
 *   holds nothing and is thrown away;
 * - no Ryntra fee: Liquidity Studio adds no fee row of its own to a pool
 *   action — none is set; `fees()` lists the
 *   venue's schedule only.
 *
 * Pure and client-safe: types, refusals and the capability table. No network.
 */

import type { Amount, CapabilityState, FeeRow, NetworkId, VenueCapabilities } from "@ryntra/core/adapters";

/** The two Meteora programs Liquidity Studio reads and builds for; ids as the capability registry names them. */
export const LIQUIDITY_VENUE_IDS = ["meteora-dlmm", "meteora-damm2"] as const;
export type LiquidityVenueId = (typeof LIQUIDITY_VENUE_IDS)[number];

export const SOLANA_NETWORK: NetworkId = "solana";

/** Where a figure came from: the program's own accounts at a slot, read at a time. */
export type ChainSource = Readonly<{
  kind: "chain";
  /** The program whose accounts were read. */
  program: string;
  /** The slot the read answered at; null when the RPC did not say. */
  slot: number | null;
  /** ms, when the read was made. */
  at: number;
}>;

export type LiquidityToken = Readonly<{
  mint: string;
  decimals: number;
  /** The token program that owns the mint: SPL Token or Token-2022. */
  program: string;
}>;

/**
 * DLMM: liquidity sits in bins of a fixed price step; the active bin is where
 * the price is. DAMM v2: one constant-product curve between a minimum and a
 * maximum price, the same range for every position in the pool — or, in a
 * compounding pool, the plain curve with no bounds at all (`null`), where part
 * of every fee goes back into the pool instead of waiting to be claimed.
 */
export type PoolShape =
  | Readonly<{ kind: "bins"; binStepBps: number; activeBin: number }>
  | Readonly<{ kind: "range"; minPrice: string | null; maxPrice: string | null; concentrated: boolean; compounding: boolean }>;

export type LiquidityPoolFees = Readonly<{
  /** The pool's base fee on a trade, basis points. */
  baseBps: number;
  /** The fee a trade pays now — base plus the volatility part — basis points; null where the pool has no dynamic part. */
  currentBps: number | null;
  /** The ceiling the program allows, basis points; null when the pool does not state one. */
  maxBps: number | null;
  /** The protocol's share of the fee, percent of the fee; the rest goes to the liquidity providers. */
  protocolSharePct: number;
}>;

export type LiquidityPool = Readonly<{
  venue: LiquidityVenueId;
  network: NetworkId;
  address: string;
  /** DLMM's X / DAMM v2's A. */
  tokenX: LiquidityToken;
  /** DLMM's Y / DAMM v2's B. */
  tokenY: LiquidityToken;
  /** Y per one X, as a decimal string, at the pool's price now. */
  price: string;
  shape: PoolShape;
  fees: LiquidityPoolFees;
  /** What the pool holds of each token, base units. */
  reserves: Readonly<{ x: Amount; y: Amount }>;
  /** False when the program refuses trades or deposits on this pool now. */
  enabled: boolean;
  source: ChainSource;
}>;

/** A position's place against the pool's price. `above` — every bin over the price, so it holds only X; `below` — only Y. */
export type RangeState = "in_range" | "above" | "below";

export type PositionRange =
  | Readonly<{ kind: "bins"; lowerBin: number; upperBin: number; lowerPrice: string; upperPrice: string }>
  | Readonly<{ kind: "range"; minPrice: string | null; maxPrice: string | null }>;

export type LiquidityPosition = Readonly<{
  venue: LiquidityVenueId;
  network: NetworkId;
  /** The position account. */
  address: string;
  pool: string;
  /** Who may withdraw: the account owner (DLMM) or the holder of the position's NFT (DAMM v2). */
  owner: string;
  /** Where claimed fees go: the owner, unless a DLMM position names another fee owner (a launch can). */
  feeRecipient: string;
  /** DAMM v2 only: the NFT that carries the position. */
  nftMint: string | null;
  range: PositionRange;
  rangeState: RangeState;
  /** What the position holds now, base units — what a full withdraw would return before slippage. */
  amounts: Readonly<{ x: Amount; y: Amount }>;
  /** Fees earned and not yet claimed. */
  unclaimedFees: Readonly<{ x: Amount; y: Amount }>;
  /** Farm rewards not yet claimed, when the pool runs any; empty when none. */
  unclaimedRewards: readonly Amount[];
  /**
   * Share of the position the owner cannot withdraw now (a vesting or a permanent lock), 0–10 000 basis points.
   * DLMM positions have no lock: 0.
   */
  lockedBps: number;
  source: ChainSource;
}>;

/** DLMM's three ways to spread an add over the bins. DAMM v2 has one curve and ignores it. */
export const LIQUIDITY_SHAPES = ["spot", "curve", "bid_ask"] as const;
export type LiquidityShape = (typeof LIQUIDITY_SHAPES)[number];
/** A shape as the DLMM SDK's `StrategyType`. */
export const SHAPE_TO_STRATEGY: Readonly<Record<LiquidityShape, number>> = { spot: 0, curve: 1, bid_ask: 2 };

export type AddLiquidityRequest = Readonly<{
  pool: string;
  owner: string;
  /** Add to this position; absent — open a new one. */
  position?: string | undefined;
  /** Base units of each side the person puts in; one side may be "0". */
  amountX: string;
  amountY: string;
  /** DLMM only: the bins of a new position, inclusive. Ignored for an existing position (its own bins) and for DAMM v2. */
  bins?: Readonly<{ lower: number; upper: number }> | undefined;
  /** DLMM only; default `spot`. */
  shape?: LiquidityShape | undefined;
  /** How far the price may move before the program refuses, basis points. */
  slippageBps: number;
}>;

export type RemoveLiquidityRequest = Readonly<{
  position: string;
  owner: string;
  /** Share of the withdrawable liquidity to take out, 1–10 000 basis points. */
  shareBps: number;
  /** With 10 000: claim the fees and close the position, returning its rent. */
  close?: boolean | undefined;
  slippageBps: number;
}>;

export type ClaimFeesRequest = Readonly<{ position: string; owner: string }>;

/**
 * SOL besides the deposit: rent of an account a build opens (`pay`) or closes (`return`). A position's own rent comes
 * back when it is closed; a DLMM bin array is the pool's, shared by everyone, and its rent does not come back. A new
 * pool's own accounts (`pool` — a DAMM v2 pool and its two vaults, paid by whoever makes it: the city's Stock Pier,
 * CITY-98) stay the pool's and do not come back either.
 */
export type RentCost = Readonly<{
  /**
   * A Zap (CITY-198) may also open the wallet's own account of the pier's other coin (`token_account`, the wallet's to
   * close) and finds or leaves the Zap program's ledger (`ledger`, the wallet's own; it comes back when closed).
   */
  what: "position" | "bin_arrays" | "bitmap_extension" | "pool" | "token_account" | "ledger";
  direction: "pay" | "return";
  lamports: string;
  refundable: boolean;
}>;

/** What every preview carries: the facts Review shows before the signature, and how long they hold. */
type PreviewBase = Readonly<{
  venue: LiquidityVenueId;
  pool: string;
  /**
   * What the person pays on this action: Meteora charges nothing to add, remove or claim, and Liquidity Studio adds no
   * row of its own — so today it is empty, and Review says so rather than hiding the line.
   */
  fees: readonly FeeRow[];
  rent: readonly RentCost[];
  /** At most this many transactions for the wallet to sign (DLMM splits a wide range; empty bins need none). */
  transactions: number;
  /** Facts the person should read before signing, as codes the screens word. */
  notices: readonly LiquidityNotice[];
  /** The pool's price the preview was made at. */
  price: string;
  /** ms */
  at: number;
  /** ms; a build refuses a preview past it. */
  expiresAt: number;
}>;

export type AddLiquidityPreview = PreviewBase &
  Readonly<{
    action: "add";
    request: AddLiquidityRequest;
    /** A new position account (or NFT) will be opened. */
    opensPosition: boolean;
    range: PositionRange;
    rangeState: RangeState;
    /** What goes in at most, base units. */
    deposit: Readonly<{ x: Amount; y: Amount }>;
  }>;

export type RemoveLiquidityPreview = PreviewBase &
  Readonly<{
    action: "remove";
    request: RemoveLiquidityRequest;
    /** What comes back at the price now. */
    expected: Readonly<{ x: Amount; y: Amount }>;
    /** The least the program will accept to send back; null where the program takes no threshold (DLMM pays each bin's share as it stands). */
    minimum: Readonly<{ x: Amount; y: Amount }> | null;
    /** Fees claimed in the same transaction (with `close`), else zero. */
    feesClaimed: Readonly<{ x: Amount; y: Amount }>;
    /** Farm rewards claimed with `close`, else none. */
    rewardsClaimed: readonly Amount[];
    closesPosition: boolean;
  }>;

export type ClaimFeesPreview = PreviewBase &
  Readonly<{
    action: "claim";
    request: ClaimFeesRequest;
    claimed: Readonly<{ x: Amount; y: Amount }>;
  }>;

export type LiquidityPreview = AddLiquidityPreview | RemoveLiquidityPreview | ClaimFeesPreview;

export const LIQUIDITY_NOTICES = [
  /** The range sits wholly above or below the price: the deposit is one token and earns nothing until the price enters. */
  "one_sided",
  /** Part of what was asked for will not go in at this price (the other side is short). */
  "partial_deposit",
  /** The position is out of range now: it earns no fees. */
  "out_of_range",
  /** Part of the position is locked and stays in the pool. */
  "locked_part_stays",
  /** The pool has farm rewards; claiming fees leaves them. */
  "rewards_separate",
  /** One of the tokens is Token-2022 with a transfer fee: amounts arriving are smaller than shown before the token's own fee. */
  "transfer_fee",
] as const;
export type LiquidityNotice = (typeof LIQUIDITY_NOTICES)[number];

/** One transaction for the wallet: serialized without the owner's signature. */
export type UnsignedLiquidityTx = Readonly<{
  wireBase64: string;
  /** Keys that already signed it — only a fresh position or NFT key, never a key that holds money. */
  presigned: readonly string[];
}>;

export type BuiltLiquidity = Readonly<{
  preview: LiquidityPreview;
  /** In the order the wallet signs and sends them. */
  transactions: readonly UnsignedLiquidityTx[];
  feePayer: string;
  /** The block height after which the transactions expire, decimal string. */
  validUntil: string;
  /** The position the build acts on — for an add, the new account. */
  position: string;
}>;

/** Each action as the core's capability state: what a screen may offer now, greyed with its caption otherwise. */
export const LIQUIDITY_ACTIONS = ["pools", "positions", "add", "remove", "claim"] as const;
export type LiquidityAction = (typeof LIQUIDITY_ACTIONS)[number];

export type LiquidityCapabilities = Readonly<{
  actions: { readonly [K in LiquidityAction]: CapabilityState };
  /** How a range is chosen. */
  range: "bins" | "pool";
  shapes: readonly LiquidityShape[];
  /** A position may hold one token only (a range off the price). */
  oneSided: boolean;
  /** At most this many bins in one new position; null when ranges are not chosen. */
  maxBins: number | null;
}>;

/**
 * Reading is on. Actions wait for a first live check on mainnet with the
 * smallest amount: a build exists and is tested on recorded chain state, but
 * no screen offers it to people before then. The screens print `until` as it is.
 */
export const ACTIONS_UNTIL = "after a live check";

export function liquidityActions(actionsOpen: boolean): LiquidityCapabilities["actions"] {
  const action: CapabilityState = actionsOpen ? { status: "on" } : { status: "later", until: ACTIONS_UNTIL };
  return { pools: { status: "on" }, positions: { status: "on" }, add: action, remove: action, claim: action };
}

/** The core's venue flags for a pools venue: `liquidity` alone, never a trading flag. */
export function liquidityVenueCapabilities(): VenueCapabilities {
  const off: CapabilityState = { status: "off" };
  return { swap: off, limit: off, clob: off, perps: off, launch: off, liquidity: { status: "on" } };
}

export const LIQUIDITY_REFUSALS = [
  "BAD_REQUEST",
  "POOL_NOT_FOUND",
  "POOL_DISABLED",
  "POSITION_NOT_FOUND",
  "NOT_OWNER",
  "WRONG_POOL",
  "AMOUNT_ZERO",
  "SIDE_NOT_ACCEPTED",
  "RANGE_INVALID",
  "RANGE_TOO_WIDE",
  "NOTHING_TO_WITHDRAW",
  "NOTHING_TO_CLAIM",
  "POSITION_LOCKED",
  "FEES_GO_ELSEWHERE",
  "PREVIEW_EXPIRED",
  /** Limit orders (`limit-orders.ts`): the pool takes none (it runs farm rewards), no order at the address, a roll of an order not yet filled. */
  "LIMIT_NOT_SUPPORTED",
  "ORDER_NOT_FOUND",
  "NOT_FILLED",
  /** A Zap (`zap.ts`): no swap route between SOL and the pier's other coin at this size. */
  "ZAP_NO_ROUTE",
] as const;
export type LiquidityRefusalCode = (typeof LIQUIDITY_REFUSALS)[number];

/** A request the venue will not build: the screen words the code; `detail` is for the log, never shown with addresses or sums. */
export class LiquidityRefusal extends Error {
  readonly code: LiquidityRefusalCode;
  constructor(code: LiquidityRefusalCode, detail: string) {
    super(detail);
    this.name = "LiquidityRefusal";
    this.code = code;
  }
}

export type LiquidityVenueAdapter = Readonly<{
  id: LiquidityVenueId;
  /** As the person reads it: «Meteora DLMM». */
  label: string;
  network: NetworkId;
  /** The program id on Solana. */
  program: string;
  capabilities(): LiquidityCapabilities;
  venueCapabilities(): VenueCapabilities;
  /** The pool's own schedule for a trade — what the liquidity earns from; no Ryntra row. */
  fees(pool: LiquidityPool): readonly FeeRow[];
  pool(address: string): Promise<LiquidityPool>;
  /** Every position the wallet owns on this venue, or in one pool. */
  positions(owner: string, options?: Readonly<{ pool?: string }>): Promise<readonly LiquidityPosition[]>;
  position(address: string): Promise<LiquidityPosition | null>;
  previewAdd(request: AddLiquidityRequest): Promise<AddLiquidityPreview>;
  previewRemove(request: RemoveLiquidityRequest): Promise<RemoveLiquidityPreview>;
  previewClaim(request: ClaimFeesRequest): Promise<ClaimFeesPreview>;
  /**
   * Build for the preview's request. The preview object is the caller's and is not trusted: the venue checks the
   * request again, previews it afresh on the chain and builds from those figures, refusing (`PREVIEW_EXPIRED`) when the
   * price has moved past the slippage or the figures no longer match. Holding a preview between Review and the
   * signature, so that what is built is what was shown, is the route's job — `expiresAt` is a guard, not a seal.
   */
  buildAdd(preview: AddLiquidityPreview): Promise<BuiltLiquidity>;
  buildRemove(preview: RemoveLiquidityPreview): Promise<BuiltLiquidity>;
  buildClaim(preview: ClaimFeesPreview): Promise<BuiltLiquidity>;
}>;
