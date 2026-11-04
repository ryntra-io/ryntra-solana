/**
 * CITY-174 — Squads Smart Account (SSA), the primitive of the agent's budget (decision 95, D3).
 *
 * The person's smart account holds the budget in its vault; a ProgramInteraction policy on it names the one key that may
 * spend from it (the agent's) and the bounds the program itself holds: which program and instruction, which accounts,
 * which bytes, how much a day and until when. This file is only the program's interface — addresses, the instructions
 * the mandate needs, encoded by hand from the program's IDL (`main` `0e51082`, as CITY-136 used it on devnet and on the
 * mainnet fork), and the few account fields the engine reads. It signs nothing and sends nothing.
 *
 * Instructions: `createSmartAccount`, `executeSettingsTransactionSync` (`PolicyCreate`, `PolicyRemove`) and
 * `executeTransactionSyncV2` (through a policy, or as the settings signer). Golden bytes from the IDL's own Borsh coder
 * keep the encoding honest (`ssa.test.mjs`).
 */

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

export const SSA_PROGRAM_ID = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Anchor's discriminators: the first 8 bytes of sha256("global:<name>") and sha256("account:<Name>"). */
const DISCRIMINATOR = Object.freeze({
  createSmartAccount: [197, 102, 253, 231, 77, 84, 50, 17],
  executeSettingsTransactionSync: [138, 209, 64, 163, 79, 67, 233, 76],
  executeTransactionSyncV2: [90, 81, 187, 81, 39, 70, 128, 78],
  accountPolicy: [222, 135, 7, 163, 235, 177, 33, 68],
  accountSettings: [223, 179, 163, 190, 177, 224, 67, 173],
  accountProgramConfig: [196, 210, 90, 231, 144, 149, 140, 63],
});

/** Initiate | Vote | Execute — every permission a signer can hold. */
export const ALL_PERMISSIONS = 7;

/* ------------------------------------------------------------------ addresses */

const seed = (text: string) => new TextEncoder().encode(text);
const PREFIX = seed("smart_account");

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
  return out;
}

export const ssaAddress = Object.freeze({
  programConfig: () => PublicKey.findProgramAddressSync([PREFIX, seed("program_config")], SSA_PROGRAM_ID)[0],
  /** The settings of the smart account created with this index (the program's counter + 1 at creation). */
  settings: (index: bigint) => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt.asUintN(64, index), true);
    view.setBigUint64(8, BigInt.asUintN(64, index >> 64n), true);
    return PublicKey.findProgramAddressSync([PREFIX, seed("settings"), bytes], SSA_PROGRAM_ID)[0];
  },
  /** The vault — the account that holds the budget and signs for it, inside the program. */
  vault: (settings: PublicKey, index = 0) => PublicKey.findProgramAddressSync([PREFIX, settings.toBytes(), PREFIX, Uint8Array.of(index)], SSA_PROGRAM_ID)[0],
  policy: (settings: PublicKey, policySeed: bigint) => PublicKey.findProgramAddressSync([PREFIX, seed("policy"), settings.toBytes(), u64le(policySeed)], SSA_PROGRAM_ID)[0],
});

/* ------------------------------------------------------------------ Borsh, as much of it as these instructions use */

