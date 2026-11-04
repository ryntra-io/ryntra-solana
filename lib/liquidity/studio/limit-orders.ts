/**
 * Liquidity Studio's limit orders on Meteora DLMM (CITY-97, spec E6): the
 * program's own limit order — not a one-sided range. An order sits in one bin
 * or spread over up to fifty bins on one side of the price; a trade that walks
 * through those bins fills it at the bin's price, and a filled order stays
 * filled when the price comes back (a one-sided range would buy back).
 *
 * Three actions, each built here for the person's wallet to sign:
 * - **place** — the order: X over the price (an ask), or Y under it (a bid);
 * - **cancel** — everything the order holds now back to the wallet: what has
 *   not filled, what the fills brought and the maker's share of the swap fee
 *   on them; the order's account is closed in the same transaction and its
 *   rent comes back. One action for "take what sold" and "cancel";
 * - **roll** — a filled order taken and the opposite order placed with what
 *   it brought, in one wallet prompt (two transactions): the Wheel.
 *
 * Money rules, the same as the venue's (`contract.ts`): amounts are base
 * units as decimal strings; the only key a build signs with is the fresh key
 * of the new order's account, which holds nothing; no Ryntra fee — `fees` is
 * empty, Meteora charges nothing to place or cancel, and the maker earns half
 * the pool's swap fee on what fills (`LIMIT_MAKER_SHARE_BPS`), never promised
 * as a yield.
 *
 * The SDK comes in through `deps.sdk` exactly as for the DLMM venue
 * (`dlmm.ts`): the routes hand in its ESM build, the tests its CommonJS one.
 */

