/**
 * Admin business analytics — the owner's answer to one question:
 * *is anybody using the product, and is it becoming a business?*
 *
 * `RYN-ADMIN-BUSINESS-001`. Pure and client-safe: no clock, no store, no
 * `process.env`. Everything here is a projection over records the product
 * already keeps for its own reasons — the wallet action ledger, the cross-chain
 * order book, the rewards ledger, the referral graph and the wallet presence
 * index — so there is no second bookkeeping to drift from the first.
 *
 * ## The four rules every number here follows
 *
 * 1. **A trade is a finished operation.** A quote is not a trade, a Review is
 *    not a trade, and a failed or rejected transaction is not volume. Only a
 *    `DONE` row of the `SWAP` or `CROSS_SWAP` lane counts, once, by its own
 *    action id — a reload or a status poll rewrites the same row rather than
 *    adding one.
 * 2. **Volume is executed value, never a quote.** The USD figure of a trade is
 *    the stablecoin leg at par — what actually left or arrived — and nothing
 *    else. A trade with no stablecoin on either side is counted as a trade and
 *    reported as *unvalued*, which is a smaller number than an invented one.
 * 3. **Revenue is a fee a provider confirmed it took.** The row's fee is written
 *    only from a settlement (`collected: true`), and the split between the
 *    provider and Ryntra is read off that settlement where it was recorded.
 * 4. **Zero means a measured zero.** A source that does not exist yet answers
 *    `not_collected`; a source that failed answers `unavailable`; neither is a
 *    number, and the surface never draws a zero for either.
 *
 * ## External and internal wallets
 *
 * The owner's own test wallets would otherwise be the whole business. A
 * server-side list marks them *internal*; the default scope excludes them from
 * every KPI, and the *all activity* scope puts them back so a test swap can be
 * seen without being counted as a customer.
 */

import type { RewardEntry } from "../rewards/model.ts";
import { usdMicrosOf } from "../rewards/model.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { isSpotOrigin } from "../solana/action-origin.ts";
import {
  ACTION_PAR_MINTS as BUSINESS_PAR_MINTS,
  ACTION_PAR_SYMBOLS as BUSINESS_PAR_SYMBOLS,
  parUsdMicros,
  tradeUsdMicros,
} from "../solana/action-value.ts";
import type { Cell } from "./overview.ts";

export const BUSINESS_RANGES = ["24h", "7d", "30d", "all"] as const;
export type BusinessRange = (typeof BUSINESS_RANGES)[number];

export const BUSINESS_SCOPES = ["external", "all"] as const;
export type BusinessScope = (typeof BUSINESS_SCOPES)[number];

export function isBusinessRange(value: unknown): value is BusinessRange {
  return typeof value === "string" && (BUSINESS_RANGES as readonly string[]).includes(value);
}