class Borsh {
  private readonly parts: Uint8Array[] = [];
  raw(bytes: ArrayLike<number>) {
    this.parts.push(Uint8Array.from(bytes));
    return this;
  }
  u8(value: number) {
    return this.raw([value & 0xff]);
  }
  u16(value: number) {
    return this.raw([value & 0xff, (value >> 8) & 0xff]);
  }
  u32(value: number) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return this.raw(out);
  }
  u64(value: bigint) {
    return this.raw(u64le(value));
  }
  i64(value: bigint) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigInt64(0, value, true);
    return this.raw(out);
  }
  u128(value: bigint) {
    return this.u64(value).u64(value >> 64n);
  }
  bool(value: boolean) {
    return this.u8(value ? 1 : 0);
  }
  key(value: PublicKey) {
    return this.raw(value.toBytes());
  }
  bytes(value: Uint8Array) {
    return this.u32(value.length).raw(value);
  }
  option<T>(value: T | null | undefined, write: (value: T) => void) {
    if (value === null || value === undefined) return this.u8(0);
    this.u8(1);
    write(value);
    return this;
  }
  vec<T>(values: readonly T[], write: (value: T) => void) {
    this.u32(values.length);
    for (const value of values) write(value);
    return this;
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/* ------------------------------------------------------------------ policy types */

export type DataOperator = "equals" | "notEquals" | "greaterThan" | "greaterThanOrEqualTo" | "lessThan" | "lessThanOrEqualTo";
const OPERATORS: readonly DataOperator[] = ["equals", "notEquals", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo"];

export type DataValue =
  | Readonly<{ kind: "u8"; value: number }>
  | Readonly<{ kind: "u16"; value: number }>
  | Readonly<{ kind: "u32"; value: number }>
  | Readonly<{ kind: "u64"; value: bigint }>
  | Readonly<{ kind: "u128"; value: bigint }>
  | Readonly<{ kind: "bytes"; value: Uint8Array }>;

/** A rule on bytes: the value at `offset` compared by `operator` (numbers little-endian, a slice byte for byte). */
export type DataConstraint = Readonly<{ offset: number; value: DataValue; operator: DataOperator }>;

/** A rule on the instruction's account at `index`: one of these keys, or account data matching every rule; `owner` — the account's program owner. */
export type AccountConstraint = Readonly<{
  index: number;
  rule: Readonly<{ kind: "keys"; keys: readonly PublicKey[] }> | Readonly<{ kind: "data"; constraints: readonly DataConstraint[] }>;
  owner: PublicKey | null;
}>;

/** One allowed instruction: the program, and every account and data rule at once. */
export type InstructionConstraint = Readonly<{ programId: PublicKey; accounts: readonly AccountConstraint[]; data: readonly DataConstraint[] }>;

export type SpendingPeriod = "oneTime" | "daily" | "weekly" | "monthly" | Readonly<{ customSeconds: bigint }>;

/** The most of `mint` the vault may lose per period, from `start` (0 — at once) to `expiration`. */
export type SpendingLimit = Readonly<{ mint: PublicKey; start: bigint; expiration: bigint | null; period: SpendingPeriod; maxPerPeriod: bigint }>;

export type ProgramInteractionPolicy = Readonly<{
  accountIndex: number;
  constraints: readonly InstructionConstraint[];
  spendingLimits: readonly SpendingLimit[];
}>;

export type PolicySigner = Readonly<{ key: PublicKey; permissions: number }>;

export type PolicyCreate = Readonly<{
  /** The policy's seed: the settings' `policySeed` + 1 — the program derives the address from its own counter. */
  seed: bigint;
  policy: ProgramInteractionPolicy;
  signers: readonly PolicySigner[];
  threshold: number;
  /** Unix seconds; null — from the moment it lands. */
  start: bigint | null;
  /** Unix seconds; null — no end. */
  expiresAt: bigint | null;
}>;

function writeData(w: Borsh, constraint: DataConstraint) {
  w.u64(BigInt(constraint.offset));
  const value = constraint.value;
  switch (value.kind) {
    case "u8":
      w.u8(0).u8(value.value);
      break;
    case "u16":
      w.u8(1).u16(value.value);
      break;
    case "u32":
      w.u8(2).u32(value.value);
      break;
    case "u64":
      w.u8(3).u64(value.value);
      break;
    case "u128":
      w.u8(4).u128(value.value);
      break;
    case "bytes":
      w.u8(5).bytes(value.value);
      break;
  }
  w.u8(OPERATORS.indexOf(constraint.operator));
}

function writeAccount(w: Borsh, constraint: AccountConstraint) {
  w.u8(constraint.index);
  if (constraint.rule.kind === "keys") w.u8(0).vec(constraint.rule.keys, (key) => w.key(key));
  else w.u8(1).vec(constraint.rule.constraints, (data) => writeData(w, data));
  w.option(constraint.owner, (owner) => w.key(owner));
}

function writePeriod(w: Borsh, period: SpendingPeriod) {
  if (typeof period === "object") w.u8(4).i64(period.customSeconds);
  else w.u8(["oneTime", "daily", "weekly", "monthly"].indexOf(period));
}

function writeSigner(w: Borsh, signer: PolicySigner) {
  w.key(signer.key).u8(signer.permissions);
}

/* ------------------------------------------------------------------ instructions */

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({ pubkey, isSigner, isWritable });

/** A new smart account whose one settings signer is `creator` (threshold 1, no time lock, no settings authority). */
export function createSmartAccountInstruction(input: Readonly<{ creator: PublicKey; treasury: PublicKey; settings: PublicKey }>): TransactionInstruction {
  const w = new Borsh().raw(DISCRIMINATOR.createSmartAccount);
  w.option(null, () => undefined); // settingsAuthority: none — the signers decide
  w.u16(1);
  w.vec([{ key: input.creator, permissions: ALL_PERMISSIONS }], (signer) => writeSigner(w, signer));
  w.u32(0); // timeLock
  w.option(null, () => undefined); // rentCollector
  w.option(null, () => undefined); // memo
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data: w.done(),
    keys: [
      meta(ssaAddress.programConfig(), false, true),
      meta(input.treasury, false, true),
      meta(input.creator, true, true),
      meta(SystemProgram.programId, false, false),
      meta(SSA_PROGRAM_ID, false, false),
      meta(input.settings, false, true),
    ],
  });
}

