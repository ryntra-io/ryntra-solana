/**
 * What a limit's cancellation brings back, for the core's Review before the wallet (SOL-C14). Only the figures: the
 * route builds the same cancellation it always did (`/api/solana/limits/cancel`), after «Підписати в гаманці».
 *
 * On Jupiter the fills are paid out as they happen, so a cancellation returns what has not filled. On Meteora DLMM the
 * order holds what converted until it closes, so closing returns both — what has not converted and what has — in one
 * signature, with the share of the bin's fees the order earned (said in words: the order's view carries no figure of it).
 * Either way the order account's rent comes back too; its figure is the chain's, read at the build.
 */

import type { LimitOrderView } from "./limit-api.ts";

export type CancelReturn = Readonly<{ mint: string; raw: string }>;

export function cancelReturns(order: Pick<LimitOrderView, "venue" | "inputMint" | "outputMint" | "makingRaw" | "filledInputRaw" | "filledOutputRaw">): readonly CancelReturn[] {
  const unfilled = BigInt(order.makingRaw || "0") - BigInt(order.filledInputRaw || "0");
  const back: CancelReturn[] = [];
  if (unfilled > 0n) back.push({ mint: order.inputMint, raw: unfilled.toString() });
  if (order.venue === "dlmm" && BigInt(order.filledOutputRaw || "0") > 0n) back.push({ mint: order.outputMint, raw: order.filledOutputRaw });
  return back;
}