import type { Amount } from "@ryntra/core/adapters";
import type DLMMClass from "@meteora-ag/dlmm";
import type { ParsedLimitOrderWithPubkey, TokenReserve } from "@meteora-ag/dlmm";
import { getTransferFeeConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";

import { LiquidityRefusal, SOLANA_NETWORK, type ChainSource, type LiquidityNotice, type LiquidityToken, type UnsignedLiquidityTx } from "./contract.ts";
import { DLMM_PROGRAM } from "./dlmm.ts";
import { amountOf, parseUnits, percentToBps, wholeUnits } from "./math.ts";

/** The most bins one order spreads over: the program's own bound. */
export const MAX_LIMIT_BINS = 50;
/** The maker's share of the pool's swap fee on what fills, basis points of that fee; the protocol keeps the rest. */
export const LIMIT_MAKER_SHARE_BPS = 5_000;
/** How long a preview holds before a build refuses it. */
export const LIMIT_PREVIEW_TTL_MS = 30_000;
/**
 * A roll places a little less than the taken order is read to bring: the program rounds each bin's figures on its own,
 * and an order that asked for one base unit more than arrived would be refused. What is left stays in the wallet.
 */
export const ROLL_MARGIN_BPS = 1;

/** The account's fixed part and one bin's record, as the program sizes them (the SDK's `LIMIT_ORDER_MIN_SIZE`, `…_BIN_DATA_SIZE`). */
const LIMIT_ORDER_FIXED_BYTES = 8 + 112;
const LIMIT_ORDER_BIN_BYTES = 32;

/** An ask gives X for Y over the price; a bid gives Y for X under it. */
export type LimitSide = "ask" | "bid";
export const LIMIT_SIDES: readonly LimitSide[] = ["ask", "bid"];

export type LimitStatus = "open" | "partial" | "filled";

export type LimitBins = Readonly<{ lower: number; upper: number }>;

export type PlaceLimitRequest = Readonly<{
  pool: string;
  owner: string;
  side: LimitSide;
  /** Base units of what goes in: X on an ask, Y on a bid. Spread evenly over the bins. */
  amount: string;
  /** Inclusive; an ask's bins all over the active bin, a bid's all under it. */
  bins: LimitBins;
}>;

export type CancelLimitRequest = Readonly<{ order: string; owner: string }>;

/** A filled order taken, and the opposite order placed in `bins` with what it brought. */
export type RollLimitRequest = Readonly<{ order: string; owner: string; bins: LimitBins }>;

/** SOL besides the deposit: the order's own account (back on close), the pool's bin arrays and bitmap (not back). */
export type LimitRent = Readonly<{
  what: "limit_order" | "bin_arrays" | "bitmap_extension";
  direction: "pay" | "return";
  lamports: string;
  refundable: boolean;
}>;

/** A pool as a limit order reads it. */
export type LimitPool = Readonly<{
  venue: "meteora-dlmm";
  network: typeof SOLANA_NETWORK;
  address: string;
  tokenX: LiquidityToken;
  tokenY: LiquidityToken;
  /** Y per one X in whole tokens at the active bin, to ten digits. For reading, never for sizing money. */
  price: string;
  activeBin: number;
  binStepBps: number;
  /** The fee a trade pays now, basis points: what the maker's half is of. */
  feeBps: number;
  enabled: boolean;
  /** Whether the program takes limit orders on this pool (none on a pool that runs farm rewards). */
  limitOrders: boolean;
  source: ChainSource;
}>;

export type LimitOrderBin = Readonly<{
  bin: number;
  /** Y per one X in whole tokens. */
  price: string;
  deposit: Amount;
  unfilled: Amount;
  /** What the fills brought, in the other token. */
  proceeds: Amount;
  status: LimitStatus;
}>;

export type LimitOrderView = Readonly<{
  venue: "meteora-dlmm";
  network: typeof SOLANA_NETWORK;
  /** The order's account. */
  address: string;
  pool: string;
  owner: string;
  side: LimitSide;
  tokenX: LiquidityToken;
  tokenY: LiquidityToken;
  bins: readonly LimitOrderBin[];
  lowerPrice: string;
  upperPrice: string;
  /** In the side's own token: X on an ask, Y on a bid. */
  deposit: Amount;
  unfilled: Amount;
  /** In the other token. */
  proceeds: Amount;
  makerFees: Readonly<{ x: Amount; y: Amount }>;
  /** What a cancel sends back now, after a token's own transfer fee. */
  withdrawable: Readonly<{ x: Amount; y: Amount }>;
  /** Share of the deposit that has filled, 0–10 000. */
  filledBps: number;
  status: LimitStatus;
  /** The pool's price and active bin at the read. */
  price: string;
  activeBin: number;
  source: ChainSource;
}>;

/** One side's order as it will stand: its bins and prices, what goes in, and what arrives if every bin fills. */
export type LimitPlacement = Readonly<{
  side: LimitSide;
  bins: LimitBins;
  lowerPrice: string;
  upperPrice: string;
  /** Per bin, base units, nearest the price first. */
  spread: readonly Readonly<{ bin: number; amount: string }>[];
  deposit: Amount;
  /** What the fills bring if every bin fills, before the maker's share of the fee — an estimate at the bins' own prices. */
  fullFill: Amount;
}>;

type LimitPreviewBase = Readonly<{
  venue: "meteora-dlmm";
  pool: string;
  /** Ryntra's fee rows: none. Meteora charges nothing to place or cancel. */
  fees: readonly never[];
  rent: readonly LimitRent[];
  transactions: number;
  notices: readonly LiquidityNotice[];
  /** The pool's price and active bin the preview was made at. */
  price: string;
  activeBin: number;
  /** The maker's share of the swap fee on what fills, basis points of that fee. */
  makerShareBps: number;
  /** The pool's swap fee now, basis points. */
  feeBps: number;
  at: number;
  expiresAt: number;
}>;

export type PlaceLimitPreview = LimitPreviewBase & Readonly<{ action: "limit_place"; request: PlaceLimitRequest; place: LimitPlacement }>;

export type CancelLimitPreview = LimitPreviewBase &
  Readonly<{
    action: "limit_cancel";
    request: CancelLimitRequest;
    order: LimitOrderView;
    /** What comes back to the wallet. */
    back: Readonly<{ x: Amount; y: Amount }>;
  }>;

export type RollLimitPreview = LimitPreviewBase &
  Readonly<{
    action: "limit_roll";
    request: RollLimitRequest;
    order: LimitOrderView;
    back: Readonly<{ x: Amount; y: Amount }>;
    place: LimitPlacement;
  }>;

export type LimitPreview = PlaceLimitPreview | CancelLimitPreview | RollLimitPreview;
export type LimitAction = LimitPreview["action"];
export const LIMIT_ACTIONS: readonly LimitAction[] = ["limit_place", "limit_cancel", "limit_roll"];

export type BuiltLimit = Readonly<{
  preview: LimitPreview;
  transactions: readonly UnsignedLiquidityTx[];
  feePayer: string;
  validUntil: string;
  /** The order acted on — for a place, the new account; for a roll, the new order's account. */
  order: string;
}>;

export type LimitVenue = Readonly<{
  id: "meteora-dlmm";
  program: string;
  pool(address: string): Promise<LimitPool>;
  /** Every limit order the wallet holds on DLMM, or in one pool. */
  orders(owner: string, options?: Readonly<{ pool?: string }>): Promise<readonly LimitOrderView[]>;
  previewPlace(request: PlaceLimitRequest): Promise<PlaceLimitPreview>;
  previewCancel(request: CancelLimitRequest): Promise<CancelLimitPreview>;
  previewRoll(request: RollLimitRequest): Promise<RollLimitPreview>;
  /** As the venue's builds: the preview is the caller's and is not trusted — it is made again on the chain and must agree. */
  buildPlace(preview: PlaceLimitPreview): Promise<BuiltLimit>;
  buildCancel(preview: CancelLimitPreview): Promise<BuiltLimit>;
  buildRoll(preview: RollLimitPreview): Promise<BuiltLimit>;
}>;

/** The pieces of `@meteora-ag/dlmm` limit orders use, from whichever build the caller can load. */
export type DlmmLimitSdk = Readonly<{
  DLMM: typeof DLMMClass;
  createProgram: typeof import("@meteora-ag/dlmm").createProgram;
  getPriceOfBinByBinId: typeof import("@meteora-ag/dlmm").getPriceOfBinByBinId;
  isSupportLimitOrder: typeof import("@meteora-ag/dlmm").isSupportLimitOrder;
  limitOrderFilter: typeof import("@meteora-ag/dlmm").limitOrderFilter;
  limitOrderOwnerFilter: typeof import("@meteora-ag/dlmm").limitOrderOwnerFilter;
}>;

export type LimitVenueDeps = Readonly<{
  connection: Connection;
  sdk: DlmmLimitSdk;
  /** A new order's key; the tests pass a fixed one. */
  newKeypair?: () => Keypair;
  now?: () => number;
  /** `devnet` for the devnet pass: the program id is the same, the SDK is told so. */
  cluster?: "mainnet-beta" | "devnet";
}>;

type Dlmm = InstanceType<typeof DLMMClass>;
type ParsedOrder = ParsedLimitOrderWithPubkey["limitOrderData"];

/* ------------------------------------------------------------- pure parts */

/**
 * The SDK's figure in whole tokens (`Decimal.toString()`: "12.5", "1e-7", "1.2e+21") back to base units, floored.
 * The SDK divides base units by 10^decimals to print them; this undoes it without a float.
 */
export function unitsFromTokens(text: string, decimals: number): bigint {
  const match = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(text).trim());
  if (!match) throw new Error(`Not a non-negative token figure: ${String(text).slice(0, 40)}`);
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "") || "0";
  const shift = Number(exponent) - fraction.length + decimals;
  if (shift >= 0) return BigInt(digits) * 10n ** BigInt(shift);
  const cut = digits.length + shift;
  return cut <= 0 ? 0n : BigInt(digits.slice(0, cut));
}

