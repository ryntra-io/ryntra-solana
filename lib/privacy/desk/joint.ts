/**
 * The desk's swap as one transaction: two private transfers of the ring — the person pays the desk's one-time
 * address, the desk's address pays the person — each with its own proof, both instructions in one version 1
 * transaction, signed by both owners. Helius's answer of 19.11 («two private transfer instructions into the same
 * transaction — each side computes their own proof, both sign»), measured offline in `scripts/privacy/swap-offline.mjs`
 * W2: 1 684 bytes of 4 096, 7 addresses of 64, two signers.
 *
 * Why two legs and not one joint proof (PROBE.md, L2): in a joint proof one side hands its nullifier secret to the
 * other. Here neither does — the person's secret goes only to Helius's enclave inside their own leg's proof, as in any
 * private send; the desk never sees it, and the person never sees the desk's.
 *
 * What the chain shows (`way.ts`, `../exposure.ts`): both signers — the person's wallet (it also pays the network fee)
 * and the desk's one-time address. No coin, no amount: neither leg names a mint or a sum in the open (checked offline by
 * `scripts/privacy/desk-probe.mjs`, D0; on devnet — D4).
 *
 * The person's leg is built by the person (`buildLeg`), the desk's by the desk; the desk joins them (`joinLegs`) and
 * signs first; the person checks the joint transaction against their own leg (`checkJoint`) before the wallet signs.
 * Atomic: both legs land or neither does.
 */

import { RING_SOL } from '../network.ts';
import type { Book, Ctx } from '../flows.ts';

/** A version 1 transaction's ceilings (SIMD-0385, as the ring's SDK enforces them). */
export const V1_MAX_BYTES = 4_096;
export const V1_MAX_ADDRESSES = 64;
export const COMPUTE_MAX = 1_400_000;
/** The compute the SDK sets for one private transfer (offline, 20.11: each leg's own header says 450 000). */
export const LEG_COMPUTE = 450_000;

/**
 * The bytes at the head of a private transfer's instruction data that every transfer shares: the instruction's tag and
 * the public amount it moves across the ring's edge — none for a transfer. The desk's leg must open the way the
 * person's own leg does, so it can only be a transfer like it: never a deposit that would draw on the person's wallet.
 * Measured offline with the SDK (20.11, `scripts/privacy/desk-probe.mjs` D0.3): `10 ff ff ff ff ff ff ff ff 04` for a SOL
 * leg and a token leg alike; a deposit opens `0f …`. A withdrawal shares the transfer's head — it spends only the desk's
 * own notes, and one paying the person's wallet in the open names that wallet past the fee payer's place, which
 * `checkJoint` refuses.
 */
export const TRANSFER_HEAD = 10;

const WSOL = 'So11111111111111111111111111111111111111112';

/* ── messages, read the same way whatever the decoder gave ───────────────────────────────────────────────────────── */

export type Ix = Readonly<{ program: string; accounts: readonly string[]; data: Uint8Array }>;

export type Message = Readonly<{
  version: number | 'legacy';
  /** The addresses that sign, the fee payer first. */
  signers: readonly string[];
  payer: string;
  accounts: readonly string[];
  instructions: readonly Ix[];
  /** The compute limit the message sets; null when it names none. */
  computeUnits: number | null;
}>;

type Header = Readonly<{ numSignerAccounts: number }>;
type ConfigValue = Readonly<{ kind?: string; value?: unknown }>;
/** A compiled message as `@solana/kit` 8 decodes it: version 1 with instruction headers and payloads, or older. */
export type Compiled = Readonly<{
  version: number | 'legacy';
  header: Header;
  staticAccounts: readonly string[];
  instructionHeaders?: readonly Readonly<{ programAccountIndex: number }>[];
  instructionPayloads?: readonly Readonly<{ instructionAccountIndices: ArrayLike<number>; instructionData: Uint8Array | ArrayLike<number> }>[];
  configValues?: readonly ConfigValue[];
  instructions?: readonly Readonly<{ programAddressIndex: number; accountIndices?: ArrayLike<number>; data?: Uint8Array | ArrayLike<number> }>[];
}>;

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

/** The compute limit a compute-budget instruction sets (`SetComputeUnitLimit`, tag 2), or null. */
function limitOf(data: Uint8Array): number | null {
  if (data.length !== 5 || data[0] !== 2) return null;
  return (data[1] | (data[2] << 8) | (data[3] << 16)) + data[4] * 0x1000000;
}

