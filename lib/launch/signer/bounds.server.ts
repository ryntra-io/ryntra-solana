/**
 * CITY-162 — the bounds of Ryntra's launch signers: what each key signs, read from the message itself
 * (`./message.ts`), whoever asks. Anything else is refused with its reason, before the key — in the environment or in
 * KMS — is asked for a signature.
 *
 * The pool payer signs one shape only: the creation of a launch as `../flow.server.ts` builds it — the creator's
 * transfer that covers the payer, one DBC pool opened with the creator's first purchase if any, the creator's lock if
 * any (Met Lock), and the opening of the creator's own accounts. The payer pays the fee and the pool's rent; its address
 * may stand nowhere else — never the source of a transfer, never a trader, never an account's owner.
 *
 * The executor signs only its list (`../executor-signing.server.ts`, unchanged): the same check the chain runs before
 * its key touches the bytes, run again here on the message the key is asked to sign.
 */

import { createHash } from "node:crypto";

import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { LOCK_PROGRAM_ID } from "@meteora-ag/met-lock-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import type { ViewInstruction } from "../../solana/v1-tx.ts";
import { executorSigningRefusal, type Idl } from "../executor-signing.server.ts";
import type { SignedMessageView } from "./message.ts";
import type { SignerBounds } from "./signer.server.ts";

const SYSTEM = SystemProgram.programId.toBase58();
const COMPUTE = ComputeBudgetProgram.programId.toBase58();
const ATA = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const DBC = (DynamicBondingCurveIdl as unknown as Idl).address;
const DAMM = (CpAmmIdl as unknown as Idl).address;
const LOCK = LOCK_PROGRAM_ID.toBase58();

/** An Anchor instruction's discriminator: the first 8 bytes of sha256(`global:<name>`). */
export function anchorDiscriminator(name: string): readonly number[] {
  return [...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)];
}

/** The DBC instructions a launch's creation carries: one pool opened, the creator's first purchase on it. */
export const POOL_PAYER_DBC_INSTRUCTIONS: readonly string[] = Object.freeze([
  "initialize_virtual_pool_with_spl_token",
  "initialize_virtual_pool_with_token2022",
  "initialize_virtual_pool_with_token2022_transfer_hook",
  "swap",
  "swap2",
  "swap2_with_transfer_hook",
]);
/** Met Lock's one instruction in a creation: the creator's escrow (`../../core/venues/meteora-dbc/creator-lock.server.ts`). */
export const POOL_PAYER_LOCK_INSTRUCTION = "create_vesting_escrow_v2";
const LOCK_DISCRIMINATOR = anchorDiscriminator(POOL_PAYER_LOCK_INSTRUCTION);
const OPENS_POOL = /^initialize_virtual_pool_/;
/** The unit limit a creation may name: the network's own ceiling. */
const UNIT_LIMIT_MAX = 1_400_000;

const head = (data: Buffer) => [...data.subarray(0, 8)];
const sameBytes = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((byte, at) => byte === b[at]);

function instructionOf(idl: Idl, data: Buffer): Idl["instructions"][number] | null {
  const bytes = head(data);
  return idl.instructions.find((entry) => entry.discriminator.length === 8 && sameBytes(entry.discriminator, bytes)) ?? null;
}

/** Why a message is not a launch's creation the pool payer signs; null when it is. */
export function poolPayerRefusal(view: SignedMessageView, payer: string): string | null {
  if (view.feePayer !== payer) return `the fee payer is ${view.feePayer}, not the pool payer`;
  if ((view.priorityFeeLamports ?? 0n) > 0n) return "a priority fee the pool payer would pay";
  if (view.computeUnitLimit !== null && view.computeUnitLimit > UNIT_LIMIT_MAX) return "a unit limit above the network's";
  let pools = 0;
  for (const [index, ix] of view.instructions.entries()) {
    const at = `instruction ${index}`;
    const payerAt = ix.keys.flatMap((key, position) => (key.pubkey === payer ? [position] : []));
    switch (ix.programId) {
      case SYSTEM: {
        /* A transfer (u32 2, then u64) and nothing else — the creator's cover into the payer, the creator's wrapped SOL. */
        if (ix.data.length !== 12 || ix.data.readUInt32LE(0) !== 2) return `${at}: a System Program instruction other than a transfer`;
        if (ix.keys[0]?.pubkey === payer) return `${at}: a transfer out of the pool payer`;
        continue;
      }
      case COMPUTE: {
        /* The unit limit only: a priority price is paid by the fee payer, and the creation names none. */
        if (ix.data[0] === 2 && ix.data.length >= 5 && ix.data.readUInt32LE(1) <= UNIT_LIMIT_MAX) continue;
        return `${at}: a compute-budget instruction the creation does not carry`;
      }
      case ATA: {
        /* Opening the creator's own accounts: Create (no data or 0) and CreateIdempotent (1), funded and owned by others. */
        const kind = ix.data.length === 0 ? 0 : ix.data[0];
        if (kind !== 0 && kind !== 1) return `${at}: an associated-token instruction other than opening an account`;
        if (payerAt.length) return `${at}: opens an account the pool payer funds or owns`;
        continue;
      }
      case TOKEN:
      case TOKEN_2022: {
        /* Wrapped SOL around the first purchase: SyncNative (17) and CloseAccount (9), never on the payer's accounts. */
        const kind = ix.data[0];
        if (kind !== 17 && kind !== 9) return `${at}: a token instruction other than wrapping SOL`;
        if (payerAt.length) return `${at}: a token instruction that names the pool payer`;
        continue;
      }
      case DBC: {
        const shape = instructionOf(DynamicBondingCurveIdl as unknown as Idl, ix.data);
        if (!shape || !POOL_PAYER_DBC_INSTRUCTIONS.includes(shape.name)) return `${at}: ${shape?.name ?? "an unknown DBC instruction"} is not in a launch's creation`;
        const payerSlot = shape.accounts.findIndex((account) => account.name === "payer");
        if (OPENS_POOL.test(shape.name)) {
          pools += 1;
          if (payerSlot < 0 || ix.keys[payerSlot]?.pubkey !== payer) return `${at}: the pool is not paid by the pool payer`;
          if (payerAt.some((position) => position !== payerSlot)) return `${at}: the pool payer stands in another account of the pool's opening`;
          continue;
        }
        /* The first purchase: the creator's own; the payer never trades. */
        if (payerAt.length) return `${at}: a trade that names the pool payer`;
        continue;
      }
      case LOCK: {
        if (!sameBytes(head(ix.data), LOCK_DISCRIMINATOR)) return `${at}: a Met Lock instruction other than the creator's escrow`;
        if (payerAt.length) return `${at}: a lock that names the pool payer`;
        continue;
      }
      default:
        return `${at}: program ${ix.programId} is not in a launch's creation`;
    }
  }
  if (pools !== 1) return pools === 0 ? "the message opens no pool" : "the message opens more than one pool";
  return null;
}

