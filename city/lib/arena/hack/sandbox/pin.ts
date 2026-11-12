/**
 * The pin of a Hack run (CITY-224, spec `docs/research/city-hack-2026-11-08/SPEC.md` «How the sandbox works»): the exact
 * copy a run starts from, written down as hashes, so the same pin and the same inputs give the same log on every
 * machine.
 *
 *   Snapshot — the recorded state itself: the clock, the programs' bytes and every account (owner, lamports, data,
 *              executable). Recorded once (a tape of mainnet answers, as CITY-198/219 do); never fetched during a run.
 *   ForkPin  — what goes into the rules, the log and the receipt: the target (a mainnet fork at a slot), the clock, a
 *              hash of each program's bytes, one hash of all the accounts (`stateHash`), and the engine that runs the
 *              copy (its id and version: built-in programs and the runtime come with it).
 *
 * A snapshot names where it was recorded in words only — never a URL: the sandbox has no network to fetch with, and a
 * snapshot that points at one is refused (`checkSnapshot`). Only a fork can be pinned: a devnet deploy is a live network
 * and is not a deterministic copy.
 *
 * Pure: no store, no clock, no network, no keys, no money.
 */

import { HEX32, hashOf, sha256Hex } from "../../../../../lib/ring/judge/index.ts";
import { isAddress, type TargetRef } from "../scope.ts";

export const SNAPSHOT_FORMAT = "ryntra-hack-snapshot/1";
export const PIN_FORMAT = "ryntra-hack-pin/1";

/** The most accounts and programs a snapshot may carry, and the most bytes an account's data may have (Solana's 10 MiB). */
export const SNAPSHOT_MAX = { accounts: 4_096, programs: 64, dataBytes: 10 * 1_048_576 } as const;

/** An account as the copy holds it. `lamports` is a decimal u64 string (JSON cannot hold every u64 as a number). */
export type SnapshotAccount = {
  readonly address: string;
  readonly owner: string;
  readonly lamports: string;
  /** The account's data, base64. */
  readonly data: string;
  readonly executable: boolean;
};

/** A program loaded into the copy from bytes (an ELF dump). Built-in programs come with the engine instead. */
export type SnapshotProgram = { readonly address: string; /** base64 */ readonly bytes: string };

export type Snapshot = {
  readonly format: typeof SNAPSHOT_FORMAT;
  /** Where the state was recorded, in words: never a URL. */
  readonly source: { readonly kind: "recorded"; readonly label: string; readonly recordedAt: string };
  readonly slot: number;
  /** Unix seconds of the copy's clock. */
  readonly unixTimestamp: number;
  readonly programs: readonly SnapshotProgram[];
  readonly accounts: readonly SnapshotAccount[];
};

/** The engine that runs a copy: its id and version pin the runtime and the built-in programs. */
export type EngineRef = { readonly id: string; readonly version: string };

export type ForkPin = {
  readonly format: typeof PIN_FORMAT;
  /** The order's target: always a mainnet fork at a slot. */
  readonly target: { readonly kind: "fork"; readonly program: string; readonly slot: number };
  readonly clock: { readonly slot: number; readonly unixTimestamp: number };
  /** SHA-256 of each loaded program's bytes, by address (sorted). */
  readonly programs: readonly { readonly address: string; readonly hash: string }[];
  /** SHA-256 of every account of the copy in one canonical form (`accountsHash`). */
  readonly stateHash: string;
  readonly engine: EngineRef;
};

/** One account in the canonical form a state hash is taken over. */
export type AccountState = { readonly address: string; readonly owner: string; readonly lamports: bigint; readonly data: Uint8Array; readonly executable: boolean };

export type PinIssueCode = "BAD_SNAPSHOT" | "BAD_PIN" | "NOT_A_FORK" | "PIN_MISMATCH";
export type PinIssue = { readonly code: PinIssueCode; readonly detail: string };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const U64 = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 18_446_744_073_709_551_615n;
const ENGINE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const isWhole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isHex32 = (value: unknown): value is string => typeof value === "string" && HEX32.test(value);

/** True for a decimal u64 string. */
export const isU64 = (value: unknown): value is string => typeof value === "string" && U64.test(value) && BigInt(value) <= U64_MAX;

