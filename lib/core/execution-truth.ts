/**
 * Execution truth (SOL-X1) — what a trade through Ryntra actually did, read
 * off the trade's own signed receipt facts and nothing else.
 *
 *     receipt facts → received · the quote · the least promised
 *                   → the same route without Ryntra's fee
 *                   → Ryntra's fee (charged, kept, the provider's share)
 *                   → the protocol's part · the network · a tip
 *
 * Read-only by construction: it takes what `buildSwapReceiptFacts` and the
 * launch trade receipt already signed, and it changes no rate, no route and no
 * receipt. Where a figure is not in the facts it says so (`null` with a
 * reason), never a guess dressed as a reading.
 *
 * ## «The same route without Ryntra's fee»
 *
 * Ryntra's fee leaves a swap on one side. Taken from what arrived (`/build`'s
 * output side, a referral in the output mint), the same route would have
 * delivered exactly what arrived plus the fee: `EXACT`. Taken from what was
 * spent, the route priced a smaller amount; scaling what arrived by the whole
 * amount over the priced one is `ESTIMATE` — an upper bound, since a larger
 * trade moves the price more, so it never understates what the fee cost. On
 * Jupiter's `/order` lane even a fee from what arrived is `ESTIMATE`: without
 * Ryntra's referral Jupiter charges its own default platform fee on the same
 * order, so «what arrived plus Ryntra's fee» is the most the route would have
 * delivered, not exactly it (`orderDefaultFee`). A trade Ryntra took nothing
 * from is `SAME`: the pool's own fee is paid the same way through any
 * interface. This is the same Jupiter route, not jup.ag's own interface, which
 * charges a fee of its own (`fee-comparison.ts`).
 *
 * Pure and client-safe: no clock, no network, no `process.env`.
 */

import type { LaunchTradeReceiptFacts } from "./venues/meteora-dbc/trade-receipt.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";

/**
 * The part of a swap's signed facts (`SwapReceiptFacts`, lib/solana/swap-receipt.ts) this reads — named here so a
 * browser can read it without the receipt builder's server code. The full facts satisfy it.
 */
export type SwapTruthFacts = Readonly<{
  quote: Readonly<{ inputMint: string; outputMint: string; inputRaw: string; outputRaw: string; minimumOutputRaw: string }>;
  fees: Readonly<{
    platform: Readonly<{ basisPoints: number }>;
    referral: Readonly<{ basisPoints: number; mint: string | null; amountRaw: string | null }>;
    serviceFee?: RyntraServiceFee | undefined;
  }>;
  provider: unknown;
  independentObservation: Readonly<{ signature: string; actualInputRaw: string; actualOutputRaw: string; baseFeeLamports: string; priorityFeeLamports: string }>;
  reconciliation: Readonly<{ minimumMet: boolean; deviations: readonly string[] }>;
}>;

export type TruthAmount = Readonly<{ raw: string; mint: string }>;

export type DirectRoute = Readonly<{
  /** What the same route would have delivered without Ryntra's fee, raw units of the received mint. */
  raw: string;
  basis: "EXACT" | "ESTIMATE" | "SAME";
  /** `raw` less what arrived: what the fee cost, in the received mint. Never negative. */
  gapRaw: string;
  /** The same as basis points of `raw`; null when `raw` is nothing. */
  gapBps: number | null;
  /**
   * True on `/order` when Ryntra's fee was taken: without Ryntra's referral Jupiter applies its own default platform fee
   * to the same order, so `raw` is an upper bound (`ESTIMATE`) even where the fee left what arrived.
   */
  orderDefaultFee?: true;
}>;

/**
 * Why the same route without Ryntra's fee is not sized, carried to the receipt's words:
 * - `FEE_AMOUNT_UNREAD` — the fee was charged or quoted and its amount is not read from the chain;
 * - `FEE_MINT_UNSTATED` — the fee's amount is known, the token it left in is not;
 * - `FEE_IN_THIRD_TOKEN` — the fee left in a token that is neither what was spent nor what arrived;
 * - `FEE_NOT_BELOW_SPENT` — the fee is not less than the amount the route priced, so no scale is honest.
 */
export type DirectNotSized = "FEE_AMOUNT_UNREAD" | "FEE_MINT_UNSTATED" | "FEE_IN_THIRD_TOKEN" | "FEE_NOT_BELOW_SPENT";

/**
 * Ryntra's fee as the chain settled it.
 *
 * - `CHARGED` — the chain shows the fee arriving; `paidRaw` is what the person paid.
 * - `NOT_CHARGED` — asked for, and the chain shows nothing arriving: the person paid none of it.
 * - `NONE` — this trade carries no Ryntra fee (a stable pair, a rate under a provider's minimum, a launch's token page).
 * - `UNREAD` — quoted, and the chain read that would settle it was not made: what was paid is not known.
 */
