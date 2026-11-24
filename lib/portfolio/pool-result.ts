/**
 * The honest result of a position in a pool — what went in, what it is worth now, the fees it earned, and the whole of it
 * against simply holding the same coins — and what a person's own limit orders brought in a pool of DLMM Pro.
 *
 * Why here, beside the portfolio's model and its honest PnL (`./pnl.ts`, `../core/pnl/honest.ts`), and not in
 * `lib/earn-pro/`: it is a result of the portfolio, read the same way wherever a position is shown («Earn», a pool's own
 * page, later the portfolio), and it keeps the honest standard's rules — fees counted, an unknown is never a zero and
 * never a plus, how deep the history goes is said. `lib/earn-pro/` is the venue's door to the chain; nothing here reads
 * the chain or signs.
 *
 * The rules:
 *
 * - **What went in is known only where it was seen.** The chain keeps no record of a deposit. A position of DLMM Pro
 *   opened through Ryntra leaves an entry on the person's device (`ProLedger`): what the opening put in, the network's
 *   fees and the swap's pool fee it paid, and later what each action took out or put back. Without one the result is
 *   not known (`unknown: "entry"`), never guessed.
 * - **Against holding.** «Holding» is the same coins that went in, kept in the wallet, at the pool's price now. The price's
 *   move is the position's worth (without the fees put back in) less that; the fees are what it earned — still in it,
 *   taken out, put back in; the costs are the network's fees and the opening swap's pool fee. The result is the three
 *   together. The position's deposit (rent) comes back when it is closed and is not a cost.
 * - **A position changed where Ryntra did not see it** (both coins short of what went in — a move only trades one for the
 *   other): the entry no longer holds, and nothing is drawn from it (`unknown: "changed"`).
 * - **A pool's own reward** in a coin of its own is not priced here: it is left out and said so (`rewardsLeftOut`).
 * - **SOL is the unit:** every pool of DLMM Pro a position opens in from here is a pool of SOL, and the engine states a
 *   position's worth and fees in it. Dollars, where a screen wants them, are at SOL's price now.
 *
 * Pure and client-safe: no clock unless given, no storage, no network. Floats are for reading, never a sum a
 * transaction is sized from.
 */

export const POOL_RESULT_STANDARD = "ryntra.pool-result/1" as const;

/** Base units of a pool's two coins and their whole worth in lamports — the engine's own form. */
export type ProAmounts = Readonly<{ xRaw: string; yRaw: string; lamports: string }>;

/** What one landed action of a position said before its signature — the parts of the Review's summary this reads. */
export type ProLanded =
  | Readonly<{ action: "open"; goesIn: ProAmounts; swap: Readonly<{ lamports: string; feeBps: number }>; networkLamports: number; depositLamports: number; nftMint: string }>
  | Readonly<{ action: "compound"; collected: ProAmounts; networkLamports: number }>
  | Readonly<{ action: "collect"; fees: ProAmounts | null; networkLamports: number }>
  | Readonly<{ action: "leave" | "close"; networkLamports: number }>
  | Readonly<{ action: "care_on" | "care_off"; networkLamports: number }>;

/** What the device keeps of a position of DLMM Pro opened through Ryntra. */
export type ProLedger = Readonly<{
  nftMint: string;
  pool: string;
  /** When the opening landed, ms. */
  openedAt: number;
  /** What the opening put in. */
  in: ProAmounts;
  /** Fees taken and put back in («Take and add»): they are inside the worth since. */
  addedLamports: string;
  /** Fees taken out to the wallet. */
  collectedLamports: string;
  /** The network's fees of every action seen, and the opening swap's pool fee. */
  costsLamports: string;
  /** The position's deposit: it comes back when the position is closed. */
  rentLamports: string;
  /** An action landed only in part: what it did is not known, and the entry stops being drawn from. */
  lost: boolean;
}>;

