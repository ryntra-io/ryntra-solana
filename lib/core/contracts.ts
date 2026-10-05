/**
 * The core's contracts with the networks and venues it trades through.
 *
 * One core, many adapters. The core asks the capability registry what is
 * available (`./capabilities.ts`) and never names a protocol; an adapter
 * implements only the capabilities it has. A screen calls an intent of the
 * core — buy, sell, launch, add liquidity, start a bot — never Jupiter or
 * Uniswap directly. Every value-moving intent runs one pipeline
 * (`./pipeline.ts`): quote → build → guard → sign → submit → settle → receipt
 * → fee → rewards, and the guard — the safety chain — is a step of that
 * pipeline, written once, never a copy inside each line.
 *
 * Non-custody is in the types, as it is in the older venue seam
 * (`lib/venues/types.ts`, kept for the venues still described there): an
 * adapter returns **unsigned** bytes and submits
 * bytes the person's own wallet signed. Nothing here holds a key. The one
 * account kind that exists today is the person's own wallet; an account with
 * limits the person signs once (a trading account) is a later kind of
 * `TradingAccount`, added by its own task and its own review, never implied.
 *
 * Types only — no runtime, no I/O, no clock — so the server, the phone's
 * contract and a background engine can share it.
 */

/** A network Ryntra trades on: Solana first, then perps, the EVM chains and money. */
export const NETWORK_IDS = ["solana", "hyperliquid", "robinhood", "base", "bsc", "arc", "ethereum"] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

/** A venue — a protocol an adapter speaks to. */
export const VENUE_IDS = [
  "jupiter",
  "relay",
  "pump",
  "meteora-dbc",
  "meteora-dlmm",
  "meteora-damm2",
  "launchlab",
  "phoenix",
  "hyperliquid",
  "uniswap",
  "manifest",
  "xstocks",
  "prestocks",
] as const;
export type VenueId = (typeof VENUE_IDS)[number];

/**
 * What a person can do. A capability is the verb, not the screen: Spot and the
 * company page buy through the same `swap` as the Swap page, and say which
 * surface they are in the signed bundle's `origin`, never by another pipeline.
 */