/** The bins of an order, checked: ordered whole numbers, at most fifty, within the pool's bin ids. */
export function assertLimitBins(bins: LimitBins, maxBinId: number): number {
  const { lower, upper } = bins;
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper) throw new LiquidityRefusal("RANGE_INVALID", "The order's bins are not ordered whole numbers.");
  if (Math.abs(lower) > maxBinId || Math.abs(upper) > maxBinId) throw new LiquidityRefusal("RANGE_INVALID", "The order's bins are outside the pool's bins.");
  const width = upper - lower + 1;
  if (width > MAX_LIMIT_BINS) throw new LiquidityRefusal("RANGE_TOO_WIDE", `One order spreads over at most ${MAX_LIMIT_BINS} bins.`);
  return width;
}

/** An ask sits wholly over the price, a bid wholly under it: an order on the wrong side would trade at once. */
export function sideFits(side: LimitSide, bins: LimitBins, activeBin: number): boolean {
  return side === "ask" ? bins.lower > activeBin : bins.upper < activeBin;
}

/**
 * The amount spread evenly over the bins, nearest the price first; the remainder of the division goes to the bin
 * nearest the price. Every bin gets something, or the order is refused.
 */
export function spreadAmount(side: LimitSide, bins: LimitBins, amount: bigint): readonly Readonly<{ bin: number; amount: bigint }>[] {
  const width = bins.upper - bins.lower + 1;
  const each = amount / BigInt(width);
  if (each <= 0n) throw new LiquidityRefusal("AMOUNT_ZERO", "The amount is too small to spread over the bins.");
  const rest = amount - each * BigInt(width);
  const ids = Array.from({ length: width }, (_, i) => (side === "ask" ? bins.lower + i : bins.upper - i));
  return ids.map((bin, i) => ({ bin, amount: i === 0 ? each + rest : each }));
}

