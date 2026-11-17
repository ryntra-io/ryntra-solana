/**
 * What an agent that looks after a DLMM Pro position signs — read from the message's own bytes.
 *
 * The program holds the money's way out: a delegate's collect and removal are paid only into the owner's own
 * associated accounts (`./earn.server.ts`; rehearsed — a delegate that names its own accounts is refused with
 * `IncorrectATA`). This file keeps the agent's key from signing, or paying the network for, anything else — a bug of
 * ours, a build for another position, an instruction that is not one of a care's three. It is the second lock, not
 * the first: whatever the caller says the bytes do, the bytes are read.
 *
 * A message passes only when:
 * - the agent pays for it and is its only signer, and it reads no lookup table;
 * - every instruction is one of: a compute-budget setting within the agent's ceiling; the opening, idempotent, of an
 *   associated token account **of the owner's**, paid by the agent; or a call of the DLMM Pro program that is
 *   `claim_fee`, `claim_reward` or `remove_liquidity_by_bps` — on this care's pool, on this care's position (the
 *   owner's NFT account), signed by the agent, and naming the owner's own associated accounts as where it pays — or
 *   the refresh the SDK sends ahead of a collect (`refresh_fees_and_rewards`: it brings the position's books up to
 *   the pool's and moves nothing), on the same pool and position;
 * - there is at least one call that pays.
 *
 * Pure but for the SDK's IDL: no I/O, no clock.
 */

import { DlmmProIDL, derivePosition, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedMessage, type TransactionInstruction } from "@solana/web3.js";

import type { Address } from "../../contracts.ts";
import { DLMM_PRO_PROGRAM } from "./sdk.server.ts";
import { MAX_PRIORITY_FEE_LAMPORTS, MAX_TX_UNITS } from "./tx.server.ts";

/** `mints` — the coins the agent may open an owner's account of: the pool's two and its rewards'; absent — any. */
export type CareSubject = Readonly<{ agent: Address; owner: Address; pool: Address; nftMint: Address; mints?: readonly Address[] }>;

type Layout = Readonly<{ discriminator: Uint8Array; index: Readonly<Record<string, number>> }>;
const layoutOf = (name: string): Layout => {
  const instruction = DlmmProIDL.instructions.find((entry) => entry.name === name);
  if (!instruction) throw new Error(`The IDL has no instruction ${name}.`);
  return { discriminator: Uint8Array.from(instruction.discriminator), index: Object.fromEntries(instruction.accounts.map((account, at) => [account.name, at])) };
};

/** The calls of a care — its three, and the refresh a collect is sent with — with where each names the pool, the position, the signer and the accounts it pays into. */
const CALLS = Object.freeze({
  refresh: { ...layoutOf("refresh_fees_and_rewards"), pays: [] },
  claimFee: { ...layoutOf("claim_fee"), pays: [["user_token_x", "token_x_mint", "token_x_program"], ["user_token_y", "token_y_mint", "token_y_program"]] },
  claimReward: { ...layoutOf("claim_reward"), pays: [["user_token_account", "reward_mint", "token_program"]] },
  removeLiquidity: { ...layoutOf("remove_liquidity_by_bps"), pays: [["user_token_x", "token_x_mint", "token_x_program"], ["user_token_y", "token_y_mint", "token_y_program"]] },
} as const);

export type CareCall = keyof typeof CALLS;

const starts = (data: Uint8Array, head: Uint8Array) => head.length <= data.length && head.every((byte, index) => data[index] === byte);
const isTokenProgram = (key: PublicKey) => key.equals(TOKEN_PROGRAM_ID) || key.equals(TOKEN_2022_PROGRAM_ID);

/** Which of a care's calls an instruction of the program is; null for any other. */
export function careCallOf(data: Uint8Array): CareCall | null {
  for (const name of Object.keys(CALLS) as CareCall[]) if (starts(data, CALLS[name].discriminator)) return name;
  return null;
}