export type SettingsAction = Readonly<{ kind: "policyCreate"; create: PolicyCreate }> | Readonly<{ kind: "policyRemove"; policy: PublicKey }>;

/**
 * A settings change the settings signers make at once (threshold reached in this transaction, time lock 0). The rent
 * payer pays a new policy's rent — and is the one a removed policy's rent goes back to.
 */
export function settingsSyncInstruction(input: Readonly<{ settings: PublicKey; rentPayer: PublicKey; signers: readonly PublicKey[]; actions: readonly SettingsAction[]; policyAccounts: readonly PublicKey[] }>): TransactionInstruction {
  const w = new Borsh().raw(DISCRIMINATOR.executeSettingsTransactionSync);
  w.u8(input.signers.length);
  w.vec(input.actions, (action) => {
    if (action.kind === "policyRemove") {
      w.u8(9).key(action.policy);
      return;
    }
    const create = action.create;
    w.u8(7).u64(create.seed);
    w.u8(3); // PolicyCreationPayload::ProgramInteraction
    w.u8(create.policy.accountIndex);
    w.vec(create.policy.constraints, (constraint) => {
      w.key(constraint.programId);
      w.vec(constraint.accounts, (account) => writeAccount(w, account));
      w.vec(constraint.data, (data) => writeData(w, data));
    });
    w.option(null, () => undefined); // preHook
    w.option(null, () => undefined); // postHook
    w.vec(create.policy.spendingLimits, (limit) => {
      w.key(limit.mint).i64(limit.start);
      w.option(limit.expiration, (expiration) => w.i64(expiration));
      writePeriod(w, limit.period);
      w.u64(limit.maxPerPeriod);
    });
    w.vec(create.signers, (signer) => writeSigner(w, signer));
    w.u16(create.threshold);
    w.u32(0); // timeLock
    w.option(create.start, (start) => w.i64(start));
    w.option(create.expiresAt, (expiresAt) => w.u8(0).i64(expiresAt)); // PolicyExpirationArgs::Timestamp
  });
  w.option(null, () => undefined); // memo
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data: w.done(),
    keys: [
      meta(input.settings, false, true),
      meta(input.rentPayer, true, true),
      meta(SystemProgram.programId, false, false),
      meta(SSA_PROGRAM_ID, false, false),
      ...input.signers.map((signer) => meta(signer, true, false)),
      ...input.policyAccounts.map((policy) => meta(policy, false, true)),
    ],
  });
}

