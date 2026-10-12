/**
 * A holder's position in a graduated launch's pool — the pure half (the
 * decision of 2026-10-07: the collector pays to the wallet).
 *
 * A holder puts one coin into the token's DAMM v2 pool through Meteora's Zap
 * and, in the same signature, lets Ryntra's collector act on the position. The
 * permission is the program's own (DAMM v2 from 0.2.2): an SPL Approve of 0 on
 * the position NFT's account names the delegate, and a bitmask on the position
 * says what it may sign. Ryntra asks for two bits only — `ClaimPositionFeeToOwner`
 * and `ClaimRewardToOwner` — with which the program pays the fees out only to
 * the owner's own token accounts; nothing else, proven by the program's code
 * and on devnet (07.10, 15 refusals of 15). The collector cannot add the fees
 * back: the program's `add_liquidity`, and Zap's, take tokens only from the
 * signer's own accounts. Half of a Ryntra pool's LP fee compounds in the pool
 * by itself (the preset's compounding mode); the other half is what the
 * collector brings to the owner's wallet.
 *
 * Client-safe: no chain, no store.
 */

/** The bits the program numbers a delegate's permissions by (damm-v2 `PositionDelegatePermission`). */
export const POSITION_PERMISSION_BITS = {
  AddLiquidity: 0,
  RemoveLiquidity: 1,
  RemoveLiquidityToOwner: 2,
  ClaimPositionFee: 3,
  ClaimPositionFeeToOwner: 4,
  ClaimReward: 5,
  ClaimRewardToOwner: 6,
  LockPosition: 7,
} as const;

export type PositionPermission = keyof typeof POSITION_PERMISSION_BITS;

export const POSITION_PERMISSIONS = [
  "AddLiquidity",
  "RemoveLiquidity",
  "RemoveLiquidityToOwner",
  "ClaimPositionFee",
  "ClaimPositionFeeToOwner",
  "ClaimReward",
  "ClaimRewardToOwner",
  "LockPosition",
] as const satisfies readonly PositionPermission[];

/** What Ryntra's collector asks for, and nothing more: the fees and rewards, paid only to the owner. */
export const HOLDER_GRANT_PERMISSIONS = ["ClaimPositionFeeToOwner", "ClaimRewardToOwner"] as const satisfies readonly PositionPermission[];

export const HOLDER_GRANT_BITMASK = HOLDER_GRANT_PERMISSIONS.reduce((mask, name) => mask | (1 << POSITION_PERMISSION_BITS[name]), 0);

/** The permissions a bitmask holds, by name, in the program's order. */
export function permissionsOf(bitmask: number): PositionPermission[] {
  return [...POSITION_PERMISSIONS].filter((name) => (bitmask & (1 << POSITION_PERMISSION_BITS[name])) !== 0);
}

/**
 * The state of a position's permission as the collector reads it.
 * - `GRANTED` — the collector is the delegate, with Ryntra's two bits and no other; it may claim.
 * - `NONE` — no delegate, or no bits: the position is the owner's alone.
 * - `OTHER_DELEGATE` — someone else is the delegate; the collector never acts.
 * - `WIDER` — the collector is the delegate but the position allows more than Ryntra asked for; it does not act on a
 *   permission it did not ask for, and the page says so.
 * - `TRANSFERABLE` — the delegate may move the NFT itself (an approval of more than 0); the program refuses the
 *   delegate then, and the page says to revoke.
 */
export const HOLDER_GRANT_STATES = ["GRANTED", "NONE", "OTHER_DELEGATE", "WIDER", "TRANSFERABLE"] as const;
export type HolderGrantState = (typeof HOLDER_GRANT_STATES)[number];

export function holderGrantState(args: Readonly<{ delegate: string | null; delegatedAmount: string; bitmask: number; collector: string | null }>): HolderGrantState {
  if (!args.delegate || args.bitmask === 0) return "NONE";
  if (!args.collector || args.delegate !== args.collector) return "OTHER_DELEGATE";
  if (args.delegatedAmount !== "0") return "TRANSFERABLE";
  if ((args.bitmask & ~HOLDER_GRANT_BITMASK) !== 0) return "WIDER";
  return (args.bitmask & (1 << POSITION_PERMISSION_BITS.ClaimPositionFeeToOwner)) !== 0 ? "GRANTED" : "NONE";
}