/** One reading of a compiled message: who signs, who pays, each instruction with its program and addresses. */
export function messageOf(m: Compiled): Message {
  const at = (i: number): string => m.staticAccounts[i] ?? '';
  const instructions: Ix[] = [];
  let computeUnits: number | null = null;
  if (m.instructionHeaders && m.instructionPayloads) {
    m.instructionHeaders.forEach((head, i) => {
      const payload = m.instructionPayloads?.[i];
      instructions.push({ program: at(head.programAccountIndex), accounts: Array.from(payload?.instructionAccountIndices ?? [], at), data: new Uint8Array(payload?.instructionData ?? []) });
    });
    // Version 1 keeps the compute limit in the header's config: the first 4-byte value the SDK sets.
    const limit = m.configValues?.find((c) => c.kind === 'u32')?.value;
    computeUnits = typeof limit === 'number' ? limit : typeof limit === 'bigint' ? Number(limit) : null;
  } else {
    for (const ix of m.instructions ?? []) {
      const program = at(ix.programAddressIndex);
      const data = new Uint8Array(ix.data ?? []);
      if (program === COMPUTE_BUDGET) {
        computeUnits = limitOf(data) ?? computeUnits;
        continue;
      }
      instructions.push({ program, accounts: Array.from(ix.accountIndices ?? [], at), data });
    }
  }
  return {
    version: m.version,
    signers: m.staticAccounts.slice(0, m.header.numSignerAccounts),
    payer: at(0),
    accounts: m.staticAccounts,
    instructions,
    computeUnits,
  };
}

/* ── the checks, one on each side ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Why the person's wallet is not asked to sign the joint transaction:
 * - `VERSION` — not a version 1 transaction;
 * - `PAYER` — the person does not pay the fee (someone else paying would tie the desk's address to them);
 * - `SIGNERS` — the signers are not exactly the person and the quote's desk address;
 * - `TOO_BIG` — over 4 096 bytes or 64 addresses;
 * - `COMPUTE` — asks more compute than a transaction may;
 * - `MINE_CHANGED` — the person's own leg is not in it byte for byte;
 * - `NO_DESK_LEG` — nothing beside the person's leg, or nothing the desk's address signs;
 * - `FOREIGN` — something beside the two legs: another program, an instruction that is not a private transfer, or one
 *   that names the person's wallet anywhere but where a transfer names its fee payer.
 */
export type JointCode = 'VERSION' | 'PAYER' | 'SIGNERS' | 'TOO_BIG' | 'COMPUTE' | 'MINE_CHANGED' | 'NO_DESK_LEG' | 'FOREIGN';

/** Why the desk does not join the person's leg. */
export type LegCode = 'VERSION' | 'PAYER' | 'SIGNERS' | 'EMPTY' | 'FOREIGN';

const sameIx = (a: Ix, b: Ix) =>
  a.program === b.program && a.accounts.length === b.accounts.length && a.accounts.every((x, i) => x === b.accounts[i]) && a.data.length === b.data.length && a.data.every((x, i) => x === b.data[i]);

const sameHead = (a: Uint8Array, b: Uint8Array) => a.length >= TRANSFER_HEAD && b.length >= TRANSFER_HEAD && a.subarray(0, TRANSFER_HEAD).every((x, i) => x === b[i]);

/** Where the person's leg stands inside the joint transaction, or -1. */
function findRun(joint: readonly Ix[], mine: readonly Ix[]): number {
  for (let start = 0; start + mine.length <= joint.length; start++) if (mine.every((ix, k) => sameIx(ix, joint[start + k]))) return start;
  return -1;
}

/** The desk's side, before joining: the person's leg is one or more private transfers of one program, signed and paid by the person alone. */
export function checkLeg(leg: Message, owner: string, desk: string): LegCode | null {
  if (leg.version !== 1) return 'VERSION';
  if (leg.payer !== owner) return 'PAYER';
  if (leg.signers.length !== 1 || leg.signers[0] !== owner) return 'SIGNERS';
  if (leg.instructions.length === 0) return 'EMPTY';
  const program = leg.instructions[0].program;
  if (leg.instructions.some((ix) => ix.program !== program || !sameHead(ix.data, leg.instructions[0].data) || ix.accounts.includes(desk))) return 'FOREIGN';
  return null;
}