/** An order's state from its bins: all filled, some, or none. */
export function statusOf(bins: readonly Readonly<{ status: LimitStatus }>[]): LimitStatus {
  if (bins.length > 0 && bins.every((bin) => bin.status === "filled")) return "filled";
  return bins.some((bin) => bin.status !== "open") ? "partial" : "open";
}

const STATUS_OF_SDK: readonly LimitStatus[] = ["open", "partial", "filled"];

/** What a roll may place of what a filled order brings: a hair less, so the program's own rounding never refuses it. */
export function rollAmount(proceeds: bigint): bigint {
  const margin = (proceeds * BigInt(ROLL_MARGIN_BPS)) / 10_000n;
  const out = proceeds - (margin > 1n ? margin : 1n);
  return out > 0n ? out : 0n;
}

/* ------------------------------------------------------------------ venue */

function key(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new LiquidityRefusal("BAD_REQUEST", `${field} is not a Solana address.`);
  }
}

/** The pair's own bound on a bin id for its step. */
function maxBinIdFor(binStep: number): number {
  return Math.floor(Math.log(2 ** 64) / Math.log(1 + binStep / 10_000));
}

export function createLimitVenue(deps: LimitVenueDeps): LimitVenue {
  const { connection, sdk } = deps;
  const now = deps.now ?? Date.now;
  const cluster = deps.cluster ?? "mainnet-beta";
  const newKeypair = deps.newKeypair ?? (() => Keypair.generate());
  const program = sdk.createProgram(connection, { cluster });

  const rentOf = async (bytes: number): Promise<string> => String(await connection.getMinimumBalanceForRentExemption(bytes, "confirmed"));

  const open = async (pool: PublicKey): Promise<Dlmm> => {
    try {
      return await sdk.DLMM.create(connection, pool, { cluster });
    } catch (error) {
      const info = await connection.getAccountInfo(pool, "confirmed");
      if (!info || info.owner.toBase58() !== DLMM_PROGRAM) throw new LiquidityRefusal("POOL_NOT_FOUND", "No DLMM pool at the address.");
      throw error;
    }
  };

  const tokenOf = (reserve: TokenReserve): LiquidityToken => ({ mint: reserve.publicKey.toBase58(), decimals: reserve.mint.decimals, program: reserve.owner.toBase58() });
  const hasTransferFee = (reserve: TokenReserve): boolean => reserve.owner.equals(TOKEN_2022_PROGRAM_ID) && getTransferFeeConfig(reserve.mint) !== null;

  /** Y per one X at a bin, in whole tokens, to ten significant digits. */
  const binPrice = (binId: number, binStep: number, x: LiquidityToken, y: LiquidityToken): string =>
    sdk.getPriceOfBinByBinId(binId, binStep).mul(10 ** (x.decimals - y.decimals)).toSignificantDigits(10).toFixed();

  const source = async (): Promise<ChainSource> => {
    const slot = await connection.getSlot("confirmed").catch(() => null);
    return { kind: "chain", program: DLMM_PROGRAM, slot, at: now() };
  };

  const poolOf = (dlmm: Dlmm, at: ChainSource): LimitPool => {
    const x = tokenOf(dlmm.tokenX);
    const y = tokenOf(dlmm.tokenY);
    const pair = dlmm.lbPair;
    return {
      venue: "meteora-dlmm",
      network: SOLANA_NETWORK,
      address: dlmm.pubkey.toBase58(),
      tokenX: x,
      tokenY: y,
      price: binPrice(pair.activeId, pair.binStep, x, y),
      activeBin: pair.activeId,
      binStepBps: pair.binStep,
      feeBps: percentToBps(dlmm.getDynamicFee().toString()),
      enabled: pair.status === 0,
      limitOrders: sdk.isSupportLimitOrder(pair),
      source: at,
    };
  };

  /** What the fills of `amount` at a bin bring in the other token, base units, floored: an ask is paid Y, a bid X. */
  const fillAt = (side: LimitSide, bin: number, binStep: number, amount: bigint): bigint => {
    const price = sdk.getPriceOfBinByBinId(bin, binStep);
    const value = side === "ask" ? price.mul(amount.toString()) : price.pow(-1).mul(amount.toString());
    return wholeUnits(value.floor().toFixed());
  };

  const placement = (dlmm: Dlmm, pool: LimitPool, side: LimitSide, bins: LimitBins, amount: bigint): LimitPlacement & Readonly<{ rows: readonly Readonly<{ bin: number; amount: bigint }>[] }> => {
    const rows = spreadAmount(side, bins, amount);
    const binStep = dlmm.lbPair.binStep;
    let full = 0n;
    for (const row of rows) full += fillAt(side, row.bin, binStep, row.amount);
    const [given, got] = side === "ask" ? [pool.tokenX, pool.tokenY] : [pool.tokenY, pool.tokenX];
    return {
      side,
      bins,
      lowerPrice: binPrice(bins.lower, binStep, pool.tokenX, pool.tokenY),
      upperPrice: binPrice(bins.upper, binStep, pool.tokenX, pool.tokenY),
      spread: rows.map((row) => ({ bin: row.bin, amount: row.amount.toString() })),
      deposit: amountOf(given, amount),
      fullFill: amountOf(got, full),
      rows,
    };
  };

  /** The rent a new order pays: its account (back on cancel), the pool's bin arrays and bitmap it opens (not back). */
  const placeRent = async (dlmm: Dlmm, rows: readonly Readonly<{ bin: number }>[]): Promise<LimitRent[]> => {
    const rent: LimitRent[] = [{ what: "limit_order", direction: "pay", lamports: await rentOf(LIMIT_ORDER_FIXED_BYTES + rows.length * LIMIT_ORDER_BIN_BYTES), refundable: true }];
    const ascending = [...rows].map((row) => ({ id: row.bin })).sort((a, b) => a.id - b.id);
    const quote = await dlmm.quoteCreateLimitOrder({ bins: ascending });
    if (quote.binArraysCount > 0) rent.push({ what: "bin_arrays", direction: "pay", lamports: (BigInt(await rentOf(program.account.binArray.size)) * BigInt(quote.binArraysCount)).toString(), refundable: false });
    if (quote.bitmapExtensionCost > 0) rent.push({ what: "bitmap_extension", direction: "pay", lamports: await rentOf(program.account.binArrayBitmapExtension.size), refundable: false });
    return rent;
  };

  const notices = (dlmm: Dlmm): LiquidityNotice[] => (hasTransferFee(dlmm.tokenX) || hasTransferFee(dlmm.tokenY) ? ["transfer_fee"] : []);

  const expiry = () => {
    const at = now();
    return { at, expiresAt: at + LIMIT_PREVIEW_TTL_MS };
  };

  const notExpired = (preview: { expiresAt: number }): void => {
    if (now() > preview.expiresAt) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The preview is older than its window; preview again.");
  };

  const toView = (dlmm: Dlmm, address: PublicKey, owner: string, parsed: ParsedOrder, at: ChainSource): LimitOrderView => {
    const pool = poolOf(dlmm, at);
    const x = pool.tokenX;
    const y = pool.tokenY;
    const live = parsed.limitOrderBinData.filter((bin) => !bin.empty);
    const shown = live.length ? live : parsed.limitOrderBinData;
    const side: LimitSide = shown.some((bin) => bin.isAskSide) ? "ask" : "bid";
    const [given, got] = side === "ask" ? [x, y] : [y, x];
    const bins = shown
      .map((bin) => ({
        bin: bin.binId,
        price: binPrice(bin.binId, pool.binStepBps, x, y),
        deposit: amountOf(given, unitsFromTokens(side === "ask" ? bin.depositAmountX : bin.depositAmountY, given.decimals)),
        unfilled: amountOf(given, unitsFromTokens(side === "ask" ? bin.unfilledAmountX : bin.unfilledAmountY, given.decimals)),
        proceeds: amountOf(got, unitsFromTokens(side === "ask" ? bin.swappedAmountY : bin.swappedAmountX, got.decimals)),
        status: STATUS_OF_SDK[bin.status] ?? "open",
      }))
      .sort((a, b) => a.bin - b.bin);
    const sum = (rows: readonly { units: string }[]) => rows.reduce((total, row) => total + BigInt(row.units), 0n);
    const deposit = sum(bins.map((b) => b.deposit));
    const unfilled = sum(bins.map((b) => b.unfilled));
    const filled = deposit > unfilled ? deposit - unfilled : 0n;
    return {
      venue: "meteora-dlmm",
      network: SOLANA_NETWORK,
      address: address.toBase58(),
      pool: pool.address,
      owner,
      side,
      tokenX: x,
      tokenY: y,
      bins,
      lowerPrice: bins[0]?.price ?? pool.price,
      upperPrice: bins[bins.length - 1]?.price ?? pool.price,
      deposit: amountOf(given, deposit),
      unfilled: amountOf(given, unfilled),
      proceeds: amountOf(got, sum(bins.map((b) => b.proceeds))),
      makerFees: { x: amountOf(x, unitsFromTokens(parsed.totalFeeAmountX, x.decimals)), y: amountOf(y, unitsFromTokens(parsed.totalFeeAmountY, y.decimals)) },
      withdrawable: {
        x: amountOf(x, unitsFromTokens(parsed.transferFeeExcludedWithdrawableAmountX, x.decimals)),
        y: amountOf(y, unitsFromTokens(parsed.transferFeeExcludedWithdrawableAmountY, y.decimals)),
      },
      filledBps: deposit > 0n ? Number((filled * 10_000n) / deposit) : 0,
      status: statusOf(bins),
      price: pool.price,
      activeBin: pool.activeBin,
      source: at,
    };
  };

  /** The order, its pool and the person's right to act on it — every action on an order starts here. */
  const ownedOrder = async (orderAddress: string, ownerAddress: string) => {
    const orderKey = key(orderAddress, "order");
    const owner = key(ownerAddress, "owner");
    const info = await connection.getAccountInfo(orderKey, "confirmed");
    if (!info || info.owner.toBase58() !== DLMM_PROGRAM || info.data.length < 72) throw new LiquidityRefusal("ORDER_NOT_FOUND", "No DLMM limit order at the address.");
    /* The account opens with its discriminator, then the pool and the owner. */
    const lbPair = new PublicKey(info.data.subarray(8, 40));
    const holder = new PublicKey(info.data.subarray(40, 72));
    if (!holder.equals(owner)) throw new LiquidityRefusal("NOT_OWNER", "The wallet does not own this order.");
    const dlmm = await open(lbPair);
    let parsed: ParsedLimitOrderWithPubkey;
    try {
      parsed = await dlmm.getLimitOrder(orderKey);
    } catch (error) {
      if (error instanceof Error && /Unknown position account/.test(error.message)) throw new LiquidityRefusal("ORDER_NOT_FOUND", "The account is not a limit order.");
      throw error;
    }
    const view = toView(dlmm, orderKey, owner.toBase58(), parsed.limitOrderData, await source());
    const openBins = parsed.limitOrderData.limitOrderBinData.filter((bin) => !bin.empty).map((bin) => bin.binId);
    return { orderKey, owner, dlmm, view, openBins, rentLamports: info.lamports };
  };

  const placePlan = async (request: PlaceLimitRequest) => {
    const owner = key(request.owner, "owner");
    if (request.side !== "ask" && request.side !== "bid") throw new LiquidityRefusal("BAD_REQUEST", "The side is ask or bid.");
    const amount = parseUnits(request.amount, "amount");
    if (amount === 0n) throw new LiquidityRefusal("AMOUNT_ZERO", "The amount is zero.");
    const dlmm = await open(key(request.pool, "pool"));
    assertLimitBins(request.bins, maxBinIdFor(dlmm.lbPair.binStep));
    const pool = poolOf(dlmm, await source());
    if (!pool.enabled) throw new LiquidityRefusal("POOL_DISABLED", "The pool takes no orders now.");
    if (!pool.limitOrders) throw new LiquidityRefusal("LIMIT_NOT_SUPPORTED", "The pool takes no limit orders.");
    if (!sideFits(request.side, request.bins, pool.activeBin)) throw new LiquidityRefusal("SIDE_NOT_ACCEPTED", "An ask sits over the price and a bid under it.");
    const place = placement(dlmm, pool, request.side, request.bins, amount);
    const preview: PlaceLimitPreview = {
      action: "limit_place",
      venue: "meteora-dlmm",
      pool: pool.address,
      request: { pool: pool.address, owner: owner.toBase58(), side: request.side, amount: amount.toString(), bins: { lower: request.bins.lower, upper: request.bins.upper } },
      place: withoutRows(place),
      fees: [],
      rent: await placeRent(dlmm, place.rows),
      transactions: 1,
      notices: notices(dlmm),
      price: pool.price,
      activeBin: pool.activeBin,
      makerShareBps: LIMIT_MAKER_SHARE_BPS,
      feeBps: pool.feeBps,
      ...expiry(),
    };
    return { preview, dlmm, owner, rows: place.rows };
  };

  const cancelPlan = async (request: CancelLimitRequest) => {
    const held = await ownedOrder(request.order, request.owner);
    const preview: CancelLimitPreview = {
      action: "limit_cancel",
      venue: "meteora-dlmm",
      pool: held.view.pool,
      request: { order: held.orderKey.toBase58(), owner: held.owner.toBase58() },
      order: held.view,
      back: held.view.withdrawable,
      fees: [],
      rent: [{ what: "limit_order", direction: "return", lamports: String(held.rentLamports), refundable: true }],
      transactions: 1,
      notices: notices(held.dlmm),
      price: held.view.price,
      activeBin: held.view.activeBin,
      makerShareBps: LIMIT_MAKER_SHARE_BPS,
      feeBps: poolOf(held.dlmm, held.view.source).feeBps,
      ...expiry(),
    };
    return { preview, held };
  };

  const rollPlan = async (request: RollLimitRequest) => {
    const held = await ownedOrder(request.order, request.owner);
    if (held.view.status !== "filled") throw new LiquidityRefusal("NOT_FILLED", "Only a filled order rolls into the other side.");
    /* A token that keeps a fee on every transfer makes the amount that arrives smaller than the one the roll would place. */
    if (hasTransferFee(held.dlmm.tokenX) || hasTransferFee(held.dlmm.tokenY)) throw new LiquidityRefusal("LIMIT_NOT_SUPPORTED", "A token with a transfer fee does not roll.");
    assertLimitBins(request.bins, maxBinIdFor(held.dlmm.lbPair.binStep));
    const pool = poolOf(held.dlmm, held.view.source);
    if (!pool.enabled) throw new LiquidityRefusal("POOL_DISABLED", "The pool takes no orders now.");
    if (!pool.limitOrders) throw new LiquidityRefusal("LIMIT_NOT_SUPPORTED", "The pool takes no limit orders.");
    const side: LimitSide = held.view.side === "ask" ? "bid" : "ask";
    if (!sideFits(side, request.bins, pool.activeBin)) throw new LiquidityRefusal("SIDE_NOT_ACCEPTED", "An ask sits over the price and a bid under it.");
    const proceeds = BigInt(side === "bid" ? held.view.withdrawable.y.units : held.view.withdrawable.x.units);
    const amount = rollAmount(proceeds);
    if (amount === 0n) throw new LiquidityRefusal("AMOUNT_ZERO", "The order brought nothing to roll.");
    const place = placement(held.dlmm, pool, side, request.bins, amount);
    const preview: RollLimitPreview = {
      action: "limit_roll",
      venue: "meteora-dlmm",
      pool: pool.address,
      request: { order: held.orderKey.toBase58(), owner: held.owner.toBase58(), bins: { lower: request.bins.lower, upper: request.bins.upper } },
      order: held.view,
      back: held.view.withdrawable,
      place: withoutRows(place),
      fees: [],
      rent: [{ what: "limit_order", direction: "return", lamports: String(held.rentLamports), refundable: true }, ...(await placeRent(held.dlmm, place.rows))],
      transactions: 2,
      notices: notices(held.dlmm),
      price: pool.price,
      activeBin: pool.activeBin,
      makerShareBps: LIMIT_MAKER_SHARE_BPS,
      feeBps: pool.feeBps,
      ...expiry(),
    };
    return { preview, held, rows: place.rows, side };
  };

  const seal = async (transactions: readonly Transaction[], owner: PublicKey, signers: readonly Keypair[]) => {
    const latest = await connection.getLatestBlockhash("confirmed");
    const sealed = transactions.map((tx) => {
      tx.feePayer = owner;
      tx.recentBlockhash = latest.blockhash;
      tx.lastValidBlockHeight = latest.lastValidBlockHeight;
      const mine = signers.filter((signer) => tx.instructions.some((ix) => ix.keys.some((meta) => meta.isSigner && meta.pubkey.equals(signer.publicKey))));
      if (mine.length) tx.partialSign(...mine);
      return {
        wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
        presigned: mine.map((signer) => signer.publicKey.toBase58()),
      };
    });
    return { transactions: sealed, feePayer: owner.toBase58(), validUntil: String(latest.lastValidBlockHeight) };
  };

  const placeTx = (dlmm: Dlmm, owner: PublicKey, orderKey: PublicKey, side: LimitSide, rows: readonly Readonly<{ bin: number; amount: bigint }>[]) =>
    dlmm.placeLimitOrder({
      owner,
      payer: owner,
      sender: owner,
      limitOrder: orderKey,
      params: {
        isAskSide: side === "ask",
        relativeBin: null,
        /* The program takes the bins in increasing order. */
        bins: [...rows].sort((a, b) => a.bin - b.bin).map((row) => ({ id: row.bin, amount: new BN(row.amount.toString()) })),
      },
    });

  const cancelTx = (held: Awaited<ReturnType<typeof ownedOrder>>) =>
    held.openBins.length
      ? held.dlmm.cancelLimitOrder({ limitOrderPubkey: held.orderKey, owner: held.owner, rentReceiver: held.owner, binIds: held.openBins })
      : held.dlmm.closeLimitOrderIfEmpty({ limitOrder: held.orderKey, owner: held.owner, rentReceiver: held.owner });

  /** The fresh preview must say what the given one said: the same order, the same side, the same bins and amounts. */
  const samePlace = (given: LimitPlacement, fresh: LimitPlacement): boolean =>
    given.side === fresh.side && given.bins.lower === fresh.bins.lower && given.bins.upper === fresh.bins.upper && given.deposit.units === fresh.deposit.units && given.deposit.asset === fresh.deposit.asset;

  return {
    id: "meteora-dlmm",
    program: DLMM_PROGRAM,

    async pool(address) {
      return poolOf(await open(key(address, "pool")), await source());
    },

    async orders(ownerAddress, options) {
      const owner = key(ownerAddress, "owner");
      const at = await source();
      let pairs: PublicKey[];
      if (options?.pool) {
        pairs = [key(options.pool, "pool")];
      } else {
        const accounts = await connection.getProgramAccounts(new PublicKey(DLMM_PROGRAM), {
          commitment: "confirmed",
          filters: [sdk.limitOrderFilter(), sdk.limitOrderOwnerFilter(owner)],
          dataSlice: { offset: 8, length: 32 },
        });
        const seen = new Map<string, PublicKey>();
        for (const account of accounts) {
          if (account.account.data.length < 32) continue;
          const pair = new PublicKey(account.account.data.subarray(0, 32));
          seen.set(pair.toBase58(), pair);
        }
        pairs = [...seen.values()];
      }
      const out: LimitOrderView[] = [];
      for (const pair of pairs) {
        const dlmm = await open(pair);
        const orders = await dlmm.getLimitOrderByUserAndLbPair(owner);
        for (const order of orders) out.push(toView(dlmm, order.publicKey, owner.toBase58(), order.limitOrderData, at));
      }
      return out.sort((a, b) => a.pool.localeCompare(b.pool) || a.address.localeCompare(b.address));
    },

    async previewPlace(request) {
      return (await placePlan(request)).preview;
    },

    async buildPlace(given) {
      notExpired(given);
      let plan: Awaited<ReturnType<typeof placePlan>>;
      try {
        plan = await placePlan(given.request);
      } catch (error) {
        /* The price walked into the order's bins since the preview: placed now it would trade at once. */
        if (error instanceof LiquidityRefusal && error.code === "SIDE_NOT_ACCEPTED") throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price reached the order's bins since the preview.");
        throw error;
      }
      if (!samePlace(given.place, plan.preview.place)) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The order no longer matches the preview.");
      const orderKey = newKeypair();
      const tx = await placeTx(plan.dlmm, plan.owner, orderKey.publicKey, plan.preview.request.side, plan.rows);
      return { preview: plan.preview, order: orderKey.publicKey.toBase58(), ...(await seal([tx], plan.owner, [orderKey])) };
    },

    async previewCancel(request) {
      return (await cancelPlan(request)).preview;
    },

    async buildCancel(given) {
      notExpired(given);
      const { preview, held } = await cancelPlan(given.request);
      const tx = await cancelTx(held);
      return { preview, order: preview.request.order, ...(await seal([tx], held.owner, [])) };
    },

    async previewRoll(request) {
      return (await rollPlan(request)).preview;
    },

    async buildRoll(given) {
      notExpired(given);
      let plan: Awaited<ReturnType<typeof rollPlan>>;
      try {
        plan = await rollPlan(given.request);
      } catch (error) {
        if (error instanceof LiquidityRefusal && error.code === "SIDE_NOT_ACCEPTED") throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price reached the new order's bins since the preview.");
        throw error;
      }
      if (!samePlace(given.place, plan.preview.place)) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The roll no longer matches the preview.");
      const orderKey = newKeypair();
      const take = await cancelTx(plan.held);
      const next = await placeTx(plan.held.dlmm, plan.held.owner, orderKey.publicKey, plan.side, plan.rows);
      return { preview: plan.preview, order: orderKey.publicKey.toBase58(), ...(await seal([take, next], plan.held.owner, [orderKey])) };
    },
  };
}

function withoutRows(place: LimitPlacement & Readonly<{ rows: unknown }>): LimitPlacement {
  const { rows: _rows, ...rest } = place;
  return rest;
}
