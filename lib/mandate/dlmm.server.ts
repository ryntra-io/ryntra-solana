/**
 * CITY-174 — the devnet venue: one Meteora DLMM pool's `swap2`, for the vault, its output straight to the person.
 *
 * Jupiter is not deployed on devnet, so the mandate's devnet pass buys through a DLMM pool directly, as CITY-136 did
 * (report §7): the same policy rules, the program pinned to DLMM and the pool to one address. DLMM takes the person's
 * token account as `user_token_out`, so the output reaches her in the same instruction. Nothing here signs or sends.
 */

import type DLMMClass from "@meteora-ag/dlmm";
import { ComputeBudgetProgram, type Connection, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { DLMM_PROGRAM_ID, DLMM_SWAP2, LAYOUT } from "./terms.ts";

export type DlmmBuy = Readonly<{
  instruction: TransactionInstruction;
  /** The other instructions the SDK asked for, compute budget left out (the agent sets its own). */
  setup: readonly TransactionInstruction[];
  quoteOut: bigint;
  minOut: bigint;
}>;

/**
 * A buy of the pool's other token with `amount` of the vault's budget. `minOut` — the floor written into the
 * instruction; absent, the quote less `slippageBps`.
 */
export async function dlmmBuy(
  connection: Connection,
  input: Readonly<{ pool: PublicKey; budgetMint: PublicKey; vault: PublicKey; budgetAccount: PublicKey; receiver: PublicKey; amount: bigint; slippageBps: number; minOut?: bigint | undefined }>,
  /* The SDK, loaded on first use; a plain Node script hands in its CommonJS build (the ES build needs a bundler). */
  dependencies: Readonly<{ DLMM?: typeof DLMMClass }> = {},
): Promise<DlmmBuy> {
  const DLMM = dependencies.DLMM ?? (await import("@meteora-ag/dlmm")).default;
  const pool = await DLMM.create(connection, input.pool, { cluster: "devnet" });
  const sellsY = pool.tokenY.publicKey.equals(input.budgetMint);
  if (!sellsY && !pool.tokenX.publicKey.equals(input.budgetMint)) throw new Error("the pool does not trade the budget's token");
  /* Selling X buys Y (`swapForY`); the budget on the Y side buys X. */
  const swapForY = !sellsY;
  const binArrays = await pool.getBinArrayForSwap(swapForY);
  const quote = pool.swapQuote(new BN(input.amount.toString()), swapForY, new BN(input.slippageBps), binArrays);
  const minOut = input.minOut ?? BigInt(quote.minOutAmount.toString());
  const tx = await pool.swap({
    inToken: input.budgetMint,
    outToken: swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey,
    inAmount: new BN(input.amount.toString()),
    minOutAmount: new BN(minOut.toString()),
    lbPair: input.pool,
    user: input.vault,
    binArraysPubkey: quote.binArraysPubkey,
  });
  const instruction = tx.instructions.find((entry) => entry.programId.equals(DLMM_PROGRAM_ID));
  if (!instruction || !DLMM_SWAP2.every((byte, index) => instruction.data[index] === byte)) throw new Error("the SDK did not build a swap2");
  const keys = [...instruction.keys];
  keys[LAYOUT.dlmmSwap2.source] = { ...keys[LAYOUT.dlmmSwap2.source]!, pubkey: input.budgetAccount };
  keys[LAYOUT.dlmmSwap2.receiver] = { ...keys[LAYOUT.dlmmSwap2.receiver]!, pubkey: input.receiver };
  instruction.keys = keys;
  const setup = tx.instructions.filter((entry) => !entry.programId.equals(DLMM_PROGRAM_ID) && !entry.programId.equals(ComputeBudgetProgram.programId));
  return { instruction, setup, quoteOut: BigInt(quote.outAmount.toString()), minOut };
}

/**
 * CITY-175 — what `amount` of the pool's other token would bring back in the budget's token at the pool's price now:
 * the quote of selling exactly the coins the agent bought, no slippage taken off. Read only; nothing is built or sent.
 */
export async function dlmmWorth(
  connection: Connection,
  input: Readonly<{ pool: PublicKey; budgetMint: PublicKey; amount: bigint }>,
  dependencies: Readonly<{ DLMM?: typeof DLMMClass }> = {},
): Promise<bigint> {
  if (input.amount <= 0n) return 0n;
  const DLMM = dependencies.DLMM ?? (await import("@meteora-ag/dlmm")).default;
  const pool = await DLMM.create(connection, input.pool, { cluster: "devnet" });
  const budgetIsY = pool.tokenY.publicKey.equals(input.budgetMint);
  if (!budgetIsY && !pool.tokenX.publicKey.equals(input.budgetMint)) throw new Error("the pool does not trade the budget's token");
  /* Selling the other token for the budget: X for Y when the budget is Y. */
  const swapForY = budgetIsY;
  const binArrays = await pool.getBinArrayForSwap(swapForY);
  const quote = pool.swapQuote(new BN(input.amount.toString()), swapForY, new BN(0), binArrays, true);
  return BigInt(quote.outAmount.toString());
}