const web3Instruction = (ix: ViewInstruction) =>
  new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((key) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })), data: Buffer.from(ix.data) });

/** Why a message is not the executor's to sign; null when it is. `payees`: the holders' collector's position owners. */
export function executorRefusal(view: SignedMessageView, executor: string, dlmm: Idl, payees: readonly string[] = []): string | null {
  if (view.version !== "legacy") return "the executor signs legacy transactions only";
  if (view.feePayer !== executor) return `the fee payer is ${view.feePayer}, not the executor`;
  return executorSigningRefusal(view.instructions.map(web3Instruction), executor, dlmm, payees);
}

/** The accounts a journal row names a message by: the token, else the pool, else the position. */
const SUBJECTS = ["base_mint", "pool", "virtual_pool", "lb_pair", "position"] as const;

/**
 * What a message does, in a few public words for the journal: each Meteora instruction it carries, by program and name
 * (`dbc.migration_damm_v2`, `dlmm.add_liquidity_by_strategy2`, `lock.create_vesting_escrow_v2`), and the account it
 * acts on — the token, the pool or the position. Read from the bytes, not from the caller.
 */
export function actionOf(view: SignedMessageView, dlmm: Idl | null = null): Readonly<{ action: string; subject: string | null }> {
  const programs = new Map<string, Readonly<{ label: string; idl: Idl }>>([
    [DBC, { label: "dbc", idl: DynamicBondingCurveIdl as unknown as Idl }],
    [DAMM, { label: "damm", idl: CpAmmIdl as unknown as Idl }],
    ...(dlmm ? ([[dlmm.address, { label: "dlmm", idl: dlmm }]] as const) : []),
  ]);
  const names: string[] = [];
  let subject: string | null = null;
  for (const ix of view.instructions) {
    if (ix.programId === LOCK) {
      names.push(sameBytes(head(ix.data), LOCK_DISCRIMINATOR) ? `lock.${POOL_PAYER_LOCK_INSTRUCTION}` : "lock.unknown");
      continue;
    }
    const known = programs.get(ix.programId);
    if (!known) continue;
    const shape = instructionOf(known.idl, ix.data);
    names.push(`${known.label}.${shape?.name ?? "unknown"}`);
    if (subject || !shape) continue;
    for (const name of SUBJECTS) {
      const position = shape.accounts.findIndex((account) => account.name === name);
      const key = position >= 0 ? ix.keys[position]?.pubkey : undefined;
      if (key && key !== ix.programId) {
        subject = key;
        break;
      }
    }
  }
  const unique = [...new Set(names)];
  return { action: unique.length ? unique.join("+") : "other", subject };
}

/** No DLMM IDL at hand: DLMM's program is then on no list, and its instructions are refused. */
const NO_DLMM: Idl = Object.freeze({ address: "11111111111111111111111111111112", instructions: [] });

/** The pool payer's bounds: a launch's creation, nothing else. */
export function poolPayerBounds(address: string): SignerBounds {
  return { refusal: (view) => poolPayerRefusal(view, address), describe: (view) => actionOf(view) };
}

/** The executor's bounds: its list, with DLMM's IDL from the caller that loads it (its module build does not load everywhere). */
export function executorBounds(address: string, dlmm: Idl | null): SignerBounds {
  return { refusal: (view, request) => executorRefusal(view, address, dlmm ?? NO_DLMM, request.payees ?? []), describe: (view) => actionOf(view, dlmm) };
}
