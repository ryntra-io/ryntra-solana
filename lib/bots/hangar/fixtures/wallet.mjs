/*
 * One constructed wallet for the Hangar's tests (29.10.2026, 12:00 UTC): the shapes are the venues' own as the limits
 * lane normalizes them (`TriggerOrderRow`, `DlmmOrderRow`, `LimitOrderRecord`) and the pools' `PositionView`.
 */

export const NOW = Date.parse("2026-10-29T12:00:00.000Z");
export const WALLET = "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6";
export const SOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
export const LP_POOL = "BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh";

const sig = (n) => `${String(n).repeat(1)}${"5".repeat(87 - String(n).length)}`;
export const SIG = { ladderFill: sig(1), ladderPlace: sig(2), dlmmPlace: sig(3), dcaBuy: sig(4), dcaOld: sig(5) };

const order = (n) => `Ord${String(n).padStart(2, "0")}${"x".repeat(37)}`;
export const ORDER = Object.fromEntries(["ladderA", "ladderB", "ladderC", "expired", "stale", "failed", "open", "leftCancel", "leftOpen", "bundleA", "bundleB", "dlmm"].map((name, index) => [name, order(index + 1)]));

const trigger = (over) => ({
  inputMint: USDC,
  outputMint: SOL,
  makingRaw: "100000000",
  takingRaw: "500000000",
  remainingMakingRaw: "100000000",
  status: "Open",
  updatedAt: over.createdAt,
  expiredAt: null,
  openTx: null,
  closeTx: null,
  trades: [],
  ...over,
});

export const TRIGGER_ROWS = [
  /* A ladder of three buys of SOL: the first filled, two wait. */
  trigger({
    order: ORDER.ladderA,
    createdAt: "2026-10-20T10:00:00.000Z",
    status: "Completed",
    remainingMakingRaw: "0",
    trades: [{ action: "Fill", inputRaw: "100000000", outputRaw: "550000000", feeRaw: "0", feeMint: SOL, signature: SIG.ladderFill, confirmedAt: "2026-10-22T03:00:00.000Z" }],
  }),
  trigger({ order: ORDER.ladderB, createdAt: "2026-10-20T10:02:00.000Z", takingRaw: "550000000" }),
  trigger({ order: ORDER.ladderC, createdAt: "2026-10-20T10:04:00.000Z", takingRaw: "600000000" }),
  /* Past its expiry and still listed open: the keeper fills it no more. */
  trigger({ order: ORDER.expired, inputMint: JUP, outputMint: USDC, makingRaw: "50000000", takingRaw: "60000000", createdAt: "2026-08-01T00:00:00.000Z", expiredAt: "2026-10-01T00:00:00.000Z" }),
  /* Two months open, its price a fifth of the market's. */
  trigger({ order: ORDER.stale, inputMint: USDC, outputMint: JUP, makingRaw: "20000000", takingRaw: "100000000", createdAt: "2026-09-01T00:00:00.000Z" }),
  /* The leg that landed beside one that failed (the record below). */
  trigger({ order: ORDER.open, inputMint: SOL, outputMint: USDC, makingRaw: "1000000000", takingRaw: "250000000", createdAt: "2026-10-28T09:01:00.000Z" }),
  /* A ladder the person cancelled but for one leg. */
  trigger({ order: ORDER.leftCancel, inputMint: USDC, outputMint: JUP, makingRaw: "10000000", takingRaw: "11000000", createdAt: "2026-10-25T08:00:00.000Z", status: "Cancelled", closeTx: SIG.dcaOld }),
  trigger({ order: ORDER.leftOpen, inputMint: USDC, outputMint: JUP, makingRaw: "10000000", takingRaw: "12000000", createdAt: "2026-10-25T08:03:00.000Z" }),
  /* Two of a bundle's three legs. */
  trigger({ order: ORDER.bundleA, makingRaw: "50000000", takingRaw: "260000000", createdAt: "2026-10-27T10:00:30.000Z" }),
  trigger({ order: ORDER.bundleB, makingRaw: "50000000", takingRaw: "270000000", createdAt: "2026-10-27T10:01:00.000Z" }),
];

const record = (over) => ({
  schema: "ryntra.solana.limit-order",
  schemaVersion: "1.0.0",
  version: 1,
  network: "mainnet",
  wallet: WALLET,
  pool: null,
  fillPrice: null,
  fee: { ryntraBps: 0, venueBps: 10, account: null },
  placeSignature: null,
  cancelSignature: null,
  fills: [],
  cancelFrom: null,
  claim: null,
  reason: null,
  ...over,
});

