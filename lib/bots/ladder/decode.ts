/**
 * «What this bot can do», read from the transaction (spec «Що є лише в нас»
 * 5; the security review's fix 2): the bins, the amounts and the side of every
 * `place_limit_order` the wallet is about to sign, decoded from the
 * instruction's own bytes — never from the form. The window compares this with
 * the plan it showed and stops on any difference.
 *
 * `place_limit_order` (lb_clmm 0.12.0): 8 bytes discriminator · `is_ask_side`
 * bool · 16 bytes padding · `relative_bin` Option<{ active_id i32,
 * max_active_bin_slippage i32 }> · `bins` Vec<{ id i32, amount u64 }> ·
 * `remaining_accounts_info`.
 *
 * Pure: bytes in, facts out; no web3.js.
 */

import type { Rung } from "./plan.ts";

export const PLACE_DISCRIMINATOR = "6cb021ba92e501c5";

export type PlacedBin = Readonly<{ id: number; amount: bigint }>;

export type PlaceData = Readonly<{
  isAskSide: boolean;
  relativeBin: Readonly<{ activeId: number; maxSlippage: number }> | null;
  bins: readonly PlacedBin[];
}>;

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The parameters of a `place_limit_order`, or null when the bytes are not one. */
export function decodePlaceData(data: Uint8Array): PlaceData | null {
  if (data.length < 8 + 1 + 16 + 1 + 4 || hex(data.subarray(0, 8)) !== PLACE_DISCRIMINATOR) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  const flag = data[at];
  if (flag !== 0 && flag !== 1) return null;
  const isAskSide = flag === 1;
  at += 1 + 16;
  let relativeBin: PlaceData["relativeBin"] = null;
  const tag = data[at];
  at += 1;
  if (tag === 1) {
    if (data.length < at + 8) return null;
    relativeBin = { activeId: view.getInt32(at, true), maxSlippage: view.getInt32(at + 4, true) };
    at += 8;
  } else if (tag !== 0) return null;
  if (data.length < at + 4) return null;
  const count = view.getUint32(at, true);
  at += 4;
  if (count > 1_000 || data.length < at + count * 12) return null;
  const bins: PlacedBin[] = [];
  for (let i = 0; i < count; i += 1) {
    bins.push({ id: view.getInt32(at, true), amount: view.getBigUint64(at + 4, true) });
    at += 12;
  }
  return { isAskSide, relativeBin, bins };
}

/** Whether a decoded order is exactly a chunk of the plan: the same side, bins and amounts, in any order. */
export function matchesRungs(placed: PlaceData, isAskSide: boolean, rungs: readonly Rung[]): boolean {
  if (placed.isAskSide !== isAskSide || placed.relativeBin !== null || placed.bins.length !== rungs.length) return false;
  const want = new Map(rungs.map((rung) => [rung.binId, BigInt(rung.amountRaw)]));
  return placed.bins.every((bin) => want.get(bin.id) === bin.amount) && new Set(placed.bins.map((bin) => bin.id)).size === placed.bins.length;
}

/** One order as the transaction says it: where it sits, whose it is, what it holds. */
export type PlacedOrder = Readonly<{
  pool: string;
  limitOrder: string;
  owner: string;
  data: PlaceData;
}>;

export type LadderCanDo = Readonly<{
  pool: string;
  /** Every order belongs to this wallet, which alone can cancel it. */
  owner: string;
  side: "buy" | "exit";
  orders: number;
  steps: number;
  /** What leaves the wallet in all, raw units of the input. */
  maxInputRaw: string;
  /** The programs the transactions call beyond the wallet's own housekeeping. */
  programs: readonly string[];
  withdraw: "wallet";
  close: "cancel";
  source: "transaction";
}>;

/**
 * The card from the orders a set of transactions places. Null when they disagree with each other — two pools, two
 * owners, both sides — which is never one ladder leg.
 */
export function canDoFromOrders(orders: readonly PlacedOrder[], baseIsX: boolean, programs: readonly string[]): LadderCanDo | null {
  const first = orders[0];
  if (!first) return null;
  if (orders.some((order) => order.pool !== first.pool || order.owner !== first.owner || order.data.isAskSide !== first.data.isAskSide)) return null;
  /* Selling X is an ask: an exit when the base is X, a buy when the base is Y. */
  const side = first.data.isAskSide === baseIsX ? "exit" : "buy";
  const total = orders.reduce((sum, order) => sum + order.data.bins.reduce((s, bin) => s + bin.amount, 0n), 0n);
  return {
    pool: first.pool,
    owner: first.owner,
    side,
    orders: orders.length,
    steps: orders.reduce((n, order) => n + order.data.bins.length, 0),
    maxInputRaw: total.toString(),
    programs: [...new Set(programs)].sort(),
    withdraw: "wallet",
    close: "cancel",
    source: "transaction",
  };
}

/* ------------------------------------------------------------ the account */

/** `LimitOrder`'s discriminator (lb_clmm 0.12.0). */
export const LIMIT_ORDER_DISCRIMINATOR = "89b7d45b731d8de3";
/** 8 discriminator · lb_pair 32 · owner 32 · bin_count u16 · 14 padding · 32 reserved; then 32 bytes per bin. */
const ORDER_HEAD_BYTES = 8 + 112;
const ORDER_BIN_BYTES = 32;

export type OrderAccountBin = Readonly<{
  id: number;
  /** What the bin still holds of the input. */
  amount: bigint;
  /** Non-zero once the pool has converted into the bin: the bin then has something to take back even at amount 0. */
  age: number;
  isAsk: boolean;
}>;

/** A bin with nothing left in it, as the SDK reads it (`isEmpty`): never converted and no amount. */
export const binIsEmpty = (bin: OrderAccountBin): boolean => bin.age === 0 && bin.amount === 0n;

export type OrderAccount = Readonly<{ pool: string; owner: string; bins: readonly OrderAccountBin[] }>;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A 32-byte key as its base58 address, without web3.js. */
export function addressOf(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * A limit order account as the program keeps it: its pool, its owner and each bin's amount and side — `LimitOrder`
 * followed by `bin_count` × `LimitOrderBinData` { amount u64 · age u32 · 4 padding · bin_id i32 · is_ask u8 · 11 padding }.
 * Null when the bytes are not one.
 */
export function decodeLimitOrderAccount(data: Uint8Array): OrderAccount | null {
  if (data.length < ORDER_HEAD_BYTES || hex(data.subarray(0, 8)) !== LIMIT_ORDER_DISCRIMINATOR) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(72, true);
  if (data.length < ORDER_HEAD_BYTES + count * ORDER_BIN_BYTES) return null;
  const bins: OrderAccountBin[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = ORDER_HEAD_BYTES + i * ORDER_BIN_BYTES;
    const flag = data[at + 20];
    if (flag !== 0 && flag !== 1) return null;
    bins.push({ amount: view.getBigUint64(at, true), age: view.getUint32(at + 8, true), id: view.getInt32(at + 16, true), isAsk: flag === 1 });
  }
  return { pool: addressOf(data.subarray(8, 40)), owner: addressOf(data.subarray(40, 72)), bins };
}
