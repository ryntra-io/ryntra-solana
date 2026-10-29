/**
 * The tree Met Lock's root escrow checks, and the vesting terms one row of a
 * campaign carries.
 *
 * A distribution campaign does not pay anybody: it publishes a root, and each
 * recipient takes their own allocation out of the escrow the program makes for
 * them. The root escrow of Met Lock (`locker` 0.5.0 on
 * `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn`) is what makes that safe
 * without a key of Ryntra's and without the campaign's owner signing at the
 * moment of a payout:
 *
 * - `create_root_escrow` writes the root, the whole it may ever pay
 *   (`max_claim_amount`) and how many escrows it may ever make (`max_escrow`);
 * - `fund_root_escrow` moves tokens in, never more than `max_claim_amount`;
 * - `create_vesting_escrow_from_root` takes a row and its proof, hashes the row
 *   itself and refuses anything the root does not cover. The escrow it makes is
 *   the program's own address derived from the root escrow **and the recipient**
 *   (`["base", root_escrow, recipient]` → `["escrow", base]`) and it is created,
 *   not written to: **a second one for the same recipient cannot exist**, so a
 *   repeated claim is impossible on chain rather than hidden in an interface;
 * - `claim_v2` pays what has vested, and only to a signature of the recipient's
 *   own wallet — nobody claims for somebody else, and the escrow counts what it
 *   has paid, so a second claim pays only what vested since the first.
 *
 * Because the hash commits to the whole schedule, not to a sum, a row cannot be
 * replayed with a different cliff or a different amount; and because the root
 * is stored in the escrow, a swapped root leaves every proof of the published
 * list failing (`InvalidMerkleProof`).
 *
 * The leaf below is Met Lock's, byte for byte, read from the program's source:
 * the row's own hash over the recipient's 32 bytes and its eight numbers in
 * little-endian, then `sha256(0x00 ‖ that)`; a pair is `sha256(0x01 ‖ lower ‖
 * higher)`, sorted, so a proof needs no left-or-right. The program only ever
 * *verifies*, so the one thing a builder owes is agreeing with its own proofs:
 * the last entry of an odd level is hashed **with itself** and the leaves keep
 * the rows' own order, which is what the locker's own Rust builder does and
 * what the tests here pin. It is therefore not the tree of
 * `creator-split.ts` — whose root only travels in a memo, whose leaves are
 * sorted and whose odd entry is carried up — because a tree a program checks
 * has to be the program's.
 *
 * Pure and client-safe: no chain, no clock unless given, bigint arithmetic.
 * The transactions are built by `../../launch/distribution.server.ts`.
 */

import { getBase58Encoder } from "@solana/kit";

import { MET_LOCK_PROGRAM } from "./constitution.ts";

export { MET_LOCK_PROGRAM };

/** Who may act on an escrow after it exists. Met Lock reads the number as a mask: 1 the campaign's owner, 2 the recipient. */
export const MET_LOCK_ACTORS = ["nobody", "owner", "recipient", "either"] as const;
export type MetLockActor = (typeof MET_LOCK_ACTORS)[number];

export const MET_LOCK_ACTOR_MODE: Readonly<Record<MetLockActor, number>> = Object.freeze({ nobody: 0, owner: 1, recipient: 2, either: 3 });

export function metLockActorOf(mode: number): MetLockActor | null {
  return MET_LOCK_ACTORS.find((actor) => MET_LOCK_ACTOR_MODE[actor] === mode) ?? null;
}

/** The whole of a u64 — every amount and every moment the program stores is one. */
export const U64_MAX = 2n ** 64n - 1n;

/**
 * One row of a campaign, exactly as `create_vesting_escrow_from_root` takes it and as the row's hash commits to it.
 * Amounts are raw base units as decimal strings; the moments are unix seconds.
 */
export type VestingNode = Readonly<{
  recipient: string;
  vestingStartTime: number;
  cliffTime: number;
  /** Seconds between periods; `0` — nothing vests by periods and only the cliff's amount is ever unlocked. */
  frequency: number;
  cliffUnlockRaw: string;
  amountPerPeriodRaw: string;
  numberOfPeriod: number;
  updateRecipientMode: number;
  cancelMode: number;
}>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW = /^(0|[1-9][0-9]{0,29})$/;
const encoder = getBase58Encoder();