const RAW = /^\d{1,30}$/;
const raw = (value: unknown): bigint | null => (typeof value === "string" && RAW.test(value) ? BigInt(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null);
const add = (a: string, b: bigint): string => (BigInt(a) + b).toString();

/** The opening swap's pool fee in lamports, rounded up: a cost is never said smaller than it was. */
export function swapFeeLamports(swap: Readonly<{ lamports: string; feeBps: number }>): bigint {
  const amount = raw(swap.lamports);
  if (amount === null || !(swap.feeBps > 0) || !Number.isFinite(swap.feeBps)) return 0n;
  // Hundredths of a basis point keep a fractional fee exact enough without a float on the amount.
  const centiBps = BigInt(Math.round(swap.feeBps * 100));
  return (amount * centiBps + 999_999n) / 1_000_000n;
}

/** A new entry from an opening that landed whole. */
export function ledgerOfOpen(landed: Extract<ProLanded, { action: "open" }>, pool: string, at: number): ProLedger | null {
  const x = raw(landed.goesIn.xRaw);
  const y = raw(landed.goesIn.yRaw);
  const lamports = raw(landed.goesIn.lamports);
  const network = raw(landed.networkLamports);
  const deposit = raw(landed.depositLamports);
  if (x === null || y === null || lamports === null || network === null || deposit === null || lamports === 0n) return null;
  return {
    nftMint: landed.nftMint,
    pool,
    openedAt: at,
    in: { xRaw: x.toString(), yRaw: y.toString(), lamports: lamports.toString() },
    addedLamports: "0",
    collectedLamports: "0",
    costsLamports: (network + swapFeeLamports(landed.swap)).toString(),
    rentLamports: deposit.toString(),
    lost: false,
  };
}

/**
 * The entry after one more action of its position. `whole` — every transaction landed; an action that landed only in
 * part leaves the entry `lost`. Leaving and closing end it: the position holds nothing to draw a result from.
 */
export function ledgerAfter(ledger: ProLedger, landed: Exclude<ProLanded, { action: "open" }>, whole: boolean): ProLedger | null {
  if (landed.action === "leave" || landed.action === "close") return null;
  if (!whole) return { ...ledger, lost: true };
  const network = raw(landed.networkLamports) ?? 0n;
  const costsLamports = add(ledger.costsLamports, network);
  if (landed.action === "compound") return { ...ledger, costsLamports, addedLamports: add(ledger.addedLamports, raw(landed.collected.lamports) ?? 0n) };
  if (landed.action === "collect") return { ...ledger, costsLamports, collectedLamports: add(ledger.collectedLamports, landed.fees ? (raw(landed.fees.lamports) ?? 0n) : 0n) };
  return { ...ledger, costsLamports };
}

/** Whether a value read from the device is an entry. */
export function isProLedger(value: unknown): value is ProLedger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const amounts = v.in as Record<string, unknown> | undefined;
  return (
    typeof v.nftMint === "string" &&
    typeof v.pool === "string" &&
    typeof v.openedAt === "number" &&
    Number.isFinite(v.openedAt) &&
    typeof amounts === "object" &&
    amounts !== null &&
    [amounts.xRaw, amounts.yRaw, amounts.lamports, v.addedLamports, v.collectedLamports, v.costsLamports, v.rentLamports].every((entry) => typeof entry === "string" && RAW.test(entry)) &&
    typeof v.lost === "boolean"
  );
}

/* ── the result ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** What the result needs of the pool: which side is SOL, the price (Y per X, whole coins), the coins' decimals. */
export type ResultPool = Readonly<{ solIsX: boolean; price: number; x: Readonly<{ decimals: number }>; y: Readonly<{ decimals: number }> }>;
/** What the result needs of the position now, as the engine reads it. */
export type ResultPosition = Readonly<{ worth: ProAmounts; fees: ProAmounts; rewards: readonly Readonly<{ accruedRaw: string; symbol: string | null }>[] }>;

export type ResultUnknown = "entry" | "changed" | "lost" | "price";

export type PoolResult = Readonly<{
  standard: typeof POOL_RESULT_STANDARD;
  unit: "SOL";
  /** What went in, at the opening's prices; null — not seen here. */
  invested: number | null;
  /** The position's worth now. */
  now: number;
  /** Everything it earned: still in it, taken out, put back in; null — the entry is not known. */
  fees: number | null;
  /** The same coins as went in, held, at the price now. */
  hold: number | null;
  /** What the price's move did against holding: the worth without the fees put back, less holding. */
  price: number | null;
  /** The network's fees and the opening swap's pool fee. */
  costs: number | null;
  /** The whole against holding: price + fees − costs; null — not known, never a zero. */
  net: number | null;
  /** Of what went in, per cent; null with `net`. */
  netPct: number | null;
  /** The position's deposit, which comes back at closing; null without an entry. */
  rent: number | null;
  /** Counted from — the opening seen here, ms; null without an entry. */
  since: number | null;
  /** Why the result is not known; null when it is. */
  unknown: ResultUnknown | null;
  /** The pool's own reward accrued in a coin of its own, not priced here. */
  rewardsLeftOut: boolean;
}>;

const LAMPORTS = 1e9;
const whole = (value: string | bigint, decimals: number): number => Number(BigInt(value)) / 10 ** decimals;
/** A side may fall this short of what went in before the two can no longer be the same position. */
export const RESULT_TOLERANCE = 0.02;

/** Two coins' base units in SOL at the pool's price; null without a price. */
export function solValue(pool: ResultPool, xRaw: string, yRaw: string): number | null {
  if (!(pool.price > 0) || !Number.isFinite(pool.price)) return null;
  const x = whole(xRaw, pool.x.decimals);
  const y = whole(yRaw, pool.y.decimals);
  return pool.solIsX ? x + y / pool.price : y + x * pool.price;
}