export function isBusinessScope(value: unknown): value is BusinessScope {
  return typeof value === "string" && (BUSINESS_SCOPES as readonly string[]).includes(value);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The instant a range begins, or `null` for all time. */
export function rangeStart(range: BusinessRange, now: string): string | null {
  const end = Date.parse(now);
  switch (range) {
    case "24h":
      return new Date(end - DAY_MS).toISOString();
    case "7d":
      return new Date(end - 7 * DAY_MS).toISOString();
    case "30d":
      return new Date(end - 30 * DAY_MS).toISOString();
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ inputs */

export type BusinessProvider = "JUPITER" | "RELAY" | "MAYAN" | "CCTP";

/** Which provider carried a cross-chain order, keyed by its intent digest. */
export type BusinessOrderRef = Readonly<{ intentDigest: string; provider: "MAYAN" | "RELAY" }>;

export type BusinessReferralEdge = Readonly<{ referrer: string; wallet: string; level: number; at: string }>;

/** One wallet's presence in the cabinet, as `lib/admin/wallet-presence.ts` records it. */
export type BusinessPresence = Readonly<{
  wallet: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sessions: number;
  firstVerifiedAt: string | null;
  lastVerifiedAt: string | null;
  verifications: number;
}>;

export type SourceState = "measured" | "not_collected" | "unavailable";

export type BusinessInputs = Readonly<{
  now: string;
  range: BusinessRange;
  scope: BusinessScope;
  actions: readonly SolanaWalletAction[];
  orders: readonly BusinessOrderRef[];
  rewards: readonly RewardEntry[];
  edges: readonly BusinessReferralEdge[];
  presence: readonly BusinessPresence[];
  /** Base58 wallets the owner marked internal. Never a client-side list. */
  internalWallets: ReadonlySet<string>;
  sources: Readonly<{ actions: SourceState; rewards: SourceState; presence: SourceState }>;
  /** The instant Rewards began accruing, when the deployment states one. */
  rewardsSince: string | null;
}>;

/* ------------------------------------------------------------------- model */

export type BusinessFeedKind =
  | "SWAP"
  | "SPOT_BUY"
  | "SPOT_SELL"
  | "CROSS_SWAP"
  | "BRIDGE"
  | "SEND"
  | "RECEIVE"
  | "WALLET_VERIFIED"
  | "REFERRAL"
  | "REWARD"
  | "CLAIM";

export type BusinessFeedStatus = "DONE" | "FAILED" | "IN_FLIGHT" | "NEEDS_YOU" | "INFO";

export type BusinessFeedItem = Readonly<{
  at: string;
  kind: BusinessFeedKind;
  /** `7BxQ…91Pk`. The full address is one disclosure away, never in the row. */
  wallet: string;
  walletFull: string;
  internal: boolean;
  /** `SOL → USDC`, `USDC → SOL · Base → Solana`, `Level 1`, `Cashback`. */
  route: string | null;
  /** The executed USD value of a financial action, or the reward amount. */
  valueUsd: number | null;
  provider: BusinessProvider | null;
  status: BusinessFeedStatus;
  /** A chain reference the operator can open: a Solana signature or an EVM hash. */
  reference: string | null;
}>;

/**
 * One fee-bearing operation, every share of its fee named — the row the
 * owner reads when the question is *what did this one trade make* rather
 * than *what did the window make*. `RYN-ADMIN-FEEDBACK-LOOP-001`.
 */
export type BusinessFeeRow = Readonly<{
  at: string;
  wallet: string;
  walletFull: string;
  internal: boolean;
  kind: "SWAP" | "SPOT_BUY" | "SPOT_SELL" | "CROSS_SWAP";
  provider: BusinessProvider | null;
  route: string | null;
  volumeUsd: number | null;
  /** Whether the provider reported the fee as taken. A false is a measured nothing. */
  collected: boolean;
  /** The fee as taken — `0.012552 USDC` — or null where only a value was stated. */
  feeText: string | null;
  basisPoints: number | null;
  grossUsd: number | null;
  providerUsd: number | null;
  cashbackUsd: number;
  referralUsd: number;
  /** gross − provider − cashback − referrals; null when the gross is unvalued. */
  ryntraNetUsd: number | null;
  reference: string | null;
}>;

export type BusinessProviderRow = Readonly<{
  id: BusinessProvider;
  label: string;
  operations: number;
  volumeUsd: number;
  unvalued: number;
  grossUsd: number;
  ryntraNetUsd: number;
  /** Stated once for the providers with no integrator fee, so a zero reads as true. */
  feeNote: string | null;
}>;

export type BusinessBucket = Readonly<{
  /** ISO day `2026-09-11` or hour `2026-09-11T14`. */
  key: string;
  label: string;
  activeWallets: number;
  traders: number;
  trades: number;
  volumeUsd: number;
  revenueUsd: number;
}>;

export type BusinessFunnelStep = Readonly<{
  id: "visited" | "connected" | "verified" | "first_trade" | "repeat_trade";
  wallets: Cell;
}>;

export type BusinessLastSeen = Readonly<{ at: string | null; wallet: string | null; internal: boolean }>;

export type BusinessModel = Readonly<{
  generatedAt: string;
  range: BusinessRange;
  scope: BusinessScope;
  windowStart: string | null;
  internalWallets: number;
  sources: BusinessInputs["sources"];
  coverage: Readonly<{ actionsSince: string | null; presenceSince: string | null; rewardsSince: string | null }>;
  lastSeen: Readonly<{
    visitor: BusinessLastSeen & { status: "not_collected" };
    connected: BusinessLastSeen;
    verified: BusinessLastSeen;
    trade: BusinessLastSeen;
    referral: BusinessLastSeen;
  }>;
  audience: Readonly<{
    visitors: Cell;
    connected: Cell;
    verified: Cell;
    newWallets: Cell;
    active: Cell;
  }>;
  trading: Readonly<{
    traders: Cell;
    trades: Cell;
    volumeUsd: Cell;
    /** The Spot share of the same rows: `SWAP` rows whose origin is Spot. */
    spotTrades: Cell;
    spotVolumeUsd: Cell;
    /** Finished trades with no stablecoin leg and therefore no USD figure. */
    unvalued: number;
    failed: Cell;
    newTraders: Cell;
    returningTraders: Cell;
    repeatRate: Cell;
  }>;
  revenue: Readonly<{
    grossUsd: Cell;
    providerUsd: Cell;
    netBeforeRewardsUsd: Cell;
    cashbackUsd: Cell;
    referralL1Usd: Cell;
    referralL2Usd: Cell;
    retainedUsd: Cell;
    /** Collected fees the model could not put a dollar figure on. */
    unvaluedFees: number;
    /** Finished trades whose row carries no fee record at all. */
    feesNotRecorded: number;
  }>;
  rewards: Readonly<{
    accruedUsd: Cell;
    claimedUsd: Cell;
    /** All-time balance still owed: accrued minus paid. Not a range figure. */
    outstandingUsd: Cell;
    entries: number;
    claims: number;
  }>;
  referrals: Readonly<{ level1: Cell; level2: Cell }>;
  providers: readonly BusinessProviderRow[];
  funnel: readonly BusinessFunnelStep[];
  buckets: readonly BusinessBucket[];
  recent: readonly BusinessFeedItem[];
  /** Fee-bearing operations in the window, newest first, every share named. */
  fees: readonly BusinessFeeRow[];
}>;

/* --------------------------------------------------------------- valuation */

/* The valuation rule itself lives in `lib/solana/action-value.ts` since
   `RYN-PRE-HACKATHON-FOUNDATION-001`, where the Points ledger reads the same
   one — a trade is worth the same dollars on the dashboard and in Points, so
   there is no second bookkeeping to drift from the first. Re-exported under
   the names this module has always had. */
export {
  ACTION_PAR_MINTS as BUSINESS_PAR_MINTS,
  ACTION_PAR_SYMBOLS as BUSINESS_PAR_SYMBOLS,
  movementUsdMicros,
  parUsdMicros,
  tradeUsdMicros,
} from "../solana/action-value.ts";

function usdMicrosFromNumber(usd: number): bigint | null {
  if (!Number.isFinite(usd) || usd < 0) return null;
  const text = usd.toFixed(6);
  return /^[0-9]+\.[0-9]{6}$/.test(text) ? BigInt(text.replace(".", "")) : null;
}

/** Every reference a rewards accrual may have been keyed by for this row. */
export function operationRefsOf(action: SolanaWalletAction): readonly string[] {
  /* Deduplicated: a Solana swap's action id *is* its signature, and a list
     that names it twice counts every reward keyed by it twice — seen as a
     $0.60 cashback on a $0.60 fee the moment the fee rows were listed. */
  return [...new Set([action.actionId, action.signature, action.sourceTx].filter((ref): ref is string => typeof ref === "string" && ref.length > 0))];
}

/**
 * The gross fee the rewards ledger valued for an operation, in USD micros.
 *
 * The ledger records each share with the valuation it used, so the gross it
 * was a share of can be recovered exactly for a par asset or a priced one, and
 * within one micro-dollar from the share itself otherwise.
 */
export function ledgerGrossUsdMicros(entries: readonly RewardEntry[]): bigint | null {
  for (const entry of entries) {
    if (!entry.source || entry.rateBps <= 0) continue;
    const { grossRaw, decimals } = entry.source;
    if (entry.valuation.basis === "STABLECOIN_PAR") return parUsdMicros(grossRaw, decimals);
    if (entry.valuation.basis === "PRICED_AT_SETTLEMENT" && entry.valuation.price) {
      try {
        return usdMicrosOf({ raw: BigInt(grossRaw), decimals, price: entry.valuation.price });
      } catch {
        /* An unparseable price is treated as no price. */
      }
    }
    if (entry.usdMicros !== null) {
      const share = BigInt(entry.usdMicros);
      if (share > 0n) return (share * 10_000n) / BigInt(entry.rateBps);
    }
  }
  return null;
}

/**
 * Documented provider cut of a collected fee, used only where the row carries
 * no recorded split. Jupiter documents 20% of the integrator fee; Relay takes
 * none (its own charge is a separate line); the others collect nothing.
 */
export const BUSINESS_PROVIDER_RETAINED_PERCENT: Readonly<Record<BusinessProvider, number>> = {
  JUPITER: 20,
  RELAY: 0,
  MAYAN: 0,
  CCTP: 0,
};

export type FeeValuation = Readonly<{
  grossUsdMicros: bigint | null;
  providerUsdMicros: bigint | null;
  basis: "PROVIDER_STATED" | "PAR" | "LEDGER" | "UNVALUED";
}>;

/** What one finished row's collected fee is worth, and how that was established. */
export function feeValuation(
  action: SolanaWalletAction,
  provider: BusinessProvider | null,
  ledgerEntries: readonly RewardEntry[],
): FeeValuation | null {
  const fee = action.fee;
  if (!fee || !fee.collected) return null;
  let gross: bigint | null = null;
  let basis: FeeValuation["basis"] = "UNVALUED";
  if (fee.usd !== null && fee.usd > 0) {
    gross = usdMicrosFromNumber(fee.usd);
    basis = gross === null ? "UNVALUED" : "PROVIDER_STATED";
  }
  if (gross === null && fee.amountRaw !== null) {
    const parByAsset = fee.asset !== null ? BUSINESS_PAR_MINTS[fee.asset] : undefined;
    const parBySymbol = fee.symbol !== null && BUSINESS_PAR_SYMBOLS.has(fee.symbol.toUpperCase());
    const decimals = fee.decimals ?? parByAsset ?? null;
    if ((parByAsset !== undefined || parBySymbol) && decimals !== null) {
      gross = parUsdMicros(fee.amountRaw, decimals);
      basis = "PAR";
    }
  }
  if (gross === null) {
    gross = ledgerGrossUsdMicros(ledgerEntries);
    if (gross !== null) basis = "LEDGER";
  }
  if (gross === null) return { grossUsdMicros: null, providerUsdMicros: null, basis: "UNVALUED" };
  let providerShare: bigint;
  if (fee.providerRaw !== null && fee.amountRaw !== null && BigInt(fee.amountRaw) > 0n) {
    providerShare = (gross * BigInt(fee.providerRaw)) / BigInt(fee.amountRaw);
  } else {
    const percent = provider ? BUSINESS_PROVIDER_RETAINED_PERCENT[provider] : 0;
    providerShare = (gross * BigInt(percent)) / 100n;
  }
  return { grossUsdMicros: gross, providerUsdMicros: providerShare, basis };
}

/* ----------------------------------------------------------------- helpers */

/** The fee as it was taken, in its own asset: `0.012552 USDC`. */
function feeAmountText(fee: NonNullable<SolanaWalletAction["fee"]>): string | null {
  if (fee.amountRaw === null || fee.decimals === null) return null;
  const raw = BigInt(fee.amountRaw);
  const scale = 10n ** BigInt(fee.decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(fee.decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""} ${fee.symbol ?? ""}`.trim();
}

function feeRowOf(
  trade: SolanaWalletAction,
  provider: BusinessProvider | null,
  valued: FeeValuation,
  ledger: readonly RewardEntry[],
  volume: bigint | null,
  internal: boolean,
): BusinessFeeRow {
  let cashback = 0n;
  let referral = 0n;
  for (const entry of ledger) {
    if (entry.usdMicros === null) continue;
    const share = BigInt(entry.usdMicros);
    if (entry.type === "CASHBACK") cashback += share;
    else if (entry.type === "REFERRAL_L1" || entry.type === "REFERRAL_L2") referral += share;
  }
  const gross = valued.grossUsdMicros;
  const providerShare = valued.providerUsdMicros;
  const fee = trade.fee!;
  return {
    at: trade.updatedAt,
    wallet: maskWallet(trade.wallet),
    walletFull: trade.wallet,
    internal,
    kind: trade.lane === "CROSS_SWAP" ? "CROSS_SWAP" : isSpotOrigin(trade.origin) ? (trade.origin.side === "BUY" ? "SPOT_BUY" : "SPOT_SELL") : "SWAP",
    provider,
    route: routeOf(trade),
    volumeUsd: volume === null ? null : usd(volume),
    collected: fee.collected,
    feeText: feeAmountText(fee),
    basisPoints: fee.basisPoints,
    grossUsd: gross === null ? null : usd(gross),
    providerUsd: providerShare === null ? null : usd(providerShare),
    cashbackUsd: usd(cashback),
    referralUsd: usd(referral),
    ryntraNetUsd: gross === null || providerShare === null ? null : usd(gross - providerShare - cashback - referral),
    reference: trade.signature ?? trade.sourceTx ?? null,
  };
}

export function maskWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function usd(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

function measured(value: number): Cell {
  return { value, status: "measured" };
}

function cellFor(state: SourceState, value: number): Cell {
  return state === "measured" ? measured(value) : { value: undefined, status: state };
}

function isTrade(action: SolanaWalletAction): boolean {
  return action.lane === "SWAP" || action.lane === "CROSS_SWAP";
}

function inWindow(at: string, start: string | null, end: string): boolean {
  return (start === null || at >= start) && at <= end;
}

function providerOf(action: SolanaWalletAction, orders: ReadonlyMap<string, "MAYAN" | "RELAY">): BusinessProvider | null {
  switch (action.lane) {
    case "SWAP":
      return "JUPITER";
    case "CROSS_SWAP":
      return orders.get(action.actionId) ?? "RELAY";
    case "BRIDGE":
      return "CCTP";
    default:
      return null;
  }
}

const PROVIDER_LABEL: Record<BusinessProvider, string> = {
  JUPITER: "Jupiter",
  RELAY: "Relay",
  MAYAN: "Mayan",
  CCTP: "CCTP",
};

const PROVIDER_FEE_NOTE: Record<BusinessProvider, string | null> = {
  JUPITER: null,
  RELAY: null,
  MAYAN: "fee 0 — out of default routing, no fee mechanism used",
  CCTP: "fee 0 — Circle CCTP has no integrator fee",
};

const DESTINATION_NAME: Record<NonNullable<SolanaWalletAction["destination"]>, string> = {
  SOLANA: "Solana",
  BASE: "Base",
  ETHEREUM: "Ethereum",
  ROBINHOOD: "Robinhood Chain",
};

function symbolOf(movement: SolanaWalletAction["out"]): string | null {
  if (movement === null) return null;
  if (movement.symbol) return movement.symbol;
  if (movement.mint && BUSINESS_PAR_MINTS[movement.mint] !== undefined) {
    return movement.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : "USDT";
  }
  if (movement.mint === "So11111111111111111111111111111111111111112") return "SOL";
  return movement.mint ? `${movement.mint.slice(0, 4)}…` : null;
}

function routeOf(action: SolanaWalletAction): string | null {
  const out = symbolOf(action.out);
  const inn = symbolOf(action.in);
  const pair = out && inn ? `${out} → ${inn}` : (out ?? inn);
  if (action.lane === "CROSS_SWAP" || action.lane === "BRIDGE") {
    const to = action.destination ? DESTINATION_NAME[action.destination] : null;
    const from = action.destination === "SOLANA" ? null : "Solana";
    const chains = to ? (from ? `${from} → ${to}` : `→ ${to}`) : null;
    return [pair, chains].filter(Boolean).join(" · ") || null;
  }
  return pair;
}

function bucketKey(at: string, hourly: boolean): string {
  return hourly ? at.slice(0, 13) : at.slice(0, 10);
}

function bucketLabel(key: string, hourly: boolean): string {
  return hourly ? `${key.slice(11, 13)}:00` : key.slice(5, 10).replace("-", ".");
}

/* -------------------------------------------------------------- projection */

export function projectBusiness(input: BusinessInputs): BusinessModel {
  const { now, range, scope, sources } = input;
  const start = rangeStart(range, now);
  const internal = input.internalWallets;
  const isInternal = (wallet: string) => internal.has(wallet);
  const keep = (wallet: string) => scope === "all" || !isInternal(wallet);

  const orders = new Map(input.orders.map((order) => [order.intentDigest, order.provider] as const));
  const rewardsByRef = new Map<string, RewardEntry[]>();
  for (const entry of input.rewards) {
    if (!entry.source) continue;
    const list = rewardsByRef.get(entry.source.operationRef) ?? [];
    list.push(entry);
    rewardsByRef.set(entry.source.operationRef, list);
  }

  /* One row per action id: the ledger already guarantees this, and a
     malformed duplicate would count twice, so it is guaranteed again here. */
  const seen = new Set<string>();
  const actions = input.actions.filter((action) => {
    const key = `${action.network}:${action.wallet}:${action.actionId}`;
    if (seen.has(key) || action.network !== "mainnet" || !keep(action.wallet)) return false;
    seen.add(key);
    return true;
  });
  const rewards = input.rewards.filter((entry) => keep(entry.recipient) && (!entry.source || keep(entry.source.trader)));
  const edges = input.edges.filter((edge) => keep(edge.referrer) && keep(edge.wallet));
  const presence = input.presence.filter((row) => keep(row.wallet));

  const doneTrades = actions.filter((action) => isTrade(action) && action.outcome === "DONE");
  const firstTradeAt = new Map<string, string>();
  const tradeCount = new Map<string, number>();
  for (const trade of doneTrades) {
    const first = firstTradeAt.get(trade.wallet);
    if (!first || trade.startedAt < first) firstTradeAt.set(trade.wallet, trade.startedAt);
    tradeCount.set(trade.wallet, (tradeCount.get(trade.wallet) ?? 0) + 1);
  }

  const inRange = (at: string) => inWindow(at, start, now);
  const tradesInRange = doneTrades.filter((trade) => inRange(trade.startedAt));
  const failedInRange = actions.filter((action) => isTrade(action) && action.outcome === "FAILED" && inRange(action.startedAt));

  /* Trading. */
  const traders = new Set(tradesInRange.map((trade) => trade.wallet));
  let volume = 0n;
  let unvalued = 0;
  let spotTrades = 0;
  let spotVolume = 0n;
  for (const trade of tradesInRange) {
    const value = tradeUsdMicros(trade);
    if (value === null) unvalued += 1;
    else volume += value;
    /* Spot is a way of starting the same trade, not a second ledger: the row
       is counted once above and once more here, as the Spot share. */
    if (isSpotOrigin(trade.origin)) {
      spotTrades += 1;
      if (value !== null) spotVolume += value;
    }
  }
  const newTraders = [...traders].filter((wallet) => inRange(firstTradeAt.get(wallet) ?? "")).length;
  const returningTraders = [...traders].filter((wallet) => (tradeCount.get(wallet) ?? 0) >= 2).length;

  /* Revenue, from the fee each finished trade carries. */
  let gross = 0n;
  let providerShare = 0n;
  let unvaluedFees = 0;
  let feesNotRecorded = 0;
  const providerTotals = new Map<BusinessProvider, { operations: number; volume: bigint; unvalued: number; gross: bigint; net: bigint }>();
  const bump = (provider: BusinessProvider) => {
    const row = providerTotals.get(provider) ?? { operations: 0, volume: 0n, unvalued: 0, gross: 0n, net: 0n };
    providerTotals.set(provider, row);
    return row;
  };
  const feeRows: BusinessFeeRow[] = [];
  for (const trade of tradesInRange) {
    const provider = providerOf(trade, orders);
    const row = provider ? bump(provider) : null;
    const value = tradeUsdMicros(trade);
    if (row) {
      row.operations += 1;
      if (value === null) row.unvalued += 1;
      else row.volume += value;
    }
    if (!trade.fee) {
      feesNotRecorded += 1;
      continue;
    }
    const ledger = operationRefsOf(trade).flatMap((ref) => rewardsByRef.get(ref) ?? []);
    const valued = feeValuation(trade, provider, ledger);
    if (!valued) continue;
    feeRows.push(feeRowOf(trade, provider, valued, ledger, value, internal.has(trade.wallet)));
    if (valued.grossUsdMicros === null || valued.providerUsdMicros === null) {
      unvaluedFees += 1;
      continue;
    }
    gross += valued.grossUsdMicros;
    providerShare += valued.providerUsdMicros;
    if (row) {
      row.gross += valued.grossUsdMicros;
      row.net += valued.grossUsdMicros - valued.providerUsdMicros;
    }
  }
  /* CCTP transfers sit in the provider table as operations with a true zero
     fee, and are not trades. */
  for (const action of actions) {
    if (action.lane !== "BRIDGE" || action.outcome !== "DONE" || !inRange(action.startedAt)) continue;
    const row = bump("CCTP");
    row.operations += 1;
    const value = tradeUsdMicros(action);
    if (value === null) row.unvalued += 1;
    else row.volume += value;
  }

  /* Rewards: what the range accrued and paid, and the balance still owed. */
  let accrued = 0n;
  let claimed = 0n;
  let entries = 0;
  let claims = 0;
  let lifetime = 0n;
  let paid = 0n;
  let cashback = 0n;
  let referralL1 = 0n;
  let referralL2 = 0n;
  for (const entry of rewards) {
    if (entry.usdMicros === null) continue;
    const value = BigInt(entry.usdMicros);
    if (entry.type === "CLAIM") {
      paid -= value;
      if (inRange(entry.createdAt)) {
        claimed -= value;
        claims += 1;
      }
      continue;
    }
    lifetime += value;
    if (!inRange(entry.createdAt)) continue;
    accrued += value;
    entries += 1;
    if (entry.type === "CASHBACK") cashback += value;
    else if (entry.type === "REFERRAL_L1") referralL1 += value;
    else if (entry.type === "REFERRAL_L2") referralL2 += value;
  }
  const net = gross - providerShare;
  const retained = net - cashback - referralL1 - referralL2;

  /* Referrals confirmed in the range. */
  const level1 = edges.filter((edge) => edge.level === 1 && inRange(edge.at)).length;
  const level2 = edges.filter((edge) => edge.level === 2 && inRange(edge.at)).length;

  /* Audience. */
  const connected = presence.filter((row) => inRange(row.lastSeenAt)).length;
  const verified = presence.filter((row) => row.lastVerifiedAt !== null && inRange(row.lastVerifiedAt)).length;
  const firstSeen = new Map<string, string>();
  const noteFirst = (wallet: string, at: string | null) => {
    if (!at) return;
    const current = firstSeen.get(wallet);
    if (!current || at < current) firstSeen.set(wallet, at);
  };
  for (const row of presence) {
    noteFirst(row.wallet, row.firstSeenAt);
    noteFirst(row.wallet, row.firstVerifiedAt);
  }
  for (const action of actions) noteFirst(action.wallet, action.startedAt);
  const newWallets = [...firstSeen.values()].filter((at) => inRange(at)).length;
  const activeWallets = new Set<string>();
  for (const action of actions) {
    if (action.outcome === "DONE" && inRange(action.startedAt)) activeWallets.add(action.wallet);
  }
  for (const entry of rewards) {
    if (entry.type === "CLAIM" && inRange(entry.createdAt)) activeWallets.add(entry.recipient);
  }

  /* Funnel, unique wallets in the range; the first step is not measured. A
     wallet stands on the trade step when it finished a trade in the window,
     and on the repeat step when that was not its only trade ever — the same
     people as `traders` and `returningTraders` above, read as a path. */
  const funnel: BusinessFunnelStep[] = [
    { id: "visited", wallets: { value: undefined, status: "not_collected" } },
    { id: "connected", wallets: cellFor(sources.presence, connected) },
    { id: "verified", wallets: cellFor(sources.presence, verified) },
    { id: "first_trade", wallets: cellFor(sources.actions, traders.size) },
    { id: "repeat_trade", wallets: cellFor(sources.actions, returningTraders) },
  ];

  /* Charts: hourly for a day, daily otherwise, the last 30 days for all time. */
  const hourly = range === "24h";
  const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const bucketStart = Date.parse(now) - (hourly ? (bucketCount - 1) * HOUR_MS : (bucketCount - 1) * DAY_MS);
  const buckets = new Map<string, { activeWallets: Set<string>; traders: Set<string>; trades: number; volume: bigint; revenue: bigint }>();
  for (let index = 0; index < bucketCount; index += 1) {
    const at = new Date(bucketStart + index * (hourly ? HOUR_MS : DAY_MS)).toISOString();
    buckets.set(bucketKey(at, hourly), { activeWallets: new Set(), traders: new Set(), trades: 0, volume: 0n, revenue: 0n });
  }
  for (const action of actions) {
    if (action.outcome !== "DONE") continue;
    const bucket = buckets.get(bucketKey(action.startedAt, hourly));
    if (!bucket) continue;
    bucket.activeWallets.add(action.wallet);
    if (!isTrade(action)) continue;
    bucket.traders.add(action.wallet);
    bucket.trades += 1;
    const value = tradeUsdMicros(action);
    if (value !== null) bucket.volume += value;
    if (action.fee) {
      const provider = providerOf(action, orders);
      const valued = feeValuation(action, provider, operationRefsOf(action).flatMap((ref) => rewardsByRef.get(ref) ?? []));
      if (valued && valued.grossUsdMicros !== null && valued.providerUsdMicros !== null) {
        bucket.revenue += valued.grossUsdMicros - valued.providerUsdMicros;
      }
    }
  }
  const bucketRows: BusinessBucket[] = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucketLabel(key, hourly),
    activeWallets: bucket.activeWallets.size,
    traders: bucket.traders.size,
    trades: bucket.trades,
    volumeUsd: usd(bucket.volume),
    revenueUsd: usd(bucket.revenue),
  }));

  /* Provider table, in a fixed order so an empty provider still has a row. */
  const providers: BusinessProviderRow[] = (["JUPITER", "RELAY", "MAYAN", "CCTP"] as const).map((id) => {
    const row = providerTotals.get(id);
    return {
      id,
      label: PROVIDER_LABEL[id],
      operations: row?.operations ?? 0,
      volumeUsd: usd(row?.volume ?? 0n),
      unvalued: row?.unvalued ?? 0,
      grossUsd: usd(row?.gross ?? 0n),
      ryntraNetUsd: usd(row?.net ?? 0n),
      feeNote: PROVIDER_FEE_NOTE[id],
    };
  });

  /* The feed: the newest thirty facts across every source, internal ones marked. */
  const feed: BusinessFeedItem[] = [];
  for (const action of actions) {
    const provider = providerOf(action, orders);
    const status: BusinessFeedStatus = action.outcome;
    /* A failed operation moved nothing, so the row carries no value: the
       amount that was attempted is not an amount that happened. */
    const value = action.outcome === "FAILED" ? null : tradeUsdMicros(action);
    feed.push({
      at: action.startedAt,
      kind: isSpotOrigin(action.origin) ? (action.origin.side === "BUY" ? "SPOT_BUY" : "SPOT_SELL") : action.lane,
      wallet: maskWallet(action.wallet),
      walletFull: action.wallet,
      internal: isInternal(action.wallet),
      route: routeOf(action),
      valueUsd: value === null ? null : usd(value),
      provider,
      status,
      reference: action.signature ?? action.sourceTx ?? action.destinationTx ?? null,
    });
  }
  for (const row of presence) {
    if (row.lastVerifiedAt === null) continue;
    feed.push({
      at: row.lastVerifiedAt,
      kind: "WALLET_VERIFIED",
      wallet: maskWallet(row.wallet),
      walletFull: row.wallet,
      internal: isInternal(row.wallet),
      route: null,
      valueUsd: null,
      provider: null,
      status: "INFO",
      reference: null,
    });
  }
  for (const edge of edges) {
    feed.push({
      at: edge.at,
      kind: "REFERRAL",
      wallet: maskWallet(edge.referrer),
      walletFull: edge.referrer,
      internal: isInternal(edge.referrer) || isInternal(edge.wallet),
      route: `Level ${edge.level}`,
      valueUsd: null,
      provider: null,
      status: "INFO",
      reference: null,
    });
  }
  for (const entry of rewards) {
    if (entry.usdMicros === null) continue;
    const value = BigInt(entry.usdMicros);
    const isClaim = entry.type === "CLAIM";
    feed.push({
      at: entry.createdAt,
      kind: isClaim ? "CLAIM" : "REWARD",
      wallet: maskWallet(entry.recipient),
      walletFull: entry.recipient,
      internal: isInternal(entry.recipient),
      route: isClaim ? null : entry.type === "CASHBACK" ? "Cashback" : entry.type === "REFERRAL_L1" ? "Referral L1" : entry.type === "REFERRAL_L2" ? "Referral L2" : "Adjustment",
      valueUsd: usd(isClaim ? -value : value),
      provider: null,
      status: isClaim ? "DONE" : "INFO",
      reference: entry.signature,
    });
  }
  feed.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  const recent = feed.slice(0, 30);

  /* Last seen, over everything in scope rather than the range. */
  const lastOf = (rows: readonly { at: string; wallet: string }[]): BusinessLastSeen => {
    let best: { at: string; wallet: string } | null = null;
    for (const row of rows) if (!best || row.at > best.at) best = row;
    return best ? { at: best.at, wallet: maskWallet(best.wallet), internal: isInternal(best.wallet) } : { at: null, wallet: null, internal: false };
  };
  const lastSeen = {
    visitor: { at: null, wallet: null, internal: false, status: "not_collected" as const },
    connected: lastOf(presence.map((row) => ({ at: row.lastSeenAt, wallet: row.wallet }))),
    verified: lastOf(presence.filter((row) => row.lastVerifiedAt !== null).map((row) => ({ at: row.lastVerifiedAt as string, wallet: row.wallet }))),
    trade: lastOf(doneTrades.map((trade) => ({ at: trade.startedAt, wallet: trade.wallet }))),
    referral: lastOf(edges.map((edge) => ({ at: edge.at, wallet: edge.referrer }))),
  };

  const earliest = (values: readonly string[]): string | null => (values.length === 0 ? null : values.reduce((min, value) => (value < min ? value : min)));

  return {
    generatedAt: now,
    range,
    scope,
    windowStart: start,
    internalWallets: internal.size,
    sources,
    coverage: {
      actionsSince: earliest(input.actions.map((action) => action.startedAt)),
      presenceSince: earliest(input.presence.map((row) => row.firstSeenAt)),
      rewardsSince: input.rewardsSince,
    },
    lastSeen,
    audience: {
      visitors: { value: undefined, status: "not_collected" },
      connected: cellFor(sources.presence, connected),
      verified: cellFor(sources.presence, verified),
      newWallets: cellFor(sources.actions === "measured" || sources.presence === "measured" ? "measured" : sources.actions, newWallets),
      active: cellFor(sources.actions, activeWallets.size),
    },
    trading: {
      traders: cellFor(sources.actions, traders.size),
      trades: cellFor(sources.actions, tradesInRange.length),
      volumeUsd: cellFor(sources.actions, usd(volume)),
      spotTrades: cellFor(sources.actions, spotTrades),
      spotVolumeUsd: cellFor(sources.actions, usd(spotVolume)),
      unvalued,
      failed: cellFor(sources.actions, failedInRange.length),
      newTraders: cellFor(sources.actions, newTraders),
      returningTraders: cellFor(sources.actions, returningTraders),
      repeatRate: traders.size > 0 ? { value: returningTraders / traders.size, status: "measured", n: traders.size } : { value: undefined, status: sources.actions === "measured" ? "insufficient" : sources.actions, n: 0 },
    },
    revenue: {
      grossUsd: cellFor(sources.actions, usd(gross)),
      providerUsd: cellFor(sources.actions, usd(providerShare)),
      netBeforeRewardsUsd: cellFor(sources.actions, usd(net)),
      cashbackUsd: cellFor(sources.rewards, usd(cashback)),
      referralL1Usd: cellFor(sources.rewards, usd(referralL1)),
      referralL2Usd: cellFor(sources.rewards, usd(referralL2)),
      retainedUsd: cellFor(sources.actions === "measured" && sources.rewards === "measured" ? "measured" : sources.actions === "measured" ? sources.rewards : sources.actions, usd(retained)),
      unvaluedFees,
      feesNotRecorded,
    },
    rewards: {
      accruedUsd: cellFor(sources.rewards, usd(accrued)),
      claimedUsd: cellFor(sources.rewards, usd(claimed)),
      outstandingUsd: cellFor(sources.rewards, usd(lifetime - paid)),
      entries,
      claims,
    },
    referrals: {
      level1: cellFor(sources.rewards, level1),
      level2: cellFor(sources.rewards, level2),
    },
    providers,
    funnel,
    buckets: bucketRows,
    recent,
    fees: feeRows.sort((left, right) => right.at.localeCompare(left.at)),
  };
}