export type TruthRyntraFee = Readonly<{
  state: "CHARGED" | "NOT_CHARGED" | "NONE" | "UNREAD";
  bps: number;
  mint: string | null;
  paidRaw: string | null;
  /** What reached Ryntra, after the provider's share. */
  keptRaw: string | null;
  /** The provider's share of the same fee — part of what the person paid, not on top of it. */
  providerRaw: string | null;
  providerPercent: number | null;
}>;

export type TruthProtocol = Readonly<{
  /** Jupiter's own fee beyond Ryntra's, basis points; 0 on `/build`, null when the facts do not state Jupiter's total. */
  jupiterBps: number | null;
  /** A launch's pool fee, raw units of the pair currency, every part of it; null on a swap (pool fees are inside the route's price). */
  poolFeeRaw: string | null;
  /** Ryntra's part of that pool fee — the partner's share and the referral, inside the fee rather than on top of it. */
  poolRyntraRaw: string | null;
  /** The pair currency a launch's pool fee is stated in. */
  poolMint: string | null;
}>;

export type TruthNetwork = Readonly<{
  /** The base fee the chain charged, lamports; null where the facts do not carry it. */
  baseLamports: string | null;
  priorityLamports: string | null;
  /**
   * A tip to a block builder. `0` where Ryntra built the transaction (its builder adds no tip instruction); null where
   * the provider built it (`/order`) or the facts do not say: a tip there is a transfer this receipt does not record.
   */
  tipLamports: "0" | null;
}>;

export type ExecutionTruth = Readonly<{
  kind: "swap" | "launch";
  /** `BUILD` / `ORDER` — Jupiter's two lanes; `CURVE` / `POOL` — a Ryntra launch on Meteora. */
  lane: "BUILD" | "ORDER" | "CURVE" | "POOL";
  signature: string;
  spent: TruthAmount;
  received: TruthAmount;
  quotedRaw: string;
  minimumRaw: string;
  minimumMet: boolean;
  /** What arrived less what was quoted, signed. */
  quoteGapRaw: string;
  /** The same as basis points of the quote, signed; null when the quote is nothing. */
  quoteGapBps: number | null;
  direct: DirectRoute | null;
  /** Why `direct` is null; null when it is sized. */
  directNotSized: DirectNotSized | null;
  ryntra: TruthRyntraFee;
  protocol: TruthProtocol;
  network: TruthNetwork;
}>;

/* ------------------------------------------------------------------ arithmetic */

const RAW = /^[0-9]+$/;
const raw = (value: unknown): bigint | null => (typeof value === "string" && RAW.test(value) ? BigInt(value) : null);

/** Basis points of `part` in `whole`, signed, to the nearest; null for a whole of nothing. */
export function bpsOf(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  const scaled = part * 10_000n;
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const rounded = (magnitude + whole / 2n) / whole;
  return Number(negative ? -rounded : rounded);
}

/**
 * The same route without the fee, from where the fee left the trade.
 *
 * `feeMint` the output: what arrived plus the fee, exactly. `feeMint` the
 * input: the route priced `spent − fee`, so what arrived is scaled by
 * `spent / (spent − fee)`, rounded up — the estimate never flatters Ryntra. A
 * fee of nothing is the same route. A fee in a third mint is not sized: null.
 */
export function directRouteOf(args: Readonly<{ spent: TruthAmount; received: TruthAmount; feeMint: string | null; feeRaw: bigint }>): DirectRoute | null {
  return directRouteRead(args).direct;
}

/** `directRouteOf` with the reason it is not sized, when it is not. */
export function directRouteRead(
  args: Readonly<{ spent: TruthAmount; received: TruthAmount; feeMint: string | null; feeRaw: bigint }>,
): Readonly<{ direct: DirectRoute; notSized: null } | { direct: null; notSized: DirectNotSized }> {
  /* `spent` is the amount the route was asked to price — the quote's input, never the wallet's observed debit, which
     for SOL also carries the rent of an account the swap opened and would shrink the gap shown. */
  const spent = BigInt(args.spent.raw);
  const received = BigInt(args.received.raw);
  const done = (directRaw: bigint, basis: DirectRoute["basis"]) => {
    const gap = directRaw > received ? directRaw - received : 0n;
    return { direct: { raw: directRaw.toString(), basis, gapRaw: gap.toString(), gapBps: bpsOf(gap, directRaw) }, notSized: null } as const;
  };
  const notSized = (reason: DirectNotSized) => ({ direct: null, notSized: reason }) as const;
  if (args.feeRaw <= 0n) return done(received, "SAME");
  if (args.feeMint === null) return notSized("FEE_MINT_UNSTATED");
  if (args.feeMint === args.received.mint) return done(received + args.feeRaw, "EXACT");
  if (args.feeMint === args.spent.mint) {
    const priced = spent - args.feeRaw;
    if (priced <= 0n) return notSized("FEE_NOT_BELOW_SPENT");
    return done((received * spent + priced - 1n) / priced, "ESTIMATE");
  }
  return notSized("FEE_IN_THIRD_TOKEN");
}