/** Both coins short of what went in: the position changed where Ryntra did not see it. */
export function positionChanged(entry: Pick<ProAmounts, "xRaw" | "yRaw">, now: Pick<ProAmounts, "xRaw" | "yRaw">): boolean {
  const short = (held: string, put: string) => BigInt(put) > 0n && Number(BigInt(held)) < Number(BigInt(put)) * (1 - RESULT_TOLERANCE);
  return short(now.xRaw, entry.xRaw) && short(now.yRaw, entry.yRaw);
}

/** The position's result against its entry. Without one, only what the chain says now. */
export function proResult(ledger: ProLedger | null, position: ResultPosition, pool: ResultPool): PoolResult {
  const nowSol = Number(BigInt(position.worth.lamports)) / LAMPORTS;
  const feesNow = Number(BigInt(position.fees.lamports)) / LAMPORTS;
  const rewardsLeftOut = position.rewards.some((reward) => RAW.test(reward.accruedRaw) && BigInt(reward.accruedRaw) > 0n);
  const blank = (unknown: ResultUnknown, entry: ProLedger | null): PoolResult => ({
    standard: POOL_RESULT_STANDARD,
    unit: "SOL",
    invested: entry ? Number(BigInt(entry.in.lamports)) / LAMPORTS : null,
    now: nowSol,
    fees: null,
    hold: null,
    price: null,
    costs: null,
    net: null,
    netPct: null,
    rent: entry ? Number(BigInt(entry.rentLamports)) / LAMPORTS : null,
    since: entry?.openedAt ?? null,
    unknown,
    rewardsLeftOut,
  });
  if (!ledger) return blank("entry", null);
  if (ledger.lost) return blank("lost", ledger);
  if (positionChanged(ledger.in, position.worth)) return blank("changed", ledger);
  const hold = solValue(pool, ledger.in.xRaw, ledger.in.yRaw);
  if (hold === null || !(hold > 0)) return blank("price", ledger);
  const added = Number(BigInt(ledger.addedLamports)) / LAMPORTS;
  const collected = Number(BigInt(ledger.collectedLamports)) / LAMPORTS;
  const costs = Number(BigInt(ledger.costsLamports)) / LAMPORTS;
  const invested = Number(BigInt(ledger.in.lamports)) / LAMPORTS;
  const fees = feesNow + collected + added;
  const price = nowSol - added - hold;
  const net = price + fees - costs;
  return {
    standard: POOL_RESULT_STANDARD,
    unit: "SOL",
    invested,
    now: nowSol,
    fees,
    hold,
    price,
    costs,
    net,
    netPct: invested > 0 ? (net / invested) * 100 : null,
    rent: Number(BigInt(ledger.rentLamports)) / LAMPORTS,
    since: ledger.openedAt,
    unknown: null,
    rewardsLeftOut,
  };
}

/** A figure of the result in dollars at SOL's price now; null where either is not known. */
export const solUsd = (sol: number | null, solPriceUsd: number | null): number | null => (sol === null || solPriceUsd === null || !(solPriceUsd > 0) || !Number.isFinite(sol) ? null : sol * solPriceUsd);

/* ── a person's own limit orders ─────────────────────────────────────────────────────────────────────────────────── */

/** What a collected order paid its maker — the parts of a fill (`lib/pro-pools/tape.ts`) this reads. */
export type BonusFill = Readonly<{ owner: string; at: string | null; bonusXRaw: string; bonusYRaw: string; state: "filled" | "partial" | "unfilled" | null }>;
/** A pool's two coins as the tape's answer names them: their decimals and dollar price now. */
export type BonusPair = Readonly<{ x: Readonly<{ decimals: number; usd: number | null }>; y: Readonly<{ decimals: number; usd: number | null }> }>;

export type MyBonus = Readonly<{
  /** The person's orders collected with a part filled, in what was read. */
  count: number;
  xRaw: string;
  yRaw: string;
  /** In dollars at the coins' prices now; null where a coin that paid has no price. */
  usd: number | null;
  /** The oldest of them, ISO; null without any. */
  from: string | null;
}>;

/** What the person's own filled orders paid as bonus in the fills read: only theirs, only those that filled. */
export function myBonus(fills: readonly BonusFill[], owner: string, pair: BonusPair): MyBonus {
  let x = 0n;
  let y = 0n;
  let count = 0;
  let from: string | null = null;
  for (const fill of fills) {
    if (fill.owner !== owner || (fill.state !== "filled" && fill.state !== "partial")) continue;
    const bx = raw(fill.bonusXRaw);
    const by = raw(fill.bonusYRaw);
    if (bx === null || by === null) continue;
    x += bx;
    y += by;
    count += 1;
    if (fill.at && (from === null || fill.at < from)) from = fill.at;
  }
  let usd: number | null = 0;
  for (const [amount, coin] of [[x, pair.x], [y, pair.y]] as const) {
    if (amount === 0n) continue;
    if (coin.usd === null || usd === null) {
      usd = null;
      continue;
    }
    usd += whole(amount, coin.decimals) * coin.usd;
  }
  return { count, xRaw: x.toString(), yRaw: y.toString(), usd, from };
}