function callRefusal(instruction: TransactionInstruction, subject: Readonly<{ agent: PublicKey; owner: PublicKey; pool: PublicKey; nftAccount: PublicKey; position: PublicKey }>): string | null {
  const name = careCallOf(instruction.data);
  if (!name) return "a call of the program that is not a care's: only the fees, the reward and the liquidity are taken";
  const call: Layout & Readonly<{ pays: readonly (readonly [string, string, string])[] }> = CALLS[name];
  const at = (account: string) => instruction.keys[call.index[account] ?? -1]?.pubkey ?? null;
  if (!at("pool")?.equals(subject.pool)) return "a call on another pool";
  if (!at("position")?.equals(subject.position) || !at("nft_account")?.equals(subject.nftAccount)) return "a call on another position";
  if (!at("signer")?.equals(subject.agent)) return "a call the agent does not sign";
  for (const [account, mint, program] of call.pays) {
    const pays = at(account);
    const coin = at(mint);
    const tokenProgram = at(program);
    if (!pays || !coin || !tokenProgram || !isTokenProgram(tokenProgram)) return "a call that does not name where it pays";
    if (!pays.equals(getAssociatedTokenAddressSync(coin, subject.owner, true, tokenProgram))) return "a call that pays an account other than the owner's own";
  }
  return null;
}

/** Why the message is not one a care's agent signs; null when it is. */
export function careRefusalOf(message: Uint8Array, care: CareSubject): string | null {
  let decoded: VersionedMessage;
  try {
    decoded = VersionedMessage.deserialize(message);
  } catch {
    return "not a transaction message";
  }
  const agent = new PublicKey(care.agent);
  const owner = new PublicKey(care.owner);
  const nftMint = new PublicKey(care.nftMint);
  const program = new PublicKey(DLMM_PRO_PROGRAM);
  const subject = { agent, owner, pool: new PublicKey(care.pool), nftAccount: findNftAccount(nftMint, owner), position: derivePosition(nftMint, program) };
  if (agent.equals(owner)) return "the agent is not the position's owner";
  if (decoded.header.numRequiredSignatures !== 1 || !decoded.staticAccountKeys[0]?.equals(agent)) return "the agent is not the one payer and signer";
  if (decoded.addressTableLookups.length > 0) return "the message reads a lookup table";
  let instructions: TransactionInstruction[];
  try {
    instructions = TransactionMessage.decompile(decoded).instructions;
  } catch {
    return "the message cannot be read";
  }
  let calls = 0;
  let units = 200_000n;
  let price = 0n;
  for (const instruction of instructions) {
    const data = Buffer.from(instruction.data);
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      if (data[0] === 2 && data.length === 5) units = BigInt(data.readUInt32LE(1));
      else if (data[0] === 3 && data.length === 9) price = data.readBigUInt64LE(1);
      else return "a compute-budget setting other than the limit and the price";
      continue;
    }
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const [payer, account, holder, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
      if (data.length !== 1 || data[0] !== 1) return "a token account opened other than idempotently";
      if (!payer?.equals(agent)) return "a token account paid by someone other than the agent";
      if (!holder?.equals(owner)) return "a token account opened for someone other than the owner";
      if (!mint || !tokenProgram || !isTokenProgram(tokenProgram) || !account?.equals(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram))) return "a token account that is not the owner's own";
      if (care.mints && !care.mints.includes(mint.toBase58())) return "a token account of a coin that is not the pool's";
      continue;
    }
    if (instruction.programId.equals(program)) {
      const refusal = callRefusal(instruction, subject);
      if (refusal) return refusal;
      if (careCallOf(instruction.data) !== "refresh") calls += 1;
      continue;
    }
    return "an instruction outside the care";
  }
  if (calls === 0) return "no call of the care that pays the owner";
  if (units > BigInt(MAX_TX_UNITS) || (units * price) / 1_000_000n > BigInt(MAX_PRIORITY_FEE_LAMPORTS)) return "the compute budget is outside the agent's ceiling";
  return null;
}