/**
 * On `/order` a sized route from a fee Ryntra took is an upper bound: without Ryntra's referral Jupiter's own default
 * platform fee applies to the same order. An `EXACT` figure is read as `ESTIMATE` there; the figure itself is unchanged.
 */
function onOrderLane(direct: DirectRoute | null, lane: "BUILD" | "ORDER"): DirectRoute | null {
  if (!direct || lane !== "ORDER" || direct.basis === "SAME") return direct;
  return { ...direct, basis: "ESTIMATE", orderDefaultFee: true };
}

/* ------------------------------------------------------------------ the swap */

/** Ryntra's fee on a swap receipt, from the settled service fee; an older receipt without one reads its narrow row. */
export function swapRyntraFee(facts: Pick<SwapTruthFacts, "fees">): TruthRyntraFee {
  const fee: RyntraServiceFee | undefined = facts.fees.serviceFee;
  if (!fee) {
    const bps = facts.fees.referral.basisPoints;
    const paid = raw(facts.fees.referral.amountRaw);
    if (bps <= 0) return { state: "NONE", bps: 0, mint: null, paidRaw: null, keptRaw: null, providerRaw: null, providerPercent: null };
    return { state: "UNREAD", bps, mint: facts.fees.referral.mint, paidRaw: paid === null ? null : paid.toString(), keptRaw: null, providerRaw: null, providerPercent: null };
  }
  const none = { state: "NONE", bps: 0, mint: fee.asset, paidRaw: null, keptRaw: null, providerRaw: null, providerPercent: null } as const;
  if (fee.state === "NONE" || fee.state === "UNCONFIGURED" || fee.state === "NOT_APPLIED" || fee.basisPoints <= 0) return none;
  const providerPercent = fee.providerRetainedPercent;
  if (fee.state === "NOT_COLLECTED") {
    return { state: "NOT_CHARGED", bps: fee.basisPoints, mint: fee.asset, paidRaw: "0", keptRaw: "0", providerRaw: "0", providerPercent };
  }
  if (fee.state === "COLLECTED") {
    const paid = fee.settlement?.userPaidRaw ?? fee.amountRaw;
    return {
      state: "CHARGED",
      bps: fee.basisPoints,
      mint: fee.settlement?.asset ?? fee.asset,
      paidRaw: paid,
      keptRaw: fee.settlement?.ryntraRaw ?? null,
      providerRaw: fee.settlement?.providerRaw ?? null,
      providerPercent,
    };
  }
  return { state: "UNREAD", bps: fee.basisPoints, mint: fee.asset, paidRaw: fee.amountRaw, keptRaw: null, providerRaw: null, providerPercent };
}

/** Jupiter's own part beyond Ryntra's, from the total the provider stated; `/build` carries none of Jupiter's. */
function jupiterOwnBps(facts: SwapTruthFacts, lane: "BUILD" | "ORDER"): number | null {
  if (lane === "BUILD") return 0;
  const total = facts.fees.platform.basisPoints;
  const fee = facts.fees.serviceFee;
  const included = fee && (fee.mechanism === "JUPITER_REFERRAL" || fee.mechanism === "JUPITER_PLATFORM_FEE") ? fee.basisPoints : facts.fees.referral.basisPoints;
  return Math.max(0, total - included);
}

/**
 * The lane a swap took, from its own facts: `/build`'s fee is the platform fee into Ryntra's own fee wallet, and a
 * `/build` swap has no provider report (this deployment sent the bytes). Anything else is `/order`.
 */
function swapLane(facts: SwapTruthFacts): "BUILD" | "ORDER" {
  if (facts.fees.serviceFee?.mechanism === "JUPITER_PLATFORM_FEE") return "BUILD";
  if (facts.fees.serviceFee?.mechanism === "JUPITER_REFERRAL") return "ORDER";
  return facts.provider === null && !facts.reconciliation.deviations.includes("PROVIDER_EVIDENCE_UNAVAILABLE") ? "BUILD" : "ORDER";
}