/**
 * Inner instructions compiled the way the program reads them: `SmallVec<u8, CompiledInstruction>`, every account
 * index pointing into the accounts that follow the signers. The vault appears as a plain account: the program signs
 * for it.
 */
export function compileInner(instructions: readonly TransactionInstruction[]): Readonly<{ bytes: Buffer; accounts: readonly AccountMeta[] }> {
  const order: string[] = [];
  const metas = new Map<string, AccountMeta>();
  const add = (pubkey: PublicKey, writable: boolean) => {
    const key = pubkey.toBase58();
    const known = metas.get(key);
    if (!known) {
      metas.set(key, { pubkey, isSigner: false, isWritable: writable });
      order.push(key);
    } else if (writable) known.isWritable = true;
    return order.indexOf(key);
  };
  const compiled = instructions.map((instruction) => ({
    program: add(instruction.programId, false),
    accounts: instruction.keys.map((key) => add(key.pubkey, key.isWritable)),
    data: instruction.data,
  }));
  if (compiled.length > 255) throw new Error("too many inner instructions");
  const w = new Borsh().u8(compiled.length);
  for (const instruction of compiled) {
    if (instruction.accounts.length > 255) throw new Error("an inner instruction with too many accounts");
    w.u8(instruction.program).u8(instruction.accounts.length).raw(instruction.accounts).u16(instruction.data.length).raw(instruction.data);
  }
  if (order.length > 255) throw new Error("too many inner accounts");
  return { bytes: w.done(), accounts: order.map((key) => metas.get(key)!) };
}

/**
 * The agent's trade: inner instructions executed through `policy`, signed by its one signer. `constraintIndices` names,
 * for each inner instruction, which of the policy's constraints it claims to meet; the program checks exactly that one.
 */
export function policyExecuteInstruction(input: Readonly<{ policy: PublicKey; signer: PublicKey; instructions: readonly TransactionInstruction[]; constraintIndices: readonly number[] }>): TransactionInstruction {
  if (input.constraintIndices.length !== input.instructions.length) throw new Error("one constraint index per inner instruction");
  const { bytes, accounts } = compileInner(input.instructions);
  const w = new Borsh().raw(DISCRIMINATOR.executeTransactionSyncV2);
  w.u8(0).u8(1); // accountIndex 0 (the vault), one signer
  w.u8(1).u8(1); // SyncPayload::Policy → PolicyPayload::ProgramInteraction
  w.option(Uint8Array.from(input.constraintIndices), (indices) => w.bytes(indices));
  w.u8(1).u8(0).bytes(bytes); // ProgramInteractionTransactionPayload::SyncTransaction { accountIndex 0, instructions }
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data: w.done(),
    keys: [meta(input.policy, false, true), meta(SSA_PROGRAM_ID, false, false), meta(input.signer, true, false), ...accounts],
  });
}

/** The settings signer acting on the vault at once — the person moving her own budget, with no policy and no Ryntra. */
export function ownerExecuteInstruction(input: Readonly<{ settings: PublicKey; signer: PublicKey; instructions: readonly TransactionInstruction[] }>): TransactionInstruction {
  const { bytes, accounts } = compileInner(input.instructions);
  const w = new Borsh().raw(DISCRIMINATOR.executeTransactionSyncV2);
  w.u8(0).u8(1);
  w.u8(0).bytes(bytes); // SyncPayload::Transaction
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data: w.done(),
    keys: [meta(input.settings, false, true), meta(SSA_PROGRAM_ID, false, false), meta(input.signer, true, false), ...accounts],
  });
}

/** A policy execution read back from its own bytes and accounts: which policy, which signer, which inner instructions. */
export type PolicyExecuteView = Readonly<{
  policy: PublicKey;
  signers: readonly PublicKey[];
  constraintIndices: readonly number[] | null;
  instructions: readonly Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>[];
}>;

