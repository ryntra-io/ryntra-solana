/**
 * What the person gets against what was promised — read from the chain's own
 * simulation before the wallet is asked, and again over the signed bytes
 * before they are sent.
 *
 * A placement promises three things, and the simulated chain must show each:
 * - **the order stands as shown**: after the transaction an order account of
 *   this wallet sits in this pool with exactly these bins, these amounts, this
 *   side — so every step converts at its own bin's price and nowhere else;
 * - **the amount leaves, no more**: the wallet's input token falls by exactly
 *   the steps' sum;
 * - **SOL leaves only as the cost line said**: the network's fees, the order
 *   account's rent (back on cancel), the rent of bin arrays the transaction
 *   opens, and on a SOL input the SOL that becomes the order — never more.
 *
 * A cancellation promises that the order is gone — every bin taken back and
 * the account closed — and that SOL leaves only as the network's fees and the
 * wallet's own token accounts' rent.
 *
 * Pure: the simulation's accounts in, a verdict out. If what the chain shows
 * cannot be read, the verdict is no.
 */

import { decodeLimitOrderAccount, type PlacedBin } from "./decode.ts";
import type { LadderPool, LegPlan, Rung } from "./plan.ts";

export type Verdict = Readonly<{ ok: true; solOutLamports: number }> | Readonly<{ ok: false; code: PromiseCode; reason: string }>;

export type PromiseCode = "ORDER_MISSING" | "ORDER_MISMATCH" | "INPUT_MISMATCH" | "SOL_ABOVE_LINE" | "ORDER_STAYS" | "UNREADABLE";

/** An account as the simulation returns it: lamports and base64 data, or gone. */
export type SimAccount = Readonly<{ lamports: number; data: readonly [string, string] | readonly string[] }> | null;

const bytesOf = (account: SimAccount): Uint8Array | null => {
  if (!account) return null;
  const encoded = account.data[0];
  if (typeof encoded !== "string") return null;
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(encoded, "base64"));
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
};

/** A token account's amount from its bytes (SPL and Token-2022 share the first 72 bytes); null when not one. */
export function tokenAmountOf(account: SimAccount): bigint | null {
  const bytes = bytesOf(account);
  if (!bytes || bytes.length < 72) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(64, true);
}

export type PlacementPromise = Readonly<{
  owner: string;
  pool: string;
  limitOrder: string;
  isAskSide: boolean;
  bins: readonly PlacedBin[];
  /** The input is SOL, wrapped into the order inside the transaction: its token account is opened and closed there. */
  inputIsSol: boolean;
  /** The most SOL that may leave the wallet, lamports: fees, the order's rent, new arrays' rent, SOL that becomes the order. */
  maxSolOutLamports: number;
}>;

/**
 * The placement's verdict from the wallet's lamports and input token before, and the wallet, its input token account
 * and the order account after the simulated transaction.
 */
export function judgePlacement(
  promise: PlacementPromise,
  before: Readonly<{ lamports: number; input: bigint | null }>,
  after: Readonly<{ wallet: SimAccount; input: SimAccount; order: SimAccount }>,
): Verdict {
  const orderBytes = bytesOf(after.order);
  if (!orderBytes) return { ok: false, code: "ORDER_MISSING", reason: "The order would not stand after the transaction." };
  const order = decodeLimitOrderAccount(orderBytes);
  if (!order) return { ok: false, code: "UNREADABLE", reason: "The order account cannot be read." };
  if (order.owner !== promise.owner || order.pool !== promise.pool) return { ok: false, code: "ORDER_MISMATCH", reason: "The order would belong to another wallet or pool." };
  const want = new Map(promise.bins.map((bin) => [bin.id, bin.amount]));
  const exact =
    order.bins.length === promise.bins.length &&
    new Set(order.bins.map((bin) => bin.id)).size === order.bins.length &&
    order.bins.every((bin) => want.get(bin.id) === bin.amount && bin.isAsk === promise.isAskSide);
  if (!exact) return { ok: false, code: "ORDER_MISMATCH", reason: "The order's steps would not be the ones shown." };
  const total = promise.bins.reduce((sum, bin) => sum + bin.amount, 0n);
  if (!promise.inputIsSol) {
    const left = tokenAmountOf(after.input);
    if (before.input === null || left === null || before.input - left !== total) return { ok: false, code: "INPUT_MISMATCH", reason: "Another amount than the steps would leave the wallet." };
  }
  if (!after.wallet) return { ok: false, code: "UNREADABLE", reason: "The wallet cannot be read after the transaction." };
  const solOut = before.lamports - after.wallet.lamports;
  if (solOut > promise.maxSolOutLamports) return { ok: false, code: "SOL_ABOVE_LINE", reason: "More SOL would leave the wallet than the cost line says." };
  return { ok: true, solOutLamports: solOut };
}

/** A cancellation's verdict: the order is gone, and SOL left the wallet only as fees and its own token accounts' rent. */
export function judgeCancel(
  promise: Readonly<{ maxSolOutLamports: number }>,
  before: Readonly<{ lamports: number }>,
  after: Readonly<{ wallet: SimAccount; order: SimAccount }>,
): Verdict {
  if (after.order && (bytesOf(after.order)?.length ?? 0) > 0) return { ok: false, code: "ORDER_STAYS", reason: "The order would still hold something after the cancellation." };
  if (!after.wallet) return { ok: false, code: "UNREADABLE", reason: "The wallet cannot be read after the transaction." };
  const solOut = before.lamports - after.wallet.lamports;
  if (solOut > promise.maxSolOutLamports) return { ok: false, code: "SOL_ABOVE_LINE", reason: "More SOL would leave the wallet than the cancellation costs." };
  return { ok: true, solOutLamports: solOut };
}

/* --------------------------------------------------------------- the promise */

/**
 * What a leg gives the person if every step fills, in whole units of its output: a buy's base at each bin's price
 * (the amount over the price), an exit's quote (the amount times the price). The pool converts a step at its bin's own
 * price, and the order also earns its share of the swap fee, so this is the least it gives, give or take rounding.
 */
export function legReceives(plan: Pick<LegPlan, "side" | "rungs">, pool: Pick<LadderPool, "baseDecimals" | "quoteDecimals">): number {
  return plan.rungs.reduce((sum, rung: Rung) => {
    const amount = Number(rung.amountRaw);
    if (!(rung.price > 0) || !(amount > 0)) return sum;
    return plan.side === "buy" ? sum + amount / 10 ** pool.quoteDecimals / rung.price : sum + (amount / 10 ** pool.baseDecimals) * rung.price;
  }, 0);
}