/* ------------------------------------------------------------ the pool's outcome at a price move */

/** The moves the simulator shows: ±10 % and ±30 % of the token's price in the pair currency. */
export const SIMULATED_MOVES_BPS = [-3000, -1000, 1000, 3000] as const;

export type PoolOutcomeRow = Readonly<{
  moveBps: number;
  /** The position's value at the new price, in the pair currency; fees not counted. */
  position: number;
  /** The same two coins kept in the wallet instead, at the new price. */
  held: number;
  /** position − held: the loss to the price move a pool takes (never a gain). */
  difference: number;
}>;

/**
 * What a deposit becomes when the token's price moves, for a pool of the whole price range (a Ryntra launch's DAMM v2
 * pool is one): the position is worth √r of what it was, the two coins kept would be worth (1 + r) / 2, r the price
 * ratio. Fees are not counted — nothing here is a forecast of them.
 */
export function poolOutcome(deposit: number, moveBps: number): PoolOutcomeRow {
  const ratio = Math.max(0, 1 + moveBps / 10_000);
  const position = deposit * Math.sqrt(ratio);
  const held = (deposit * (1 + ratio)) / 2;
  return { moveBps, position, held, difference: position - held };
}

export function poolOutcomes(deposit: number): PoolOutcomeRow[] {
  return SIMULATED_MOVES_BPS.map((move) => poolOutcome(deposit, move));
}

/* ------------------------------------------------------------ Ryntra's share at entry */

/**
 * Ryntra's share of an entry: the fee policy's rate for the token's class on the part of the deposit Zap
 * swaps into the other coin — the entry's only trade — counted down to the raw unit. The permission cannot carry a fee
 * (the program pays the owner only), so the entry is the one place Ryntra's share is taken.
 */
export function holderEntryFeeRaw(swappedRaw: bigint, bps: number): bigint {
  if (swappedRaw <= 0n || bps <= 0) return 0n;
  return (swappedRaw * BigInt(bps)) / 10_000n;
}

/**
 * How far Zap may let the pool's square-root price move inside the entry, basis points: the entry's own swap's move,
 * measured on the pool as it stands (`ownSqrtMoveBps`), plus half the slippage the person allows for others' trades —
 * the square-root price moves half as far as the price, so others may move the price by the slippage and no more. The
 * slippage alone refused every entry into a small pool, where half a few dollars moves it (10.10, $STAIR).
 */
export function zapPriceMoveBps(ownSqrtMoveBps: number, slippageBps: number): number {
  const own = Number.isFinite(ownSqrtMoveBps) && ownSqrtMoveBps > 0 ? Math.ceil(ownSqrtMoveBps) : 0;
  const others = Math.ceil(Math.max(0, Number.isFinite(slippageBps) ? slippageBps : 0) / 2);
  return Math.min(10_000, own + others);
}

/* ------------------------------------------------------------ when the collector claims */

/** The collector claims a position at most once a day … */
export const HOLDER_CLAIM_EVERY_MS = 24 * 60 * 60 * 1000;
/** … and only when a whole unit of a dollar pair is waiting: a claim costs the collector its fee, a dust claim pays nobody. */
export const HOLDER_CLAIM_MIN_UNITS = 1n;

export function collectorShouldClaim(args: Readonly<{ claimablePairRaw: bigint; pairDecimals: number; pairIsDollar: boolean; lastClaimAt: string | null; now: number }>): boolean {
  if (!args.pairIsDollar) return false;
  if (args.claimablePairRaw < HOLDER_CLAIM_MIN_UNITS * 10n ** BigInt(args.pairDecimals)) return false;
  return !args.lastClaimAt || args.now - Date.parse(args.lastClaimAt) >= HOLDER_CLAIM_EVERY_MS;
}

/**
 * The collector's queue for one position, as the person reads it: the earliest moment the next claim may go — a day
 * after the last one, or now — and whether a whole dollar is already waiting. Both must hold, so the claim goes on the
 * collector's first pass after the later of the two.
 */
