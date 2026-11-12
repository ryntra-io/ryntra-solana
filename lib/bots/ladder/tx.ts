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

/* ------------------------------------------------------------ housekeeping */

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EHFLe5ajQDjtWSDANmDH8vb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const NATIVE = "So11111111111111111111111111111111111111112";
/** The most a ladder's transaction may pay for priority, lamports: the limits lane's ceiling (0.005 SOL). */
export const LADDER_MAX_PRIORITY_LAMPORTS = 5_000_000;

/** The wallet's own wrapped-SOL account, without spl-token: the associated address of (wallet, Token, native mint). */
export function ownWrappedSol(owner: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(NATIVE).toBuffer()], new PublicKey(ATA))[0].toBase58();
}

/**
 * What the housekeeping around an order does, read before the wallet sees it (CITY-219: CITY-135 let these programs
 * through by name, so a System transfer to a stranger reached the wallet's prompt before the relay refused it). Only
 * what the SDK itself adds is let through: SOL wrapped into the wallet's own wrapped-SOL account, that account synced
 * and closed back to the wallet, the wallet's own token accounts opened by the wallet, a compute budget whose priority
 * stays under the ceiling, a memo. Anything else is a reason, in words; none — null.
 */
export function housekeepingIssue(wireBase64: string, owner: string): string | null {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(fromBase64(wireBase64));
  } catch {
    return "Unreadable.";
  }
  const wrapped = ownWrappedSol(owner);
  let units = 0;
  let price = 0n;
  let limitSet = false;
  for (const ix of transaction.instructions) {
    const program = ix.programId.toBase58();
    const keys = ix.keys.map((key) => key.pubkey.toBase58());
    const data = Uint8Array.from(ix.data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (program === SYSTEM) {
      /* Transfer (2): from the wallet into its own wrapped-SOL account, nothing else. */
      if (data.length !== 12 || view.getUint32(0, true) !== 2 || keys[0] !== owner || keys[1] !== wrapped) return "SOL would go somewhere other than your own account.";
    } else if (program === TOKEN || program === TOKEN_2022) {
      const syncs = data.length === 1 && data[0] === 17 && keys[0] === wrapped;
      const closesHome = data.length === 1 && data[0] === 9 && keys[0] === wrapped && keys[1] === owner;
      if (!syncs && !closesHome) return "An unexpected token instruction.";
    } else if (program === ATA) {
      if (keys[0] !== owner || keys[2] !== owner) return "A token account for someone else.";
    } else if (program === COMPUTE) {
      if (data[0] === 2 && data.length >= 5) {
        units = view.getUint32(1, true);
        limitSet = true;
      } else if (data[0] === 3 && data.length >= 9) price = view.getBigUint64(1, true);
      else return "An unexpected compute budget.";
    }
  }
  const limit = BigInt(limitSet ? units : 200_000 * transaction.instructions.length);
  if ((limit * price) / 1_000_000n > BigInt(LADDER_MAX_PRIORITY_LAMPORTS)) return "The priority fee is above the ceiling.";
  return null;
}