function keyBytes(address: string): Uint8Array | null {
  if (!BASE58.test(address)) return null;
  try {
    const bytes = new Uint8Array(encoder.encode(address));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

const amount = (raw: string): bigint | null => (typeof raw === "string" && RAW.test(raw) && BigInt(raw) <= U64_MAX ? BigInt(raw) : null);
const moment = (value: number): boolean => Number.isInteger(value) && value >= 0 && BigInt(value) <= U64_MAX;

export const VESTING_NODE_PROBLEMS = [
  "RECIPIENT_NOT_AN_ADDRESS",
  "NOT_AN_AMOUNT",
  "MOMENT_NOT_WHOLE",
  "CLIFF_BEFORE_START",
  "FREQUENCY_ZERO",
  "MODE_UNKNOWN",
  "NOTHING_TO_PAY",
  "TOTAL_ABOVE_U64",
] as const;
export type VestingNodeProblem = (typeof VESTING_NODE_PROBLEMS)[number];

/**
 * What the program would refuse in a row, each once; empty when it holds. These are the program's own rules
 * (`CreateVestingEscrowParameters::validate`) plus the two Ryntra adds: a row that pays nothing is not a row, and a
 * total above a u64 cannot be a schedule.
 */
export function vestingNodeProblems(node: VestingNode): readonly VestingNodeProblem[] {
  const problems = new Set<VestingNodeProblem>();
  if (!keyBytes(node.recipient)) problems.add("RECIPIENT_NOT_AN_ADDRESS");
  const cliff = amount(node.cliffUnlockRaw);
  const perPeriod = amount(node.amountPerPeriodRaw);
  if (cliff === null || perPeriod === null) problems.add("NOT_AN_AMOUNT");
  if (!moment(node.vestingStartTime) || !moment(node.cliffTime) || !moment(node.frequency) || !moment(node.numberOfPeriod)) problems.add("MOMENT_NOT_WHOLE");
  else if (node.cliffTime < node.vestingStartTime) problems.add("CLIFF_BEFORE_START");
  if (perPeriod !== null && perPeriod > 0n && node.numberOfPeriod > 0 && node.frequency === 0) problems.add("FREQUENCY_ZERO");
  if (metLockActorOf(node.updateRecipientMode) === null || metLockActorOf(node.cancelMode) === null) problems.add("MODE_UNKNOWN");
  if (cliff !== null && perPeriod !== null && Number.isInteger(node.numberOfPeriod) && node.numberOfPeriod >= 0) {
    const total = cliff + perPeriod * BigInt(node.numberOfPeriod);
    if (total <= 0n) problems.add("NOTHING_TO_PAY");
    if (total > U64_MAX) problems.add("TOTAL_ABOVE_U64");
  }
  return [...problems];
}

/** Everything a row ever pays: the cliff's amount and every period of it, as the program deposits it. */
export function nodeTotalRaw(node: VestingNode): bigint {
  return BigInt(node.cliffUnlockRaw) + BigInt(node.amountPerPeriodRaw) * BigInt(node.numberOfPeriod);
}

/**
 * What has unlocked for a row by `at` (unix seconds) — the program's own arithmetic: nothing before the cliff, the
 * cliff's amount at it, then one period's amount for each whole period since, never past the row's periods.
 */
export function unlockedRaw(node: VestingNode, at: number): bigint {
  if (at < node.cliffTime) return 0n;
  const cliff = BigInt(node.cliffUnlockRaw);
  if (node.frequency === 0) return cliff;
  const whole = BigInt(Math.floor(at - node.cliffTime)) / BigInt(node.frequency);
  const periods = whole < BigInt(node.numberOfPeriod) ? whole : BigInt(node.numberOfPeriod);
  return cliff + periods * BigInt(node.amountPerPeriodRaw);
}

/** What a row can be claimed for now, given what its escrow has already paid. */
export function claimableRaw(node: VestingNode, claimedRaw: bigint, at: number): bigint {
  const unlocked = unlockedRaw(node, at);
  return unlocked > claimedRaw ? unlocked - claimedRaw : 0n;
}

/** When a row has nothing left to unlock. */
export function nodeEndsAt(node: VestingNode): number {
  return node.frequency === 0 ? node.cliffTime : node.cliffTime + node.frequency * node.numberOfPeriod;
}

/* ------------------------------------------------------------ the tree */

const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => Uint8Array.from(text.match(/../g)!.map((pair) => parseInt(pair, 16)));

/** A hash as the tree writes it: 32 bytes as 64 lowercase hex digits, whose text order is their byte order. */
export const HASH = /^[0-9a-f]{64}$/;

async function sha256(...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

/**
 * A row's leaf: `sha256(0x00 ‖ sha256(recipient ‖ vestingStartTime ‖ cliffTime ‖ frequency ‖ cliffUnlock ‖
 * amountPerPeriod ‖ numberOfPeriod ‖ updateRecipientMode ‖ cancelMode))`, the eight numbers little-endian — the row's
 * own hash as the program computes it, under the leaf prefix that keeps a leaf from standing in for a pair.
 */
export async function vestingLeaf(node: VestingNode): Promise<string> {
  const bytes = keyBytes(node.recipient);
  if (!bytes) throw new Error("A row needs a recipient's address.");
  const row = await sha256(
    bytes,
    u64le(BigInt(node.vestingStartTime)),
    u64le(BigInt(node.cliffTime)),
    u64le(BigInt(node.frequency)),
    u64le(BigInt(node.cliffUnlockRaw)),
    u64le(BigInt(node.amountPerPeriodRaw)),
    u64le(BigInt(node.numberOfPeriod)),
    Uint8Array.of(node.updateRecipientMode),
    Uint8Array.of(node.cancelMode),
  );
  return hex(await sha256(LEAF, row));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A pair as the program hashes it: the lower hash first, so a proof needs no left-or-right. */
async function pair(a: string, b: string): Promise<string> {
  const [low, high] = compare(a, b) <= 0 ? [a, b] : [b, a];
  return hex(await sha256(NODE, unhex(low), unhex(high)));
}

/**
 * The tree's levels, the leaves first in the rows' own order. An odd level's last entry is hashed **with itself** —
 * Met Lock's own builder duplicates it rather than carrying it up, and a tree that carried it up would publish a root
 * no proof of the program's could reach.
 */
async function levels(nodes: readonly VestingNode[]): Promise<string[][]> {
  const out = [await Promise.all(nodes.map(vestingLeaf))];
  while (out.at(-1)!.length > 1) {
    const level = out.at(-1)!;
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      next.push(await pair(left, index + 1 < level.length ? level[index + 1]! : left));
    }
    out.push(next);
  }
  return out;
}

/** The root of a list of rows, as `create_root_escrow` stores it. A campaign with no rows has no root. */
export async function vestingRoot(nodes: readonly VestingNode[]): Promise<string> {
  if (!nodes.length) throw new Error("A campaign with no rows has no root.");
  return (await levels(nodes)).at(-1)![0]!;
}

/**
 * One row's proof — the sibling at each level up to the root, an odd level's last entry its own sibling. Null when the
 * wallet is not in the list, which is the answer a claim panel shows rather than an empty proof.
 */
export async function vestingProof(nodes: readonly VestingNode[], recipient: string): Promise<readonly string[] | null> {
  const index = nodes.findIndex((node) => node.recipient === recipient);
  if (index < 0) return null;
  const tree = await levels(nodes);
  const proof: string[] = [];
  let at = index;
  for (const level of tree.slice(0, -1)) {
    const sibling = at % 2 === 0 ? at + 1 : at - 1;
    proof.push(sibling < level.length ? level[sibling]! : level[at]!);
    at = Math.floor(at / 2);
  }
  return proof;
}

/** Whether a row and a proof reach a root — the check the program makes before it moves a token. */
export async function verifyVestingProof(node: VestingNode, proof: readonly string[], root: string): Promise<boolean> {
  if (!HASH.test(root) || !proof.every((sibling) => HASH.test(sibling))) return false;
  let computed = await vestingLeaf(node);
  for (const sibling of proof) computed = await pair(computed, sibling);
  return computed === root;
}

/* ------------------------------------------------------------ the root escrow */

export const ROOT_PLAN_PROBLEMS = ["NO_ROWS", "RECIPIENT_REPEATED", "ROW_REFUSED", "TOTAL_ABOVE_U64"] as const;
export type RootPlanProblem = (typeof ROOT_PLAN_PROBLEMS)[number];

/**
 * What `create_root_escrow` is given for a list of rows: the root, the whole it may ever pay and how many escrows it
 * may ever make. The two bounds are the program's own ceiling on the campaign — it can never pay more than the list,
 * whatever is funded into it afterwards. `problems` empty means the list may be published; otherwise `root` is null
 * and nothing is built.
 */
export type RootPlan = Readonly<{
  root: string | null;
  maxClaimAmountRaw: string;
  maxEscrow: number;
  problems: readonly RootPlanProblem[];
  /** Every row the program would refuse, by its place in the list. */
  refused: readonly Readonly<{ index: number; recipient: string; problems: readonly VestingNodeProblem[] }>[];
}>;

export async function rootPlan(nodes: readonly VestingNode[]): Promise<RootPlan> {
  const problems = new Set<RootPlanProblem>();
  const refused: Array<{ index: number; recipient: string; problems: readonly VestingNodeProblem[] }> = [];
  if (!nodes.length) problems.add("NO_ROWS");
  const seen = new Set<string>();
  let total = 0n;
  nodes.forEach((node, index) => {
    const own = vestingNodeProblems(node);
    if (own.length) {
      problems.add("ROW_REFUSED");
      refused.push({ index, recipient: node.recipient, problems: own });
      return;
    }
    /* Met Lock's own builder refuses two rows for one wallet, and so must the list: the second escrow could not exist. */
    if (seen.has(node.recipient)) problems.add("RECIPIENT_REPEATED");
    seen.add(node.recipient);
    total += nodeTotalRaw(node);
  });
  if (total > U64_MAX) problems.add("TOTAL_ABOVE_U64");
  const held = [...problems];
  return Object.freeze({
    root: held.length ? null : await vestingRoot(nodes),
    maxClaimAmountRaw: total.toString(),
    maxEscrow: nodes.length,
    problems: Object.freeze(held),
    refused: Object.freeze(refused),
  });
}
