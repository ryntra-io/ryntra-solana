/**
 * What the launch's review says it costs, and whether the wallet holds it (SOL-C10: UX-400, UX-402). Pure and
 * client-safe: numbers only, read by the form and held by `../sol-c10.test.mjs`.
 *
 * - **The network's cost**, in SOL: before the build, the rent and fee as measured on devnet (05.10–06.10); the build
 *   replaces it with the figure it simulated. «Розширений» adds its config's rent until the config is made.
 * - **The first buy's trading fee**, in the pair: bought in the creation itself at the curve's end fee
 *   (`PresetTerms.firstBuy.atEndFee`), taken from the amount on the way in, rounded up — as Meteora's program counts it
 *   (DBC `getExcludedFeeAmount`). It is part of the first buy's amount, not on top of it.
 * - **The wallet's funds**: SOL for the network's cost and a margin for the signatures' fees, the pair for the first
 *   buy. A balance not read is never taken as zero: the review says «—» and does not block.
 */

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** The network's cost before the build, SOL: the creation's rent and fee; with the lock its rent too; with the sharing of the creator's fees the vault's two accounts. */
export const COST_ESTIMATE_SOL = { plain: "0.010", locked: "0.014", shared: "0.018", sharedLocked: "0.022" } as const;
/** «Розширений»'s config before its build, SOL: a DBC `PoolConfig` is 1 048 bytes — 8 184 960 lamports of rent — and one signature's fee. */
export const ADVANCED_CONFIG_ESTIMATE_SOL = "0.0082";
/** Kept back in SOL beyond the estimate: the fees of the launch's signatures and a priority fee (`lib/solana`), so the wallet is not left unable to sign. */
export const SOL_MARGIN_LAMPORTS = 2_000_000n;

/** A decimal SOL figure, as lamports. */
export function solToLamports(sol: string): bigint {
  const [whole = "0", fraction = ""] = sol.split(".");
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt((fraction + "000000000").slice(0, 9));
}

/** The network's cost before the build, by what the launch carries. */
export function networkEstimateSol(args: Readonly<{ sharing: boolean; locked: boolean }>): string {
  return args.sharing ? (args.locked ? COST_ESTIMATE_SOL.sharedLocked : COST_ESTIMATE_SOL.shared) : args.locked ? COST_ESTIMATE_SOL.locked : COST_ESTIMATE_SOL.plain;
}

/** The first buy's trading fee, raw units of the pair: the curve's end fee of the amount, rounded up. */
export function firstBuyFeeRaw(amountRaw: bigint, endFeeBps: number): bigint {
  if (amountRaw <= 0n || endFeeBps <= 0) return 0n;
  const bps = BigInt(Math.round(endFeeBps));
  return (amountRaw * bps + 9_999n) / 10_000n;
}

/** One balance the review reads: a figure, or not read now. */
export type Balance = Readonly<{ read: true; raw: bigint } | { read: false }>;

/** The holdings as the wallet's reader gives them — the native SOL row has no mint. */
export type HoldingLike = Readonly<{ kind?: "NATIVE_SOL" | "TOKEN"; mint: string | null; amountRaw: string }>;

/**
 * The wallet's SOL and pair, from a read of its holdings. A read not finished, failed or partial without the row is
 * «not read»; a complete read without the row is zero.
 */
export function fundsOf(read: Readonly<{ status: "idle" | "loading" | "ready" | "error"; data: readonly HoldingLike[]; complete: boolean }> | null, pairMint: string): Readonly<{ sol: Balance; pair: Balance }> {
  if (!read || read.status !== "ready") return { sol: { read: false }, pair: { read: false } };
  const balance = (row: HoldingLike | undefined): Balance => (row ? { read: true, raw: BigInt(row.amountRaw) } : read.complete ? { read: true, raw: 0n } : { read: false });
  return {
    sol: balance(read.data.find((row) => row.kind === "NATIVE_SOL" || (row.mint === null && row.kind !== "TOKEN"))),
    pair: balance(read.data.find((row) => row.mint === pairMint)),
  };
}

/** What the wallet lacks for the launch, raw; null when it holds enough or when a balance it would need was not read. */
export function shortfallOf(funds: Readonly<{ sol: Balance; pair: Balance }>, need: Readonly<{ solLamports: bigint; pairRaw: bigint }>): Readonly<{ solLamports: bigint; pairRaw: bigint }> | null {
  const solNeed = need.solLamports + SOL_MARGIN_LAMPORTS;
  const solShort = funds.sol.read ? (funds.sol.raw >= solNeed ? 0n : solNeed - funds.sol.raw) : 0n;
  const pairShort = need.pairRaw > 0n && funds.pair.read ? (funds.pair.raw >= need.pairRaw ? 0n : need.pairRaw - funds.pair.raw) : 0n;
  return solShort > 0n || pairShort > 0n ? { solLamports: solShort, pairRaw: pairShort } : null;
}

/** The most the first buy may spend: the cap's amount, and no more than the wallet holds of the pair when that was read. */
export function maxFirstBuyRaw(capMaxRaw: bigint, pair: Balance): bigint {
  return pair.read && pair.raw < capMaxRaw ? pair.raw : capMaxRaw;
}

/**
 * The review's SOL, raw: the network's cost — the launch build's simulated figure once there is one for these very
 * inputs, else the estimate — and «Розширений»'s config while the config for this choice is still to be signed — its
 * build's figure for this choice, else the estimate. `exact` only when every part is a simulated figure.
 */
export function reviewLamports(args: Readonly<{ estimateSol: string; launchLamports: string | null; configPending: boolean; configLamports: string | null }>): Readonly<{ network: bigint; config: bigint; total: bigint; exact: boolean }> {
  const network = args.launchLamports !== null ? BigInt(args.launchLamports) : solToLamports(args.estimateSol);
  const config = args.configPending ? (args.configLamports !== null ? BigInt(args.configLamports) : solToLamports(ADVANCED_CONFIG_ESTIMATE_SOL)) : 0n;
  return { network, config, total: network + config, exact: args.launchLamports !== null && (!args.configPending || args.configLamports !== null) };
}

/** An amount rounded up to `digits` decimals — what a shortfall or a cost shows is never less than it is. */
export function ceilToDigits(raw: bigint, decimals: number, digits: number): bigint {
  if (digits >= decimals || raw <= 0n) return raw < 0n ? 0n : raw;
  const unit = 10n ** BigInt(decimals - digits);
  return ((raw + unit - 1n) / unit) * unit;
}