/** The person's side, before the wallet signs: the joint transaction is their own leg, untouched, and one transfer of the desk's — nothing else. */
export function checkJoint(input: Readonly<{ joint: Message; mine: Message; owner: string; desk: string; bytes: number }>): JointCode | null {
  const { joint, mine, owner, desk } = input;
  if (joint.version !== 1) return 'VERSION';
  if (joint.payer !== owner) return 'PAYER';
  if (joint.signers.length !== 2 || !joint.signers.includes(owner) || !joint.signers.includes(desk)) return 'SIGNERS';
  if (input.bytes > V1_MAX_BYTES || joint.accounts.length > V1_MAX_ADDRESSES) return 'TOO_BIG';
  if (joint.computeUnits !== null && joint.computeUnits > COMPUTE_MAX) return 'COMPUTE';
  if (mine.instructions.length === 0) return 'MINE_CHANGED';
  const start = findRun(joint.instructions, mine.instructions);
  if (start < 0) return 'MINE_CHANGED';
  const rest = joint.instructions.filter((_, i) => i < start || i >= start + mine.instructions.length);
  if (rest.length === 0) return 'NO_DESK_LEG';
  const head = mine.instructions[0];
  for (const ix of rest) {
    if (ix.program !== head.program || !sameHead(ix.data, head.data)) return 'FOREIGN';
    // A transfer names its fee payer first; the person's wallet may stand there and nowhere else in the desk's leg.
    if (ix.accounts.some((a, i) => a === owner && i !== 0)) return 'FOREIGN';
  }
  if (!rest.some((ix) => ix.accounts.includes(desk))) return 'NO_DESK_LEG';
  return null;
}

/* ── building, with the ring's SDK ────────────────────────────────────────────────────────────────────────────────── */

/** SOL by any of its names: the ring's (system program), the SDK's, wrapped SOL in a market route. */
export function isSol(ctx: Ctx, mint: string): boolean {
  return mint === RING_SOL || mint === WSOL || mint === String(ctx.sdk.SOL_MINT ?? RING_SOL);
}

/**
 * One leg: a private transfer from `book` to `to` (a registered address), paid by `feePayer`. Both legs name the person
 * as fee payer, so the joint transaction has one payer and the desk's address needs no SOL of its own.
 */
export async function buildLeg(ctx: Ctx, leg: Readonly<{ book: Book; to: string; mint: string; amount: bigint; feePayer: string }>): Promise<unknown> {
  return ctx.sdk.buildTransferTransaction({
    client: ctx.client,
    wallet: leg.book.wallet,
    keys: leg.book.keys,
    feePayer: leg.feePayer,
    recipient: leg.to,
    ...(isSol(ctx, leg.mint) ? {} : { asset: leg.mint }),
    amount: leg.amount,
  });
}

/** A built transaction as `@solana/kit` holds it. */
export type Built = Readonly<{ messageBytes: Uint8Array; signatures: Readonly<Record<string, Uint8Array | null>> }>;

/** The message of a built transaction, read once. */
export function readMessage(sdk: Ctx['sdk'], tx: Built): Message {
  return messageOf(sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as Compiled);
}

/** The compute the joint transaction asks: what each leg set, added, under the ceiling. */
export function jointCompute(legs: readonly Message[]): number {
  return Math.min(COMPUTE_MAX, legs.reduce((sum, leg) => sum + (leg.computeUnits ?? LEG_COMPUTE), 0));
}

/**
 * The desk's side: the person's leg first, the desk's after it, one version 1 transaction with a fresh lifetime, paid
 * by the person. Needs the SDK's own v1 compiler (`compileUnsignedTransaction`) and kit's message decoder.
 */
export function joinLegs(sdk: Ctx['sdk'], input: Readonly<{ mine: Built; theirs: Built; feePayer: string; lifetime: Readonly<{ blockhash: string; lastValidBlockHeight: bigint }> }>): Built {
  const decode = (tx: Built) => sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const instructions = (tx: Built) => sdk.decompileTransactionMessage(decode(tx)).instructions;
  const units = jointCompute([messageOf(decode(input.mine) as Compiled), messageOf(decode(input.theirs) as Compiled)]);
  return sdk.compileUnsignedTransaction({ feePayer: input.feePayer, lifetime: input.lifetime, instructions: [...instructions(input.mine), ...instructions(input.theirs)], computeUnitLimit: units });
}

/* ── bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