/** The inverse of `policyExecuteInstruction`; throws on any other shape — an owner execution, a settings change, a stray byte. */
export function readPolicyExecute(input: Readonly<{ programId: PublicKey; keys: readonly PublicKey[]; data: Uint8Array }>): PolicyExecuteView {
  if (!input.programId.equals(SSA_PROGRAM_ID)) throw new Error("not the smart account program");
  const data = input.data;
  if (!hasDiscriminator(data, DISCRIMINATOR.executeTransactionSyncV2)) throw new Error("not a synchronous execution");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  const take = (n: number) => {
    if (at + n > data.length) throw new Error("the execution's bytes end early");
    const out = data.subarray(at, at + n);
    at += n;
    return out;
  };
  const u8 = () => take(1)[0]!;
  const u32 = () => {
    take(4);
    return view.getUint32(at - 4, true);
  };
  if (u8() !== 0) throw new Error("not the vault's account index");
  const numSigners = u8();
  if (u8() !== 1 || u8() !== 1) throw new Error("not a program-interaction policy payload");
  const constraintIndices = u8() === 1 ? Array.from(take(u32())) : null;
  if (u8() !== 1) throw new Error("not a synchronous policy payload");
  if (u8() !== 0) throw new Error("not the vault's account index");
  const inner = take(u32());
  if (at !== data.length) throw new Error("bytes after the execution");
  if (input.keys.length < 2 + numSigners) throw new Error("the execution names too few accounts");
  const signers = input.keys.slice(2, 2 + numSigners);
  const accounts = input.keys.slice(2 + numSigners);
  let i = 0;
  const next = () => {
    if (i >= inner.length) throw new Error("the inner instructions end early");
    return inner[i++]!;
  };
  const instructions: { programId: PublicKey; accounts: PublicKey[]; data: Uint8Array }[] = [];
  const pick = (index: number) => {
    const key = accounts[index];
    if (!key) throw new Error("an inner account index outside the execution's accounts");
    return key;
  };
  for (let n = next(), k = 0; k < n; k += 1) {
    const programId = pick(next());
    const count = next();
    const ixAccounts = Array.from({ length: count }, () => pick(next()));
    const length = next() | (next() << 8);
    if (i + length > inner.length) throw new Error("an inner instruction's data ends early");
    instructions.push({ programId, accounts: ixAccounts, data: inner.subarray(i, i + length) });
    i += length;
  }
  if (i !== inner.length) throw new Error("bytes after the inner instructions");
  return { policy: input.keys[0]!, signers, constraintIndices, instructions };
}

/* ------------------------------------------------------------------ reading accounts */

const hasDiscriminator = (data: Uint8Array, expected: readonly number[]) => expected.every((byte, index) => data[index] === byte);

export type ProgramConfig = Readonly<{ smartAccountIndex: bigint; creationFee: bigint; treasury: PublicKey }>;

export function readProgramConfig(data: Uint8Array): ProgramConfig {
  if (data.length < 96 || !hasDiscriminator(data, DISCRIMINATOR.accountProgramConfig)) throw new Error("not the smart account program's config");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    smartAccountIndex: view.getBigUint64(8, true) + (view.getBigUint64(16, true) << 64n),
    creationFee: view.getBigUint64(56, true),
    treasury: new PublicKey(data.subarray(64, 96)),
  };
}

export type SettingsState = Readonly<{ signers: readonly PolicySigner[]; threshold: number; timeLock: number; policySeed: bigint | null }>;

