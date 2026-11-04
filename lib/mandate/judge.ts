/**
 * CITY-174 — the mandate's rules, read the way the program reads them, before a trade is signed.
 *
 * The chain is the authority: whatever this file says, the smart account program checks the same constraints again and
 * refuses what breaks them. This copy exists so that the agent never signs, and never pays the fee for, a trade the
 * chain would refuse — and so that the agent's signer refuses a message outside the mandate on its own (defence in
 * depth, CITY-162's rule: the bytes are read again, whatever the caller says they do). The day's cap is the one rule
 * left to the chain alone: it needs the policy's usage.
 */

import { PublicKey } from "@solana/web3.js";

import type { AccountConstraint, DataConstraint, InstructionConstraint } from "./ssa.ts";

/** What the agent read of the accounts a data rule looks into: the account's program owner and its data. */
export type AccountFacts = ReadonlyMap<string, Readonly<{ owner: PublicKey; data: Uint8Array }>>;

export type InnerInstruction = Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>;

function readNumber(bytes: Uint8Array, offset: number, size: number): bigint | null {
  if (offset < 0 || offset + size > bytes.length) return null;
  let value = 0n;
  for (let i = size - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

const SIZE = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16 } as const;

/** Why `bytes` break the rule; null when they keep it. */
export function dataRefusal(bytes: Uint8Array, rule: DataConstraint): string | null {
  const value = rule.value;
  if (value.kind === "bytes") {
    if (rule.offset + value.value.length > bytes.length) return `no bytes at ${rule.offset}`;
    const same = value.value.every((byte, index) => bytes[rule.offset + index] === byte);
    if (rule.operator === "equals" ? same : rule.operator === "notEquals" ? !same : false) return null;
    return `the bytes at ${rule.offset} are not the pinned ones`;
  }
  const actual = readNumber(bytes, rule.offset, SIZE[value.kind]);
  if (actual === null) return `no number at ${rule.offset}`;
  const limit = BigInt(value.value);
  const kept = {
    equals: actual === limit,
    notEquals: actual !== limit,
    greaterThan: actual > limit,
    greaterThanOrEqualTo: actual >= limit,
    lessThan: actual < limit,
    lessThanOrEqualTo: actual <= limit,
  }[rule.operator];
  return kept ? null : `the number at ${rule.offset} (${actual}) breaks ${rule.operator} ${limit}`;
}

function accountRefusal(instruction: InnerInstruction, rule: AccountConstraint, facts: AccountFacts): string | null {
  const key = instruction.accounts[rule.index];
  if (!key) return `no account at ${rule.index}`;
  if (rule.rule.kind === "keys") return rule.rule.keys.some((pinned) => pinned.equals(key)) ? null : `account ${rule.index} is not a pinned one`;
  const fact = facts.get(key.toBase58());
  if (!fact) return `account ${rule.index} could not be read`;
  if (rule.owner && !fact.owner.equals(rule.owner)) return `account ${rule.index} belongs to another program`;
  for (const data of rule.rule.constraints) {
    const refusal = dataRefusal(fact.data, data);
    if (refusal) return `account ${rule.index}: ${refusal}`;
  }
  return null;
}

/** Why the instruction does not meet the constraint; null when it does — every account rule and every data rule. */
export function instructionRefusal(instruction: InnerInstruction, constraint: InstructionConstraint, facts: AccountFacts): string | null {
  if (!instruction.programId.equals(constraint.programId)) return "the program is outside the mandate";
  for (const account of constraint.accounts) {
    const refusal = accountRefusal(instruction, account, facts);
    if (refusal) return refusal;
  }
  for (const data of constraint.data) {
    const refusal = dataRefusal(instruction.data, data);
    if (refusal) return refusal;
  }
  return null;
}

/** The accounts whose data a constraint reads — what the agent fetches before it judges. */
export function accountsToRead(instruction: InnerInstruction, constraint: InstructionConstraint): readonly PublicKey[] {
  return constraint.accounts.filter((account) => account.rule.kind === "data").flatMap((account) => (instruction.accounts[account.index] ? [instruction.accounts[account.index]!] : []));
}
