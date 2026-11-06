/**
 * CITY-203 — the smart account's executions for the care vault.
 *
 * The person's smart account may already hold the agent's trading budget in its first vault (index 0, `../mandate/**`).
 * The positions the agent looks after live in a vault of their own — index 1 of the same smart account — so that no
 * rule of the trading policy can reach the liquidity, and no rule of the care policies can reach the budget. The
 * encodings are the program's `executeTransactionSyncV2` (`../mandate/ssa.ts` writes them for vault 0), with the vault's
 * index as a parameter.
 */

import { type AccountMeta, type PublicKey, TransactionInstruction } from "@solana/web3.js";

import { SSA_PROGRAM_ID, compileInner, ssaAddress } from "../mandate/ssa.ts";

/** The first vault a care's positions live in; each further care of the same person takes the next index. */
export const CARE_VAULT_INDEX = 1;

export const careVaultOf = (settings: PublicKey, index = CARE_VAULT_INDEX): PublicKey => ssaAddress.vault(settings, index);

const DISCRIMINATOR_EXECUTE_SYNC_V2 = Uint8Array.of(90, 81, 187, 81, 39, 70, 128, 78);

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({ pubkey, isSigner, isWritable });

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/**
 * The agent acting through a care policy on the care vault: `constraintIndices` names, for each inner instruction, the
 * policy's rule it claims to meet; the program checks exactly that rule.
 */
export function carePolicyExecuteInstruction(
  input: Readonly<{ policy: PublicKey; signer: PublicKey; instructions: readonly TransactionInstruction[]; constraintIndices: readonly number[]; accountIndex?: number; freshSigners?: readonly PublicKey[] }>,
): TransactionInstruction {
  if (input.constraintIndices.length !== input.instructions.length) throw new Error("one constraint index per inner instruction");
  const index = input.accountIndex ?? CARE_VAULT_INDEX;
  const { bytes, accounts } = compileInner(input.instructions);
  const data = Buffer.concat([
    DISCRIMINATOR_EXECUTE_SYNC_V2,
    Uint8Array.of(index, 1), // the vault's index, one signer
    Uint8Array.of(1, 1), // SyncPayload::Policy → PolicyPayload::ProgramInteraction
    Uint8Array.of(1), // Some(instruction constraint indices)
    u32le(input.constraintIndices.length),
    Uint8Array.from(input.constraintIndices),
    Uint8Array.of(1, index), // ProgramInteractionTransactionPayload::SyncTransaction { accountIndex }
    u32le(bytes.length),
    bytes,
  ]);
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data,
    /* A fresh key — a new position, its NFT's mint — signs the transaction and keeps its signature through the CPI. */
    keys: [meta(input.policy, false, true), meta(SSA_PROGRAM_ID, false, false), meta(input.signer, true, false), ...accounts.map((account) => ((input.freshSigners ?? []).some((key) => key.equals(account.pubkey)) ? { ...account, isSigner: true } : account))],
  });
}

/** The settings signer — the person — acting on the care vault at once, with no policy and no Ryntra in the way. */
export function careOwnerExecuteInstruction(input: Readonly<{ settings: PublicKey; signer: PublicKey; instructions: readonly TransactionInstruction[]; accountIndex?: number }>): TransactionInstruction {
  const { bytes, accounts } = compileInner(input.instructions);
  const data = Buffer.concat([DISCRIMINATOR_EXECUTE_SYNC_V2, Uint8Array.of(input.accountIndex ?? CARE_VAULT_INDEX, 1), Uint8Array.of(0), u32le(bytes.length), bytes]);
  return new TransactionInstruction({
    programId: SSA_PROGRAM_ID,
    data,
    keys: [meta(input.settings, false, true), meta(SSA_PROGRAM_ID, false, false), meta(input.signer, true, false), ...accounts],
  });
}

export type CareExecuteView = Readonly<{
  accountIndex: number;
  policy: PublicKey;
  signers: readonly PublicKey[];
  constraintIndices: readonly number[];
  instructions: readonly Readonly<{ programId: PublicKey; accounts: readonly PublicKey[]; data: Uint8Array }>[];
}>;

/** The inverse of `carePolicyExecuteInstruction`; throws on any other shape — vault 0, an owner execution, a stray byte. */
export function readCarePolicyExecute(input: Readonly<{ programId: PublicKey; keys: readonly PublicKey[]; data: Uint8Array }>): CareExecuteView {
  if (!input.programId.equals(SSA_PROGRAM_ID)) throw new Error("not the smart account program");
  const data = input.data;
  if (!DISCRIMINATOR_EXECUTE_SYNC_V2.every((byte, index) => data[index] === byte)) throw new Error("not a synchronous execution");
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
  const accountIndex = u8();
  if (accountIndex < CARE_VAULT_INDEX) throw new Error("not a care vault");
  const numSigners = u8();
  if (u8() !== 1 || u8() !== 1) throw new Error("not a program-interaction policy payload");
  if (u8() !== 1) throw new Error("the execution names no rules");
  const constraintIndices = Array.from(take(u32()));
  if (u8() !== 1) throw new Error("not a synchronous policy payload");
  if (u8() !== accountIndex) throw new Error("the execution names two vaults");
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
  const pick = (index: number) => {
    const key = accounts[index];
    if (!key) throw new Error("an inner account index outside the execution's accounts");
    return key;
  };
  const instructions: { programId: PublicKey; accounts: PublicKey[]; data: Uint8Array }[] = [];
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
  return { accountIndex, policy: input.keys[0]!, signers, constraintIndices, instructions };
}