export function readSettings(data: Uint8Array): SettingsState {
  if (!hasDiscriminator(data, DISCRIMINATOR.accountSettings)) throw new Error("not a smart account's settings");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8 + 16 + 32; // seed, settingsAuthority
  const threshold = view.getUint16(at, true);
  const timeLock = view.getUint32(at + 2, true);
  at += 2 + 4 + 8 + 8; // threshold, timeLock, transactionIndex, staleTransactionIndex
  at += data[at] === 1 ? 33 : 1; // archivalAuthority
  at += 8 + 1; // archivableAfter, bump
  const count = view.getUint32(at, true);
  at += 4;
  const signers: PolicySigner[] = [];
  for (let i = 0; i < count; i += 1, at += 33) signers.push({ key: new PublicKey(data.subarray(at, at + 32)), permissions: data[at + 32]! });
  at += 1; // accountUtilization
  const policySeed = at < data.length && data[at] === 1 && at + 9 <= data.length ? view.getBigUint64(at + 1, true) : null;
  return { signers, threshold, timeLock, policySeed };
}

/** The policy seed the next `PolicyCreate` gets: the settings' counter + 1 (the first is 1). */
export const nextPolicySeed = (settings: SettingsState) => (settings.policySeed ?? 0n) + 1n;

export type PolicyHead = Readonly<{ settings: PublicKey; seed: bigint; signers: readonly PolicySigner[]; threshold: number }>;

export function readPolicyHead(data: Uint8Array): PolicyHead {
  if (!hasDiscriminator(data, DISCRIMINATOR.accountPolicy)) throw new Error("not a smart account policy");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const settings = new PublicKey(data.subarray(8, 40));
  const policySeed = view.getBigUint64(40, true);
  let at = 8 + 32 + 8 + 1 + 8 + 8;
  const count = view.getUint32(at, true);
  at += 4;
  const signers: PolicySigner[] = [];
  for (let i = 0; i < count; i += 1, at += 33) signers.push({ key: new PublicKey(data.subarray(at, at + 32)), permissions: data[at + 32]! });
  return { settings, seed: policySeed, signers, threshold: view.getUint16(at, true) };
}

/* ------------------------------------------------------------------ the program's refusals */

/** The names the mandate's refusals come back with, from the program's own log line; by name — builds number them differently. */
export const REFUSAL = Object.freeze({
  /* The devnet build names an account-data rule's breach so too (CITY-136: 6064 for the receiver and for the amount). */
  ProgramInteractionInvalidNumericValue: "a value is outside the mandate (amount, price or receiving account)",
  ProgramInteractionAccountConstraintViolated: "an account is outside the mandate",
  ProgramInteractionProgramIdMismatch: "the program is outside the mandate",
  ProgramInteractionInsufficientTokenAllowance: "the day's budget is spent",
  ProgramInteractionInsufficientLamportAllowance: "the vault's SOL may not decrease",
  ProgramInteractionInstructionDataMismatch: "the instruction is outside the mandate",
  PolicyExpirationViolationTimestampExpired: "the mandate has ended",
  PolicyNotActiveYet: "the mandate has not started",
  NotASigner: "the key is not the policy's signer",
  AccountNotInitialized: "the mandate was revoked",
  AccountDiscriminatorNotFound: "the mandate was revoked",
  IllegalAccountOwner: "an account is outside the mandate",
  /* The venue's own minimum. */
  SlippageToleranceExceeded: "the route gave less than its minimum",
  ExceededAmountSlippageTolerance: "the pool gave less than its minimum",
  /* The rule in the trade itself (`./result.ts`). */
  ReceivedTooLittle: "the person's account did not receive the minimum",
});

/** The program's refusal in a transaction's logs: its name and a short reason; null when the logs carry none. */
export function refusalOf(logs: readonly string[]): Readonly<{ code: string; reason: string }> | null {
  for (const line of [...logs].reverse()) {
    const match = /Error Code: (\w+)/.exec(line);
    if (match) {
      const code = match[1]!;
      return { code, reason: (REFUSAL as Record<string, string>)[code] ?? code };
    }
    /* Lighthouse and Jupiter log no Anchor error, only their program's failure (both 0x1771, read on the fork). */
    if (/^Program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 failed/.test(line)) return { code: "ReceivedTooLittle", reason: REFUSAL.ReceivedTooLittle };
    if (/^Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771/.test(line)) return { code: "SlippageToleranceExceeded", reason: REFUSAL.SlippageToleranceExceeded };
  }
  return null;
}
