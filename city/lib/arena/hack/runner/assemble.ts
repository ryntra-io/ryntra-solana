/**
 * The agent's own payers in the copy, and the transactions the harness puts together for it (CITY-238, over the step
 * runner of CITY-225; spec `docs/research/city-hack-2026-11-08/SPEC.md` — the tool «зібрати tx у форк»).
 *
 * A model cannot sign: it can only say which instructions it wants. So the harness holds the agent's payers for one run
 * — fresh Ed25519 keys made here, in the server's memory, that exist nowhere but in the copy (the sandbox funds them
 * with the copy's own lamports, `ACTOR_LAMPORTS`) — compiles the instructions into one legacy transaction with the
 * first payer as the fee payer, and signs it with the payers the instructions name as signers. Nothing else can sign:
 * an instruction that asks for any other signature is refused here, before a run is spent on it. A finding is a
 * program's fault, never a signature the agent did not have (`../sandbox/README.md`, sigverify is on).
 *
 * These keys never leave the process, are never written anywhere and are dropped with the run. They are not a wallet:
 * the agent still never signs for, reads the keys of or moves the money of anyone on a live network.
 *
 * No network, no store, no clock.
 */

import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { TX_MAX_BYTES, fromBase64 } from "../sandbox/index.ts";
import type { AssembleResult } from "./session.ts";

/** The most instructions one assembled transaction carries, accounts one instruction names, and bytes of its data. */
export const ASSEMBLE_MAX = { instructions: 8, accounts: 32, dataBytes: 1_024 } as const;

/** The copy checks no blockhash (`engine.ts`): every assembled transaction carries the same one, so the same asks give the same bytes. */
const COPY_BLOCKHASH = "11111111111111111111111111111111";

export type InstructionSpec = {
  readonly program: string;
  readonly accounts: readonly { readonly address: string; readonly signer?: boolean; readonly writable?: boolean }[];
  /** The instruction's data, canonical base64. */
  readonly data: string;
};

export type CopyActors = {
  /** The payers' addresses, the fee payer first — the run's `actors`. */
  readonly addresses: readonly string[];
  /** One legacy transaction out of the instructions, signed with the payers they name; a refusal otherwise. */
  assemble(instructions: unknown): AssembleResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const refuse = (detail: string): AssembleResult => ({ ok: false, detail: detail.slice(0, 200) });

function keyOf(value: unknown): PublicKey | null {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Fresh payers for one run. `seeds` makes them the same every time — for a stand and for tests only; a server passes
 * none, so the keys are the process's own randomness.
 */
export function createCopyActors(count = 1, seeds?: readonly Uint8Array[]): CopyActors {
  const size = Math.min(4, Math.max(1, Math.trunc(count)));
  const keys = Array.from({ length: size }, (_unused, i) => (seeds?.[i] ? Keypair.fromSeed(seeds[i]!.subarray(0, 32)) : Keypair.generate()));
  const byAddress = new Map(keys.map((key) => [key.publicKey.toBase58(), key]));
  const payer = keys[0]!;

  function assemble(instructions: unknown): AssembleResult {
    if (!Array.isArray(instructions) || instructions.length === 0 || instructions.length > ASSEMBLE_MAX.instructions) {
      return refuse(`instructions: 1…${ASSEMBLE_MAX.instructions} of { program, accounts, data }`);
    }
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: COPY_BLOCKHASH });
    const signers = new Map<string, Keypair>([[payer.publicKey.toBase58(), payer]]);
    for (const raw of instructions) {
      if (!isRecord(raw)) return refuse("an instruction is { program, accounts, data }");
      const program = keyOf(raw.program);
      if (!program) return refuse("program: a base58 address");
      const accounts = raw.accounts === undefined ? [] : raw.accounts;
      if (!Array.isArray(accounts) || accounts.length > ASSEMBLE_MAX.accounts) return refuse(`accounts: at most ${ASSEMBLE_MAX.accounts} of { address, signer?, writable? }`);
      const data = raw.data === undefined || raw.data === "" ? new Uint8Array() : fromBase64(raw.data);
      if (data === null || data.length > ASSEMBLE_MAX.dataBytes) return refuse(`data: canonical base64, at most ${ASSEMBLE_MAX.dataBytes} bytes`);
      const keysOf: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      for (const account of accounts) {
        if (!isRecord(account)) return refuse("an account is { address, signer?, writable? }");
        const pubkey = keyOf(account.address);
        if (!pubkey) return refuse("an account's address is base58");
        const isSigner = account.signer === true;
        if (isSigner) {
          const own = byAddress.get(pubkey.toBase58());
          // The only keys there are: a signature the agent does not have is never made up.
          if (!own) return refuse("only your own payer can sign: no other key exists in the copy for you");
          signers.set(pubkey.toBase58(), own);
        }
        keysOf.push({ pubkey, isSigner, isWritable: account.writable === true });
      }
      tx.add(new TransactionInstruction({ programId: program, keys: keysOf, data: Buffer.from(data) }));
    }
    try {
      tx.sign(...signers.values());
      const bytes = tx.serialize();
      if (bytes.length > TX_MAX_BYTES) return refuse(`the transaction is ${bytes.length} bytes, ${TX_MAX_BYTES} at most`);
      return { ok: true, kind: "tx", bytes: bytes.length, input: { tx: bytes.toString("base64") } };
    } catch (error) {
      return refuse(error instanceof Error ? error.message : "the transaction does not compile");
    }
  }

  return { addresses: keys.map((key) => key.publicKey.toBase58()), assemble };
}