export const CAPABILITY_IDS = ["swap", "bridge", "launch", "perps", "liquidity", "limit", "bot"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/**
 * A product line, for attribution: each product's fee identity is its own, so
 * an outside counter can tell a meme trade from a stock purchase from an API
 * integrator's flow.
 */
export const PRODUCT_IDS = ["swap", "memes", "stocks", "bots", "api", "launch", "perps", "lp", "bridge"] as const;
export type Product = (typeof PRODUCT_IDS)[number];

/** An address on its network: base58 on Solana, 0x-hex on an EVM chain. */
export type Address = string;

/** Raw base units as a decimal string — never a float. */
export type RawAmount = string;

export type Balance = Readonly<{
  network: NetworkId;
  /** The mint or contract; the network's own asset is named by its adapter. */
  asset: Address;
  amountRaw: RawAmount;
  decimals: number | null;
  /** What can be spent now, when it differs from what is held (rent, locks). */
  spendableRaw: RawAmount | null;
}>;

/**
 * Who signs. Today only the person's own wallet: every transaction is shown,
 * reviewed and signed by it. A trading account with signed limits is a later
 * kind and comes with its own security review, never as a flag on this one.
 */
export type TradingAccount = Readonly<{ kind: "WALLET"; network: NetworkId; address: Address }>;

/** Bytes for the person's wallet to sign, with what the guard proved about them. */
export type UnsignedTx = Readonly<{
  network: NetworkId;
  /** The exact wire bytes, base64. The review binds their hash. */
  wireBase64: string;
  /** The block (height, slot or nonce) after which the bytes can no longer land. */
  validUntil: string | null;
}>;

/** Bytes the person's wallet signed and handed back. */
export type SignedTx = Readonly<{
  network: NetworkId;
  wireBase64: string;
  /** The signature that names the transaction on its network. */
  signature: string;
}>;

/**
 * How bytes reach the network. `fast` is the venue's managed lane or a
 * low-latency sender; `protected` keeps them out of the public mempool. A
 * network adapter that has one lane answers both with it and says so.
 */
export type SubmitMode = "fast" | "protected";

export type Submission =
  | Readonly<{ state: "SENT"; signature: string; lane: string }>
  /** The send did not answer. Never sent again: recovered by reading the signature. */
  | Readonly<{ state: "UNKNOWN"; signature: string; lane: string; reason: string }>;

export type Settlement =
  | Readonly<{ state: "SETTLED"; signature: string; finality: "confirmed" | "finalized" }>
  /** Landed and failed: the fee moved, the trade did not. Still a landing, at its level. */
  | Readonly<{ state: "LANDED_FAILED"; signature: string; reason: string; finality: "confirmed" | "finalized" }>
  | Readonly<{ state: "NOT_SEEN"; signature: string }>;

/** What a person asked for, before any venue is chosen. */
export type TradeIntent = Readonly<{
  network: NetworkId;
  inputAsset: Address;
  outputAsset: Address;
  /** Exact input, in the input asset's raw units. */
  amountRaw: RawAmount;
  account: TradingAccount;
  /** A bound the person set (a plan's rule); absent, the venue's own estimate. */
  slippageBps?: number;
}>;

/**
 * A venue's price for one intent. `ryntraFeeBps` is the Ryntra fee the person
 * pays inside this quote — the one figure shown before the signature as
 * «Комісія Ryntra» and again in the receipt.
 */
export type Quote<Native = unknown> = Readonly<{
  venue: VenueId;
  intent: TradeIntent;
  inputRaw: RawAmount;
  quotedOutputRaw: RawAmount;
  minimumOutputRaw: RawAmount;
  priceImpactPct: string | null;
  ryntraFeeBps: number;
  /** The venue's id for this quote; the receipt and the ledger key on it. */
  requestId: string;
  /** When the review of this quote closes. */
  reviewExpiresAt: string;
  /** The venue's own normalized answer, for the steps that need its detail. */
  native: Native;
}>;

/** A venue that prices and builds a trade the person's wallet signs. */
export interface TradeVenue<Native = unknown> {
  readonly venue: VenueId;
  /** Price, route, impact and the Ryntra fee. */
  quote(intent: TradeIntent): Promise<Quote<Native>>;
  /** The unsigned bytes for that exact quote. */
  build(quote: Quote<Native>, account: TradingAccount): Promise<UnsignedTx>;
}

/** The network's own operations: what a wallet holds, sending, reading the outcome. */
export interface NetworkAdapter {
  readonly network: NetworkId;
  balances(owner: Address): Promise<Balance[]>;
  /** One send of signed bytes. Never retried: an unknown is recovered by signature. */
  submit(tx: SignedTx, mode: SubmitMode): Promise<Submission>;
  /** The chain's own word on a signature, read independently of whoever sent it. */
  observe(signature: string): Promise<Settlement>;
}

export type LaunchParams = Readonly<{
  network: NetworkId;
  name: string;
  symbol: string;
  metadataUri: string;
  /** A named preset of the venue's curve configuration. */
  preset: string;
  creator: Address;
  /** Who pays the network's rent for the new accounts; absent, the creator. */
  payer?: Address;
  /**
   * The creator's first purchase, in the pair currency's raw units, made in
   * the creation transaction itself; absent or "0", none. The venue refuses
   * it above the preset's cap — Ryntra's rule, not a field of the curve.
   */
  creatorFirstBuyRaw?: RawAmount;
  /** The pair currency, where a preset is quoted in more than one (a community's own token); absent, the preset's one. */
  pairMint?: Address;
}>;

export type CurveProgress = Readonly<{
  token: Address;
  /** Basis points of the curve's target reached, 0–10 000. */
  progressBps: number;
  migrated: boolean;
}>;

export interface LaunchVenue {
  readonly venue: VenueId;
  /**
   * The bytes that create the token. They may already carry the signature of
   * the fresh account the venue made for them (the new mint) — never a key of
   * the person's: the wallet still signs, and nothing lands without it.
   */
  create(params: LaunchParams): Promise<UnsignedTx & Readonly<{ token: Address }>>;
  progress(token: Address): Promise<CurveProgress>;
  claimFees(role: "partner" | "creator", token: Address): Promise<UnsignedTx>;
}

export type PerpMarket = Readonly<{ symbol: string; maxLeverage: number; online: boolean }>;
export type PerpIntent = Readonly<{
  market: string;
  side: "long" | "short";
  sizeRaw: RawAmount;
  leverage: number;
  reduceOnly: boolean;
}>;
export type OrderResult = Readonly<{ ok: true; orderRef: string } | { ok: false; code: string; reason: string }>;
export type PerpPosition = Readonly<{
  market: string;
  side: "long" | "short";
  sizeRaw: RawAmount;
  entryPrice: string;
  liquidationPrice: string | null;
}>;

export interface PerpsVenue {
  readonly venue: VenueId;
  markets(): Promise<PerpMarket[]>;
  order(intent: PerpIntent, account: TradingAccount): Promise<OrderResult>;
  positions(account: TradingAccount): Promise<PerpPosition[]>;
}

export type PoolFilter = Readonly<{ assets?: readonly Address[]; minTvlUsd?: number }>;
export type Pool = Readonly<{ id: string; venue: VenueId; assets: readonly Address[]; tvlUsd: number | null }>;
export type LpIntent = Readonly<{ pool: string; amountsRaw: readonly RawAmount[]; account: TradingAccount }>;
export type PositionId = string;

export interface LiquidityVenue {
  readonly venue: VenueId;
  pools(filter: PoolFilter): Promise<Pool[]>;
  open(intent: LpIntent): Promise<UnsignedTx>;
  rebalance(position: PositionId): Promise<UnsignedTx>;
  claim(position: PositionId): Promise<UnsignedTx>;
  close(position: PositionId): Promise<UnsignedTx>;
}

export type PulseFeed = "new" | "graduating" | "graduated";
export type TokenFilter = Readonly<{ network: NetworkId; minLiquidityUsd?: number }>;
export type TokenRow = Readonly<{ address: Address; symbol: string | null; observedAt: string }>;
export type TokenStats = Readonly<{ address: Address; priceUsd: number | null; liquidityUsd: number | null; observedAt: string }>;
export type HolderRow = Readonly<{ owner: Address; amountRaw: RawAmount; labels: readonly string[] }>;
export type TradeFilter = Readonly<{ since?: string; minUsd?: number }>;
export type TradeRow = Readonly<{ signature: string; side: "buy" | "sell"; amountRaw: RawAmount; at: string }>;
/** Facts with their reasons and sources — never a verdict on the person's behalf. */
export type RiskFacts = Readonly<{
  address: Address;
  facts: readonly Readonly<{ code: string; reason: string; source: string; observedAt: string }>[];
}>;

/** A provider of token data Ryntra has the right to show. */
export interface TokenData {
  pulse(feed: PulseFeed, filter: TokenFilter): AsyncIterable<TokenRow>;
  token(address: Address): Promise<TokenStats>;
  holders(address: Address): Promise<HolderRow[]>;
  trades(address: Address, filter: TradeFilter): AsyncIterable<TradeRow>;
  risk(address: Address): Promise<RiskFacts>;
}

/**
 * How a venue knows the flow is Ryntra's: the account a fee lands in, a
 * partner code, a curve config. `address` is null when nothing is configured
 * for it — then nothing is asked for and the fee is an honest zero.
 */
export type FeeIdentity = Readonly<{
  product: Product;
  /** The mechanism the venue carries it by. */
  kind: "JUPITER_REFERRAL_ACCOUNT" | "FEE_WALLET" | "RELAY_APP_FEE_RECIPIENT" | "PARTNER_CODE" | "CURVE_CONFIG";
  address: Address | null;
}>;

/** Every adapter answers for its own attribution. */
export interface Attribution {
  identity(product: Product): FeeIdentity;
}