export function swapExecutionTruth(facts: SwapTruthFacts): ExecutionTruth {
  const observed = facts.independentObservation;
  const spent: TruthAmount = { raw: observed.actualInputRaw, mint: facts.quote.inputMint };
  const received: TruthAmount = { raw: observed.actualOutputRaw, mint: facts.quote.outputMint };
  const lane = swapLane(facts);
  const ryntra = swapRyntraFee(facts);
  /* A charged fee whose amount is not stated is not sized: reading it as nothing would say Ryntra took nothing. */
  const paid = ryntra.state === "CHARGED" ? raw(ryntra.paidRaw) : ryntra.state === "NOT_CHARGED" || ryntra.state === "NONE" ? 0n : null;
  const quoted = BigInt(facts.quote.outputRaw);
  const gap = BigInt(observed.actualOutputRaw) - quoted;
  const route =
    paid === null
      ? ({ direct: null, notSized: "FEE_AMOUNT_UNREAD" } as const)
      : directRouteRead({ spent: { raw: facts.quote.inputRaw, mint: facts.quote.inputMint }, received, feeMint: ryntra.mint, feeRaw: paid });
  return {
    kind: "swap",
    lane,
    signature: observed.signature,
    spent,
    received,
    quotedRaw: facts.quote.outputRaw,
    minimumRaw: facts.quote.minimumOutputRaw,
    minimumMet: facts.reconciliation.minimumMet,
    quoteGapRaw: gap.toString(),
    quoteGapBps: bpsOf(gap, quoted),
    direct: onOrderLane(route.direct, lane),
    directNotSized: route.notSized,
    ryntra,
    protocol: { jupiterBps: jupiterOwnBps(facts, lane), poolFeeRaw: null, poolRyntraRaw: null, poolMint: null },
    network: {
      baseLamports: observed.baseFeeLamports,
      priorityLamports: observed.priorityFeeLamports,
      tipLamports: lane === "BUILD" ? "0" : null,
    },
  };
}

/* ------------------------------------------------------------------ a launch trade */

/**
 * A launch trade from its token page: Ryntra adds no fee of its own on top (`NONE`), and the pool's fee — Ryntra's part
 * of it among the parts, `protocol.poolRyntraRaw` — is the same through any interface, so the same route is `SAME`.
 * `NONE` here never means Ryntra earned nothing: the receipt's words say its part is inside the pool fee
 * (`kind === "launch"`). Ryntra built the transaction, so no tip; the network's fees are not in these facts.
 */
export function launchExecutionTruth(facts: LaunchTradeReceiptFacts): ExecutionTruth {
  const tokens: TruthAmount = { raw: facts.observed.tokensRaw, mint: facts.token.mint };
  const pair: TruthAmount = { raw: facts.observed.pairRaw, mint: facts.pair.mint };
  const buy = facts.side === "buy";
  const received = buy ? tokens : pair;
  const quoted = BigInt(facts.quote.amountOutRaw);
  const gap = BigInt(received.raw) - quoted;
  return {
    kind: "launch",
    lane: facts.venue === "curve" ? "CURVE" : "POOL",
    signature: facts.signature,
    spent: buy ? pair : tokens,
    received,
    quotedRaw: facts.quote.amountOutRaw,
    minimumRaw: facts.quote.minimumOutRaw,
    minimumMet: facts.minimumMet,
    quoteGapRaw: gap.toString(),
    quoteGapBps: bpsOf(gap, quoted),
    direct: directRouteOf({ spent: buy ? pair : tokens, received, feeMint: null, feeRaw: 0n }),
    directNotSized: null,
    ryntra: { state: "NONE", bps: 0, mint: null, paidRaw: null, keptRaw: null, providerRaw: null, providerPercent: null },
    protocol: { jupiterBps: null, poolFeeRaw: facts.observed.feeRaw, poolRyntraRaw: facts.observed.ryntraRaw, poolMint: facts.pair.mint },
    network: { baseLamports: null, priorityLamports: null, tipLamports: "0" },
  };
}

/* ------------------------------------------------------------------ cashback */

/**
 * The cashback a trade actually earned, as the Rewards ledger recorded it for the trade's signature.
 *
 * - `CREDITED` — rows exist: their dollar sum (null while unvalued) and whether part waits on the wallet's check;
 * - `NONE_ON_RECORD` — the ledger was read for this wallet and holds no cashback for this signature;
 * - `NOT_SHOWN` — the ledger was not read: this browser has not proved the wallet, or the read failed.
 */
export type TruthCashback =
  | Readonly<{ state: "CREDITED"; usdMicros: string | null; held: boolean }>
  | Readonly<{ state: "NONE_ON_RECORD" }>
  | Readonly<{ state: "NOT_SHOWN" }>;

export type CashbackByTrade = Readonly<{ signature: string; usdMicros: string | null; held: boolean }>;

export function cashbackOf(signature: string, rows: readonly CashbackByTrade[] | null): TruthCashback {
  if (rows === null) return { state: "NOT_SHOWN" };
  const found = rows.find((row) => row.signature === signature);
  return found ? { state: "CREDITED", usdMicros: found.usdMicros, held: found.held } : { state: "NONE_ON_RECORD" };
}
