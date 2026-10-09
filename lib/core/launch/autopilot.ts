/**
 * Ryntra Autopilot on a launched token — what it does after the curve, and the
 * flight log that shows it.
 *
 * Three things run by Ryntra's executor wallet, and nothing else:
 * - **the graduation** — the moment the curve holds its threshold, the
 *   executor sends Meteora's migration to the DAMM v2 pool; anyone may send it
 *   (Meteora's own keepers too), so the log names whoever did; one that failed
 *   is sent again by the executor itself;
 * - **the Fee-Funded Liquidity Ladder** — part of what Ryntra earned as the partner on this
 *   token (`FLOOR_RULE.budgetShareBps` of it, never more than the executor
 *   holds) placed as buy liquidity in a DLMM pool, in steps below the price,
 *   and moved up after the price, never down. It holds no price and promises
 *   none: it is liquidity, and what it buys it holds;
 * - **the log** — every one of these with its time, its amount and its
 *   transaction, beside the token's own events: the launch, the creator's
 *   lock, the creator's sales — and the market's states and the executor's
 *   own watch, stops and resumes (`JournalMark`).
 *
 * The executor never takes the partner's fees — they go to the partner's
 * multisig, on the curve and from the locked LP — and pays no holder anything.
 *
 * Pure and client-safe: the chain is read by `lib/launch/autopilot.server.ts`
 * and the DLMM adapter.
 */

import type { CreatorFeesRead } from "./creator-earnings.ts";
import type { MarketCycleState } from "./market-health.ts";

/**
 * The Fee-Funded Liquidity Ladder on a graduated token — one rule for every launch:
 * - a DLMM pool of the token and the pair currency, steps of 1 % (`binStep`
 *   100), its fee 1 %, collected in the pair currency;
 * - the steps start `topGapBins` below the price and go `depthBins` deep —
 *   from about −5 % to about −39 % — the same amount on each (the «Spot»
 *   shape);
 * - they move up once the price has held at least `raiseStepBins` steps above
 *   the level they were set for, on two reads `raiseConfirmSeconds` apart —
 *   the first no older than `seenMaxAgeSeconds` — and only while they hold
 *   nothing but the pair currency (nothing bought is sold at a loss to move
 *   them);
 * - the price they are set from is the lower of the pool's price now and the
 *   median of the executor's own reads of it over `referenceWindowSeconds` —
 *   one read at most every `sampleSpacingSeconds`, and the first placement only
 *   after `placeSamples` reads spanning `placeSpanSeconds` — so a price pushed
 *   up for a moment does not lift them;
 * - the amount is `budgetShareBps` of the partner's fees on this token, less
 *   what was already placed, never more than the executor's free balance, and
 *   nothing below `minPlaceRaw`.
 */
export const FLOOR_RULE = Object.freeze({
  binStep: 100,
  feeBps: 100,
  topGapBins: 5,
  depthBins: 45,
  raiseStepBins: 10,
  raiseConfirmSeconds: 5 * 60,
  seenMaxAgeSeconds: 15 * 60,
  referenceWindowSeconds: 30 * 60,
  sampleSpacingSeconds: 45,
  placeSamples: 5,
  placeSpanSeconds: 10 * 60,
  budgetShareBps: 2500,
  /** 10 USDC: below it the rent of the steps costs more than the liquidity is worth. */
  minPlaceRaw: 10_000_000n,
});

/** The DLMM bin a price sits in: the bin whose price is at or below it. */
export function binOfPrice(price: number, binStep: number, decimalsX: number, decimalsY: number): number {
  if (!(price > 0) || !Number.isFinite(price)) throw new Error("A bin needs a positive price.");
  const perLamport = price * 10 ** (decimalsY - decimalsX);
  /* A hair above the exact power so a price that is one bin exactly is that bin, not the one below. */
  return Math.floor(Math.log(perLamport) / Math.log(1 + binStep / 10_000) + 1e-9);
}

/** The price of a DLMM bin, in the pair currency per token. */
export function priceOfBin(binId: number, binStep: number, decimalsX: number, decimalsY: number): number {
  return (1 + binStep / 10_000) ** binId * 10 ** (decimalsX - decimalsY);
}

export type FloorLadder = Readonly<{ lowerBinId: number; upperBinId: number }>;

/** The steps for a price's bin: from `topGapBins` below it, `depthBins` deep. */
export function floorLadder(marketBinId: number): FloorLadder {
  const upperBinId = marketBinId - FLOOR_RULE.topGapBins;
  return { lowerBinId: upperBinId - FLOOR_RULE.depthBins + 1, upperBinId };
}