export const RECORDS = [
  record({ venue: "trigger", order: ORDER.ladderA, side: "buy", baseMint: SOL, quoteMint: USDC, inputMint: USDC, outputMint: SOL, makingRaw: "100000000", takingRaw: "500000000", price: "200", state: "OPEN", placeSignature: SIG.ladderPlace, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" }),
  record({ venue: "trigger", order: ORDER.failed, side: "sell", baseMint: SOL, quoteMint: USDC, inputMint: SOL, outputMint: USDC, makingRaw: "1000000000", takingRaw: "260000000", price: "260", state: "FAILED", reason: "BLOCKHASH_EXPIRED", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:20.000Z" }),
  record({ venue: "dlmm", order: ORDER.dlmm, pool: POOL, side: "sell", baseMint: SOL, quoteMint: USDC, inputMint: SOL, outputMint: USDC, makingRaw: "500000000", takingRaw: "110000000", price: "220", state: "OPEN", placeSignature: SIG.dlmmPlace, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" }),
];

export const DLMM_ROWS = [
  {
    limitOrder: ORDER.dlmm,
    pool: POOL,
    tokenXMint: SOL,
    tokenYMint: USDC,
    tokenXDecimals: 9,
    tokenYDecimals: 6,
    isAskSide: true,
    binIds: [812],
    poolPrice: 220,
    depositX: "500000000",
    depositY: "0",
    unfilledX: "0",
    unfilledY: "0",
    swappedX: "0",
    swappedY: "110000000",
    feeX: "0",
    feeY: "50000",
    status: "FILLED",
  },
];

export const TOKENS = {
  [SOL]: { symbol: "SOL", decimals: 9, usd: 200 },
  [USDC]: { symbol: "USDC", decimals: 6, usd: 1 },
  [JUP]: { symbol: "JUP", decimals: 6, usd: 1 },
};

const view = (over) => ({
  kind: "dlmm",
  pool: POOL,
  name: "SOL-USDC",
  x: { mint: SOL, symbol: "SOL", amount: 0.6, unclaimed: 0.001, priceUsd: 200 },
  y: { mint: USDC, symbol: "USDC", amount: 80, unclaimed: 0.2, priceUsd: 1 },
  rangeState: "in_range",
  lower: 190,
  upper: 210,
  price: 200,
  valueUsd: 200,
  unclaimedUsd: 0.4,
  lockedBps: 0,
  feesElsewhere: false,
  hasRewards: false,
  slot: 1,
  at: NOW - 1_000,
  pricesAt: null,
  ...over,
});

export const GRID_POSITION = "GridPos1" + "z".repeat(36);
export const LP_POSITION = "LpPos111" + "y".repeat(36);
export const GONE_POSITION = "GonePos1" + "w".repeat(36);

export const POSITIONS = {
  at: NOW - 1_000,
  views: [view({ address: GRID_POSITION }), view({ address: LP_POSITION, pool: LP_POOL, kind: "damm-v2", rangeState: "above", name: "JUP-USDC", unclaimedUsd: 1.5 })],
};

export const GRIDS = [
  { position: GRID_POSITION, pool: POOL, pair: "SOL/USDC", side: "both", levels: 21, lowerPrice: 190, upperPrice: 210, at: Date.parse("2026-10-20T00:00:00.000Z") },
  { position: GONE_POSITION, pool: POOL, pair: "SOL/USDC", side: "buy", levels: 11, lowerPrice: 150, upperPrice: 180, at: Date.parse("2026-10-01T00:00:00.000Z") },
];

export const ENTRIES = {
  [GRID_POSITION]: { x: 0.5, y: 100, usd: 200, claimedUsd: 0, at: Date.parse("2026-10-20T00:00:00.000Z"), source: "ryntra" },
};

export const BUNDLES = [
  {
    id: "bundle-dip-3",
    at: Date.parse("2026-10-27T10:00:00.000Z"),
    legs: [
      { venue: "trigger", inputMint: USDC, outputMint: SOL, makingRaw: "50000000" },
      { venue: "trigger", inputMint: USDC, outputMint: SOL, makingRaw: "50000000" },
      { venue: "trigger", inputMint: USDC, outputMint: SOL, makingRaw: "50000000" },
    ],
  },
];

const occurrence = (over) => ({ openUntil: over.dueAt, remindedAt: over.dueAt, signature: null, spentUsd: null, boughtAt: null, trigger: null, condition: null, amountUsd: null, events: null, ...over });

export const RULES = [
  {
    id: "rule_sol_weekly",
    name: "SOL",
    status: "active",
    occurrences: [
      occurrence({ dueAt: "2026-10-29T09:00:00.000Z", state: "due" }),
      occurrence({ dueAt: "2026-10-22T09:00:00.000Z", state: "bought", signature: SIG.dcaBuy, spentUsd: 25, boughtAt: "2026-10-22T09:05:00.000Z" }),
      occurrence({ dueAt: "2026-10-15T09:00:00.000Z", state: "bought", signature: SIG.dcaOld, spentUsd: 25, boughtAt: "2026-10-15T09:02:00.000Z" }),
    ],
  },
  { id: "rule_jup_paused", name: "JUP", status: "paused", occurrences: [] },
];