export function collectorNextClaim(args: Readonly<{ claimablePairRaw: bigint; pairDecimals: number; lastClaimAt: string | null; now: number }>): Readonly<{ notBefore: string; enoughWaiting: boolean; dueNow: boolean }> {
  const last = args.lastClaimAt ? Date.parse(args.lastClaimAt) : Number.NaN;
  const notBefore = Number.isFinite(last) ? Math.max(args.now, last + HOLDER_CLAIM_EVERY_MS) : args.now;
  const enoughWaiting = args.claimablePairRaw >= HOLDER_CLAIM_MIN_UNITS * 10n ** BigInt(args.pairDecimals);
  return { notBefore: new Date(notBefore).toISOString(), enoughWaiting, dueNow: enoughWaiting && notBefore <= args.now };
}

/* ------------------------------------------------------------ the earnings card */

export const HOLDER_CARD_SOURCE = "ryntra.launch.holder-position-card@1";

/** One position as the card counts it: the chain's figures, in the pair currency, with the time it was entered. */
export type HolderCardRow = Readonly<{
  enteredAt: string;
  read: boolean;
  pair: Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
  /** What the entry put in, in the pair currency, raw. */
  enteredRaw: string;
  /** The position's value now at the pool's price, in the pair currency, raw; null when unread. */
  valueRaw: string | null;
  /** The fees the position earned in the pair currency: claimed by anyone, plus waiting now. */
  feesRaw: string;
  /** Of them, what Ryntra's collector brought to the owner's wallet. */
  collectedRaw: string;
}>;

export type HolderEarningsCard = Readonly<{
  source: typeof HOLDER_CARD_SOURCE;
  kind: "holder-position";
  wallet: string;
  network: string;
  /** From the wallet's first entry read here to the moment of the read. */
  period: Readonly<{ from: string; to: string }>;
  positions: number;
  /** Positions whose chain could not be read now: their figures are not in the amounts, never counted as nothing. */
  unread: number;
  amounts: ReadonlyArray<
    Readonly<{
      pairMint: string;
      symbol: string;
      decimals: number;
      dollar: boolean;
      enteredRaw: string;
      valueRaw: string;
      feesRaw: string;
      collectedRaw: string;
    }>
  >;
  /** The collector's claims for this wallet: their signatures, newest first. */
  receipts: readonly string[];
}>;

/**
 * The data the growth module's card draws for a holder's positions: what went in, what it is worth now — a loss to the
 * price as visible as a gain — and the fees, each currency apart, with the period. Positions not read now are counted
 * apart and left out of the figures. No promise and no projection.
 */
export function holderEarningsCard(args: Readonly<{ wallet: string; network: string; rows: readonly HolderCardRow[]; receipts: readonly string[]; now: string }>): HolderEarningsCard {
  const amounts = new Map<string, { pair: HolderCardRow["pair"]; entered: bigint; value: bigint; fees: bigint; collected: bigint }>();
  for (const row of args.rows) {
    if (!row.read || row.valueRaw === null) continue;
    const entry = amounts.get(row.pair.mint) ?? { pair: row.pair, entered: 0n, value: 0n, fees: 0n, collected: 0n };
    entry.entered += BigInt(row.enteredRaw);
    entry.value += BigInt(row.valueRaw);
    entry.fees += BigInt(row.feesRaw);
    entry.collected += BigInt(row.collectedRaw);
    amounts.set(row.pair.mint, entry);
  }
  const from = args.rows.reduce<string | null>((first, row) => (first === null || row.enteredAt < first ? row.enteredAt : first), null);
  return {
    source: HOLDER_CARD_SOURCE,
    kind: "holder-position",
    wallet: args.wallet,
    network: args.network,
    period: { from: from ?? args.now, to: args.now },
    positions: args.rows.length,
    unread: args.rows.filter((row) => !row.read || row.valueRaw === null).length,
    amounts: [...amounts.values()].map((entry) => ({
      pairMint: entry.pair.mint,
      symbol: entry.pair.symbol,
      decimals: entry.pair.decimals,
      dollar: entry.pair.dollar,
      enteredRaw: entry.entered.toString(),
      valueRaw: entry.value.toString(),
      feesRaw: entry.fees.toString(),
      collectedRaw: entry.collected.toString(),
    })),
    receipts: args.receipts,
  };
}