/** One read of the price's bin by the executor, unix seconds. */
export type FloorSample = Readonly<{ at: number; bin: number }>;

/** The window's reads with this one added — none closer than the rule's spacing to the last, none older than the window. */
export function addSample(samples: readonly FloorSample[], at: number, bin: number): FloorSample[] {
  const kept = samples.filter((sample) => sample.at >= at - FLOOR_RULE.referenceWindowSeconds && sample.at <= at);
  const last = kept.at(-1);
  if (last && at - last.at < FLOOR_RULE.sampleSpacingSeconds) return kept;
  return [...kept, { at, bin }].slice(-120);
}

/** Whether the reads are enough for a first placement: the rule's number of them, spanning the rule's time. */
export function readyToPlace(samples: readonly FloorSample[], at: number): boolean {
  const kept = samples.filter((sample) => sample.at >= at - FLOOR_RULE.referenceWindowSeconds);
  return kept.length >= FLOOR_RULE.placeSamples && kept.at(-1)!.at - kept[0]!.at >= FLOOR_RULE.placeSpanSeconds;
}

/**
 * The bin the steps are set from: the lower of the price's bin now and the median of the window's reads (the lower
 * middle of an even count) — a price that held, not a moment's. With fewer than three reads, the bin now.
 */
export function referenceBin(marketBin: number, samples: readonly FloorSample[]): number {
  if (samples.length < 3) return marketBin;
  const bins = samples.map((sample) => sample.bin).sort((a, b) => a - b);
  return Math.min(marketBin, bins[Math.floor((bins.length - 1) / 2)]!);
}

export type RaiseDecision =
  | Readonly<{ raise: false; seen: Readonly<{ at: number; marketBinId: number }> | null }>
  | Readonly<{ raise: true; ladder: FloorLadder }>;

/**
 * Whether to move the steps up now. The price must stand `raiseStepBins` above the level the steps were set for, and
 * have stood there on a read at least `raiseConfirmSeconds` before this one; the steps must hold none of the token —
 * what they bought stays where it was bought. Never down.
 */
export function floorRaise(args: Readonly<{
  ladder: FloorLadder;
  marketBinId: number;
  holdsToken: boolean;
  seen: Readonly<{ at: number; marketBinId: number }> | null;
  at: number;
}>): RaiseDecision {
  const next = floorLadder(args.marketBinId);
  const high = next.upperBinId >= args.ladder.upperBinId + FLOOR_RULE.raiseStepBins;
  if (!high || args.holdsToken) return { raise: false, seen: null };
  /* A first read too old is no confirmation: a price seen long ago and a spike now are not a price that held. */
  const seen = args.seen !== null && args.at - args.seen.at <= FLOOR_RULE.seenMaxAgeSeconds ? args.seen : null;
  const confirmed = seen !== null && args.at - seen.at >= FLOOR_RULE.raiseConfirmSeconds && floorLadder(seen.marketBinId).upperBinId >= args.ladder.upperBinId + FLOOR_RULE.raiseStepBins;
  if (!confirmed) return { raise: false, seen: seen ?? { at: args.at, marketBinId: args.marketBinId } };
  /* The lower of the two reads: the price held at least there. */
  return { raise: true, ladder: floorLadder(Math.min(args.marketBinId, seen.marketBinId)) };
}

/** What Ryntra earned as the partner on a launch: its part of the curve's trading fee and of the graduation fee. */
export function partnerEarnedRaw(read: Pick<CreatorFeesRead, "curve" | "graduation">): bigint {
  const curve = (BigInt(read.curve.totalTradingRaw) * BigInt(100 - read.curve.creatorPct)) / 100n;
  if (!read.graduation.migrated) return curve;
  const threshold = BigInt(read.graduation.thresholdRaw);
  const fee = threshold - (threshold * BigInt(100 - read.graduation.feePct)) / 100n;
  return curve + (fee * BigInt(100 - read.graduation.creatorPct)) / 100n;
}

/** What may be placed now: the rule's share of the partner's fees, less what was placed, within the free balance; 0 below the minimum. */
export function floorBudgetRaw(args: Readonly<{ partnerEarnedRaw: bigint; placedRaw: bigint; freeRaw: bigint }>): bigint {
  const share = (args.partnerEarnedRaw * BigInt(FLOOR_RULE.budgetShareBps)) / 10_000n - args.placedRaw;
  const amount = share < args.freeRaw ? share : args.freeRaw;
  return amount >= FLOOR_RULE.minPlaceRaw ? amount : 0n;
}