/** The bytes of canonical base64 — `null` for anything else (whitespace, URL-safe alphabet, missing padding). */
export function fromBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !BASE64.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? new Uint8Array(bytes) : null;
}

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/**
 * SHA-256 over accounts in one canonical form: sorted by address; owner, lamports (decimal), executable, and the hash of
 * the data. An account with no lamports does not exist — it is left out, as the chain drops it.
 */
export function accountsHash(accounts: Iterable<AccountState>): string {
  const rows = [...accounts]
    .filter((a) => a.lamports > 0n)
    .map((a) => ({ address: a.address, owner: a.owner, lamports: a.lamports.toString(), executable: a.executable, data: sha256Hex(a.data) }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return hashOf({ format: "ryntra-hack-state/1", accounts: rows });
}

/** A snapshot's accounts in the canonical form. Assumes `checkSnapshot` passed. */
export function snapshotAccounts(snapshot: Snapshot): AccountState[] {
  return snapshot.accounts.map((a) => ({ address: a.address, owner: a.owner, lamports: BigInt(a.lamports), data: fromBase64(a.data)!, executable: a.executable }));
}

/** What is wrong with a snapshot; `null` when a copy may be loaded from it. */
export function checkSnapshot(snapshot: unknown): PinIssue | null {
  const bad = (detail: string): PinIssue => ({ code: "BAD_SNAPSHOT", detail });
  if (snapshot === null || typeof snapshot !== "object") return bad("snapshot is not an object");
  const s = snapshot as Record<string, unknown>;
  if (s.format !== SNAPSHOT_FORMAT) return bad(`format must be ${SNAPSHOT_FORMAT}`);
  const source = s.source as Record<string, unknown> | null;
  if (source === null || typeof source !== "object" || source.kind !== "recorded" || typeof source.label !== "string" || typeof source.recordedAt !== "string") {
    return bad("source must be { kind: recorded, label, recordedAt }");
  }
  // A recorded state names its origin in words. A URL would be an invitation to fetch — the sandbox never does.
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(source.label) || /[a-z][a-z0-9+.-]*:\/\//i.test(source.recordedAt)) return bad("source names a URL: a snapshot is recorded, never fetched");
  if (!isWhole(s.slot) || !isWhole(s.unixTimestamp)) return bad("slot and unixTimestamp must be whole numbers");
  if (!Array.isArray(s.programs) || s.programs.length > SNAPSHOT_MAX.programs) return bad(`programs: a list of at most ${SNAPSHOT_MAX.programs}`);
  if (!Array.isArray(s.accounts) || s.accounts.length > SNAPSHOT_MAX.accounts) return bad(`accounts: a list of at most ${SNAPSHOT_MAX.accounts}`);
  const seen = new Set<string>();
  for (const p of s.programs as unknown[]) {
    const program = p as Record<string, unknown> | null;
    if (program === null || typeof program !== "object" || !isAddress(program.address)) return bad("a program needs an address");
    if (fromBase64(program.bytes) === null) return bad(`program ${program.address}: bytes must be canonical base64`);
    if (seen.has(program.address)) return bad(`${program.address} is listed twice`);
    seen.add(program.address);
  }
  for (const a of s.accounts as unknown[]) {
    const account = a as Record<string, unknown> | null;
    if (account === null || typeof account !== "object" || !isAddress(account.address) || !isAddress(account.owner)) return bad("an account needs an address and an owner");
    if (!isU64(account.lamports) || account.lamports === "0") return bad(`account ${account.address}: lamports must be a u64 above zero`);
    if (typeof account.executable !== "boolean") return bad(`account ${account.address}: executable must be a boolean`);
    const data = fromBase64(account.data);
    if (data === null) return bad(`account ${account.address}: data must be canonical base64`);
    if (data.length > SNAPSHOT_MAX.dataBytes) return bad(`account ${account.address}: data over ${SNAPSHOT_MAX.dataBytes} bytes`);
    if (seen.has(account.address)) return bad(`${account.address} is listed twice`);
    seen.add(account.address);
  }
  return null;
}

/** The programs' hashes, sorted by address. */
const programHashes = (snapshot: Snapshot) =>
  snapshot.programs
    .map((p) => ({ address: p.address, hash: sha256Hex(fromBase64(p.bytes)!) }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

/**
 * The pin of a snapshot for an order's target. Throws `TypeError` when the target is not a fork, the snapshot is
 * malformed, or the snapshot was recorded at another slot than the target pins.
 */
export function pinOf(snapshot: Snapshot, target: TargetRef, engine: EngineRef): ForkPin {
  if (target?.kind !== "fork") throw new TypeError("only a mainnet fork at a pinned slot can run in the sandbox");
  const issue = checkSnapshot(snapshot);
  if (issue) throw new TypeError(issue.detail);
  if (snapshot.slot !== target.slot) throw new TypeError(`the snapshot was recorded at slot ${snapshot.slot}, the target pins ${target.slot}`);
  if (!ENGINE_ID.test(engine?.id ?? "") || !ENGINE_ID.test(engine?.version ?? "")) throw new TypeError("engine needs { id, version }");
  return {
    format: PIN_FORMAT,
    target: { kind: "fork", program: target.program, slot: target.slot },
    clock: { slot: snapshot.slot, unixTimestamp: snapshot.unixTimestamp },
    programs: programHashes(snapshot),
    stateHash: accountsHash(snapshotAccounts(snapshot)),
    engine: { id: engine.id, version: engine.version },
  };
}

/** The pin's own hash: what a receipt or a window's «Details» can name. */
export const pinHash = (pin: ForkPin): string => hashOf(pin);

/** What is wrong with a pin; `null` when a run may start from it. With `target`, the pin must be that order's copy. */
export function checkPin(pin: unknown, target?: TargetRef): PinIssue | null {
  const bad = (detail: string): PinIssue => ({ code: "BAD_PIN", detail });
  if (pin === null || typeof pin !== "object") return bad("pin is not an object");
  const p = pin as Record<string, unknown>;
  if (p.format !== PIN_FORMAT) return bad(`format must be ${PIN_FORMAT}`);
  const t = p.target as Record<string, unknown> | null;
  if (t === null || typeof t !== "object") return bad("pin needs a target");
  if (t.kind !== "fork") return { code: "NOT_A_FORK", detail: "only a mainnet fork at a pinned slot runs in the sandbox — a devnet deploy is a live network" };
  if (!isAddress(t.program) || !isWhole(t.slot)) return bad("target needs a program address and a slot");
  const clock = p.clock as Record<string, unknown> | null;
  if (clock === null || typeof clock !== "object" || !isWhole(clock.slot) || !isWhole(clock.unixTimestamp)) return bad("clock needs { slot, unixTimestamp }");
  if (clock.slot !== t.slot) return bad("the clock's slot is not the target's slot");
  if (!Array.isArray(p.programs) || !p.programs.every((x) => x !== null && typeof x === "object" && isAddress(x.address) && isHex32(x.hash))) {
    return bad("programs: a list of { address, hash }");
  }
  const addresses = (p.programs as { address: string }[]).map((x) => x.address);
  if (addresses.some((a, i) => i > 0 && addresses[i - 1]! >= a)) return bad("programs must be sorted by address, each once");
  if (!isHex32(p.stateHash)) return bad("stateHash: 64 lowercase hex characters");
  const engine = p.engine as Record<string, unknown> | null;
  if (engine === null || typeof engine !== "object" || !ENGINE_ID.test(String(engine.id ?? "")) || !ENGINE_ID.test(String(engine.version ?? ""))) {
    return bad("engine needs { id, version }");
  }
  if (target !== undefined) {
    if (target.kind !== "fork") return { code: "NOT_A_FORK", detail: "the order's target is not a fork" };
    if (t.program !== target.program || t.slot !== target.slot) return { code: "PIN_MISMATCH", detail: "the pin is not the order's copy: another program or slot" };
  }
  return null;
}

/** True when a recorded snapshot is exactly the state a pin names: same clock, same programs, same accounts. */
export function snapshotMatches(snapshot: Snapshot, pin: ForkPin): boolean {
  if (checkSnapshot(snapshot) !== null) return false;
  if (snapshot.slot !== pin.clock.slot || snapshot.unixTimestamp !== pin.clock.unixTimestamp) return false;
  if (hashOf(programHashes(snapshot)) !== hashOf(pin.programs)) return false;
  return accountsHash(snapshotAccounts(snapshot)) === pin.stateHash;
}
