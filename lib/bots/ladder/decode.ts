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
