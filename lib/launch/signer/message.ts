/**
 * CITY-162 — what a launch signer is asked to sign, read from the bytes themselves.
 *
 * A signer of Ryntra's (the pool payer, the executor) is handed a transaction's message and nothing else: whatever the
 * caller says the bytes do, the signer reads them again here — the fee payer, every signer, every instruction with its
 * accounts' signer and writable flags — and its bounds judge that reading. Two formats are read: legacy (the
 * executor's transactions, the creation of a launch) and v1 (SIMD-0385, the creation with the creator's lock in it,
 * `../atomic-lock.server.ts`). A v0 message is refused: its accounts sit partly in lookup tables the bytes do not
 * carry, so what it does cannot be read from the message alone — and Launch builds none.
 */

import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessagePriorityFeeLamports,
} from "@solana/kit-v8";

import type { ViewInstruction } from "../../solana/v1-tx.ts";

/** An instruction as Kit decompiles it: the program, each account with its role, the data. */
type DecodedInstruction = Readonly<{ programAddress: string; accounts?: readonly Readonly<{ address: string; role: number }>[]; data?: Uint8Array }>;

export type SignedMessageView = Readonly<{
  version: "legacy" | "v1";
  /** The account that pays the fee: the first static account. */
  feePayer: string;
  /** Every account whose signature the message requires, in order. */
  signers: readonly string[];
  instructions: readonly ViewInstruction[];
  /** v1 only: the priority fee and the unit limit the message's own config names (null when it names none, and on legacy). */
  priorityFeeLamports: bigint | null;
  computeUnitLimit: number | null;
}>;

/** The message's own reading; throws when the bytes are not one whole legacy or v1 message. */
export function signedMessageView(message: Uint8Array): SignedMessageView {
  const [compiled, end] = getCompiledTransactionMessageDecoder().read(message, 0);
  if (end !== message.length) throw new Error("bytes after the message");
  if (compiled.version !== "legacy" && compiled.version !== 1) throw new Error(`a v${String(compiled.version)} message is not one a launch signer reads`);
  const accounts = compiled.staticAccounts.map(String);
  const signerCount = compiled.header.numSignerAccounts;
  if (!accounts.length || signerCount < 1) throw new Error("a message without a fee payer");
  const decoded = decompileTransactionMessage(compiled);
  /* Roles are the message's own, by account: 1 and 3 write, 2 and 3 sign. */
  const instructions: ViewInstruction[] = (decoded.instructions as readonly DecodedInstruction[]).map((instruction) => ({
    programId: String(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: String(account.address),
      isSigner: (Number(account.role) & 2) === 2,
      isWritable: (Number(account.role) & 1) === 1,
    })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  }));
  const v1 = compiled.version === 1;
  const configured = decoded as Parameters<typeof getTransactionMessagePriorityFeeLamports>[0];
  const priority = v1 ? getTransactionMessagePriorityFeeLamports(configured) : undefined;
  const units = v1 ? getTransactionMessageComputeUnitLimit(configured) : undefined;
  return {
    version: v1 ? "v1" : "legacy",
    feePayer: accounts[0]!,
    signers: accounts.slice(0, signerCount),
    instructions,
    priorityFeeLamports: priority === undefined ? null : BigInt(priority),
    computeUnitLimit: units === undefined ? null : Number(units),
  };
}
