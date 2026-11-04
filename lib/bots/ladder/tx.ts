/**
 * A ladder's transaction as bytes say it — for the window before the wallet
 * signs and for the relay after: its `place_limit_order` instructions (pool,
 * order account, owner, decoded bins), who pays, which keys must sign and
 * which programs it calls.
 *
 * Client-safe: `@solana/web3.js` only, no Node built-ins, no secrets.
 */

import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import { DLMM_PROGRAM } from "../../solana/limits/model.ts";
import { decodePlaceData, type PlacedOrder } from "./decode.ts";

/** Instructions a wallet or the SDK adds around an order, which move nothing of the person's elsewhere. */
export const HOUSEKEEPING_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EHFLe5ajQDjtWSDANmDH8vb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

export type ReadLadderTx = Readonly<{
  feePayer: string | null;
  /** The keys the message needs signatures from, in order. */
  signers: readonly string[];
  orders: readonly PlacedOrder[];
  /** Programs called beyond housekeeping. */
  programs: readonly string[];
}>;

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(value, "base64"));
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Read a legacy transaction's ladder orders; null when the bytes are not a legacy transaction. */
export function readLadderTransaction(wireBase64: string): ReadLadderTx | null {
  let transaction: Transaction;
  let exact: VersionedTransaction;
  try {
    const bytes = fromBase64(wireBase64);
    exact = VersionedTransaction.deserialize(bytes);
    if (exact.version !== "legacy") return null;
    transaction = Transaction.from(bytes);
  } catch {
    return null;
  }
  const header = exact.message.header;
  const signers = exact.message.staticAccountKeys.slice(0, header.numRequiredSignatures).map((key) => key.toBase58());
  const orders: PlacedOrder[] = [];
  const programs = new Set<string>();
  for (const instruction of transaction.instructions) {
    const program = instruction.programId.toBase58();
    if (!HOUSEKEEPING_PROGRAMS.has(program)) programs.add(program);
    if (program !== DLMM_PROGRAM) continue;
    const data = decodePlaceData(Uint8Array.from(instruction.data));
    if (!data) continue;
    /* lb_pair 0 · bitmap 1 · reserve 2 · token_mint 3 · limit_order 4 · payer 5 · owner 6 · user_token 7 · sender 8. */
    const key = (index: number) => instruction.keys[index]?.pubkey.toBase58() ?? "";
    orders.push({ pool: key(0), limitOrder: key(4), owner: key(6), data });
  }
  return { feePayer: transaction.feePayer?.toBase58() ?? null, signers, orders, programs: [...programs].sort() };
}

/** Whether a string is a Solana address in its own canonical form. */
export function isAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}