/** Meteora's migration keepers on mainnet (its documentation, 2026-10-07): a graduation they sent is Meteora's. */
export const METEORA_MIGRATION_KEEPERS = Object.freeze(["Asi5DTGEeiso6k7ya6ndDabEZ7DRCgfTpCBLPH5E3aQs", "DeQ8dPv6ReZNQ45NfiWwS5CchWpB2BVq1QMyNV8L2uSW"]);

export const JOURNAL_KINDS = ["LAUNCHED", "CREATOR_LOCKED", "FEES_SHARED", "CREATOR_SOLD", "GRADUATED", "FLOOR_POOL", "FLOOR_PLACED", "FLOOR_WITHDRAWN", "FLOOR_RAISED", "FLOOR_ADDED"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** Who did it: the creator, Ryntra's executor, Meteora's keeper, or another wallet. */
export const JOURNAL_ACTORS = ["creator", "ryntra", "meteora", "other"] as const;
export type JournalActor = (typeof JOURNAL_ACTORS)[number];

export type JournalEvent = Readonly<{
  kind: JournalKind;
  /** ISO time from the chain (the block's); null only where the chain gave none. */
  at: string | null;
  signature: string;
  actor: JournalActor;
  /** The pair currency moved (raw), when the event moved any. */
  pairRaw: string | null;
  /** The token moved (raw), when the event moved any. */
  tokensRaw: string | null;
  /** The steps' prices, low and high, for Ryntra's liquidity. */
  priceLow: number | null;
  priceHigh: number | null;
  /** For a sale of the creator's: the share of what they bought sold so far, in basis points (of the supply when they sold more than they bought here). */
  soldBps: number | null;
  soldOf: "bought" | "supply" | null;
}>;

const event = (fields: Partial<JournalEvent> & Pick<JournalEvent, "kind" | "at" | "signature" | "actor">): JournalEvent => ({
  pairRaw: null,
  tokensRaw: null,
  priceLow: null,
  priceHigh: null,
  soldBps: null,
  soldOf: null,
  ...fields,
});

export type CreatorTradeSeen = Readonly<{ signature: string; at: number; side: "buy" | "sell"; tokensRaw: string; pairRaw: string }>;

/**
 * «Творець продав» as log events — each sale of the creator's, with the share of what they bought sold by then. What
 * they bought counts their first purchase and every later buy; sold beyond it, the share is of the supply.
 */
export function creatorSoldEvents(trades: readonly CreatorTradeSeen[], supplyRaw: bigint): JournalEvent[] {
  let bought = 0n;
  let sold = 0n;
  /* One transaction is one entry: several sales inside it are added up, in the order the transactions came. */
  const byTransaction = new Map<string, { at: number; side: "buy" | "sell"; tokens: bigint; pair: bigint; first: number }>();
  [...trades].forEach((trade, index) => {
    const key = `${trade.signature}:${trade.side}`;
    const known = byTransaction.get(key);
    if (known) {
      known.tokens += BigInt(trade.tokensRaw);
      known.pair += BigInt(trade.pairRaw);
    } else byTransaction.set(key, { at: trade.at, side: trade.side, tokens: BigInt(trade.tokensRaw), pair: BigInt(trade.pairRaw), first: index });
  });
  const ordered = [...byTransaction.entries()].sort((a, b) => a[1].at - b[1].at || a[1].first - b[1].first);
  const out: JournalEvent[] = [];
  for (const [key, trade] of ordered) {
    if (trade.side === "buy") {
      bought += trade.tokens;
      continue;
    }
    sold += trade.tokens;
    const ofBought = bought > 0n && sold <= bought;
    const whole = ofBought ? bought : supplyRaw;
    const bps = whole > 0n ? Number((sold * 10_000n) / whole) : 0;
    out.push(event({ kind: "CREATOR_SOLD", at: new Date(trade.at * 1000).toISOString(), signature: key.slice(0, key.lastIndexOf(":")), actor: "creator", tokensRaw: trade.tokens.toString(), pairRaw: trade.pair.toString(), soldBps: bps, soldOf: ofBought ? "bought" : "supply" }));
  }
  return out;
}

/** Who sent a graduation: Ryntra's executor, a Meteora keeper, or another wallet — from the transaction's fee payer. */
export function graduationActor(feePayer: string, executor: string | null): JournalActor {
  if (executor !== null && feePayer === executor) return "ryntra";
  if (METEORA_MIGRATION_KEEPERS.includes(feePayer)) return "meteora";
  return "other";
}

/**
 * What governs each kind of entry: a rule a program enforces — the curve's config fixed for ever, a lock, the fee-sharing
 * vault, Meteora's migration that anyone may send — or a policy Ryntra's server runs — its liquidity; null for what the
 * log observes of the market: a sale of the creator's is a fact, not an act under a rule.
 */
export const JOURNAL_ENFORCEMENT: Readonly<Record<JournalKind, "rule" | "policy" | null>> = Object.freeze({
  LAUNCHED: "rule",
  CREATOR_LOCKED: "rule",
  FEES_SHARED: "rule",
  CREATOR_SOLD: null,
  GRADUATED: "rule",
  FLOOR_POOL: "policy",
  FLOOR_PLACED: "policy",
  FLOOR_WITHDRAWN: "policy",
  FLOOR_RAISED: "policy",
  FLOOR_ADDED: "policy",
});

/** The log in time order, the newest first; one entry per transaction and kind. */
export function journal(events: readonly JournalEvent[]): JournalEvent[] {
  const seen = new Set<string>();
  const out: JournalEvent[] = [];
  for (const entry of events) {
    const key = `${entry.kind}:${entry.signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  /* On the same second the entry written later — the lock after its launch — stands above. */
  return out
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (Date.parse(b.entry.at ?? "") || 0) - (Date.parse(a.entry.at ?? "") || 0) || b.index - a.index)
    .map(({ entry }) => entry);
}

export { event as journalEvent };

/* ------------------------------------------------------------ the executor's own marks */

/**
 * What the flight log notes beside the chain's own events — none of it a transaction of its own:
 * - `WATCH_STARTED` — the executor's first pass over this market: from now on it acts here by its rules;
 * - `STATE` — the market moved into another state of its cycle, as the executor read it (the trigger is the
 *   transaction it rests on, when there is one);
 * - `STOPPED` / `RESUMED` — the operator's switch, for this market or for every market: while stopped, the executor
 *   signs nothing here;
 * - `GRADUATION_FAILED` — the executor's graduation of a full curve was refused, failed or expired unseen; it is sent
 *   again by the executor itself.
 * A pass that changes nothing writes nothing.
 */
export const JOURNAL_MARK_KINDS = ["WATCH_STARTED", "STATE", "STOPPED", "RESUMED", "GRADUATION_FAILED"] as const;
export type JournalMarkKind = (typeof JOURNAL_MARK_KINDS)[number];

/** Who wrote it: Ryntra's executor, or Ryntra's operator at the switch. */
export const JOURNAL_MARK_ACTORS = ["ryntra", "operator"] as const;
export type JournalMarkActor = (typeof JOURNAL_MARK_ACTORS)[number];

export type JournalMark = Readonly<{
  kind: JournalMarkKind;
  /** ISO time the executor or the operator wrote it. */
  at: string;
  actor: JournalMarkActor;
  /** The state the market moved into; null when the mark names none (a resume, a watch over a market still on its curve). */
  state: MarketCycleState | null;
  /** The state it left; null for the first one the log knows. */
  from: MarketCycleState | null;
  /** The transaction it rests on — the graduation, the ladder placed or moved, a failed attempt; null when there is none. */
  signature: string | null;
  /** A switch's reach: this market alone, or every market. */
  scope: "market" | "all" | null;
  /** The budget the market got, raw in the pair currency; null for every other mark. */
  pairRaw: string | null;
}>;

/**
 * The states the executor writes down as it reads them: from the move to the DEX on. The states on the curve are the
 * curve's own, seen in its trades; a pause is the switch's own mark.
 */
export const EXECUTOR_JOURNALED_STATES: ReadonlySet<MarketCycleState> = new Set<MarketCycleState>([
  "MIGRATING",
  "MIGRATION_FAILED",
  "CORE_MARKET_LIVE",
  "ENDOWMENT_FUNDED",
  "LADDER_ACTIVE",
  "MAINTAINING",
  "MATURE",
  "ENDOWMENT_EXHAUSTED",
]);

/** The longest a failed graduation waits before the executor sends it again. */
export const GRADUATION_RETRY_MAX_SECONDS = 30 * 60;

/**
 * How long after its last failure a graduation is sent again: at once after the first, then twice as long after each
 * further failure in a row — two, four, eight minutes — up to half an hour, so a curve that cannot move does not spend
 * the executor's SOL every minute. A graduation sent by anyone else ends the wait.
 */
export function graduationRetryDelaySeconds(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 1) return 0;
  return Math.min(60 * 2 ** (Math.floor(failures) - 1), GRADUATION_RETRY_MAX_SECONDS);
}
