/**
 * CITY-174 — the agent's signer: the one key a person's policy names, and the bounds it signs within.
 *
 * The key sits under the same interface as Ryntra Launch's keys (CITY-162, `../launch/signer/signer.server.ts`): a
 * `KeySigner` signs bytes and never hands its key out. On devnet the key is the session's own (`env` — `envKey`); in
 * KMS it is the next step (D4, CITY-137: `kmsKeySigner` plugs in unchanged). Over the key, every time:
 * 1. the bounds — the message is read from its own bytes: the agent pays and is the only signer; besides the compute
 *    budget (at most 1.4 M units, a 256 KB heap, a capped price) and token accounts it opens for the vault or the
 *    person, there is exactly one execution of the mandate's own policy with one inner instruction that meets the
 *    policy's rules (`./judge.ts`) and whose minimum is no less than what the person was promised, and after it the one
 *    rule that her account really received that minimum (`./result.ts`). The trade pays Ryntra's fee at exactly the
 *    table's rate for its pair, into Ryntra's fee account and no other (`./fee.ts`, CITY-183): inside Jupiter's route, or
 *    on devnet as the one transfer before the pool's swap, the two together within the trade cap. A coin of Token-2022
 *    on either side is one whose every feature is on the agent's list (`./token-2022.ts`, CITY-184), and the rule on what
 *    reached the person counts the coin's transfer fee off the minimum. Anything else is refused with its reason, and
 *    the key is never asked;
 * 2. the check — the signature verifies against the agent's address before it is given back;
 * 3. the journal — what was signed, under which policy, its hash and signature: public data only. No row, no signature.
 *
 * The chain holds the same rules again and is the authority: this signer only keeps the agent from signing, or paying
 * for, a trade the program would refuse — or one a bug of ours built.
 */

import { createHash } from "node:crypto";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedMessage, type AddressLookupTableAccount } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import type { KeySigner, LaunchSignerMode } from "../launch/signer/signer.server.ts";
import { AGENT_COMPUTE_UNIT_LIMIT, AGENT_HEAP_BYTES, AGENT_UNIT_PRICE_MAX } from "./agent.ts";
import { AGENT_FEE_RATES, agentFeeAccount, agentFeeRaw, pairFeeBps, readFeeTransfer, type FeeSides } from "./fee.ts";
import { instructionRefusal, type AccountFacts, type InnerInstruction } from "./judge.ts";
import { LIGHTHOUSE_PROGRAM_ID, heldIn, jupiterFeeOf, readReceivedAtLeast, tradeTerms, type TradeTerms } from "./result.ts";
import { SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, type ProgramInteractionPolicy } from "./ssa.ts";
import { feeMintOf } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID, afterTransferFee, isTokenProgram, readCoin, type Coin } from "./token-2022.ts";
import type { Mandate } from "./human.ts";

const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/**
 * What the caller hands with the message: the lookup tables it names, what it read of the accounts the rules look into,
 * what the venue's quote promised the person, base units of the coin bought, and the catalogue's facts of the pair's
 * sides. The rate is not handed in: the signer reads the bought mint off the person's receiving account and asks the
 * table itself (`pairFeeBps`); a dollar or a major it knows by mint whatever the facts say. The facts hold the mints of
 * the pair too — the venue's instruction names them — and a coin of Token-2022 is judged from its mint's own bytes.
 * `epoch` — the chain's epoch now, which sets the rate of a coin's transfer fee; needed only for such a coin.
 */
export type AgentSignRequest = Readonly<{ lookupTables?: readonly AddressLookupTableAccount[]; facts: AccountFacts; promisedOut: bigint; feeSides: FeeSides; epoch?: bigint }>;

/**
 * The coin on one side of a trade as the agent trades it, or why not: a token account of Token carries a coin with no
 * features; one of Token-2022 — a coin judged from its mint, which the facts must hold.
 */
export function sideCoin(mint: PublicKey, program: PublicKey, facts: AccountFacts, epoch?: bigint): Readonly<{ coin: Coin }> | Readonly<{ refusal: string }> {
  const read = facts.get(mint.toBase58());
  if (read && !read.owner.equals(program)) return { refusal: "a token account is not of its coin's program" };
  if (program.equals(TOKEN_PROGRAM_ID)) return { coin: { mint, program, decimals: 0, transferFee: null } };
  if (!program.equals(TOKEN_2022_PROGRAM_ID)) return { refusal: "a side of the trade is not a token account" };
  const reading = readCoin(mint, read, epoch);
  return reading.ok ? { coin: reading.coin } : { refusal: reading.reason };
}

export type AgentSignatureRow = Readonly<{
  v: 1;
  cluster: string;
  role: "agent";
  mode: LaunchSignerMode;
  signer: string;
  keyRef: string | null;
  /** The policy the trade runs under. */
  policy: string;
  action: string;
  messageSha256: string;
  signature: string | null;
  outcome: "SIGNED" | "REFUSED";
  reason: string | null;
  at: string;
}>;

export type AgentJournal = (row: AgentSignatureRow) => Promise<void>;

/** A journal that keeps nothing refuses: a signer without a journal signs nothing. */
export const NO_AGENT_JOURNAL: AgentJournal = async () => {
  throw new Error("no signing journal here");
};

export class AgentSignerRefused extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`The agent refuses to sign: ${reason}.`);
    this.name = "AgentSignerRefused";
    this.reason = reason;
  }
}

export type AgentSigner = Readonly<{
  address: string;
  publicKey: PublicKey;
  mode: LaunchSignerMode;
  keyRef: string | null;
  /** The signature over a trade's message, once the bounds allow it and the journal kept it; throws `AgentSignerRefused` otherwise. */
  signMessage(message: Uint8Array, request: AgentSignRequest): Promise<Uint8Array>;
}>;

/**
 * Why the execution's instructions do not pay Ryntra's fee as the table names it for this trade; null when they do. On
 * Jupiter the fee is the route's own: the rate, Ryntra's account in the fee slot, no positive slippage taken. On devnet it
 * is the transfer before the swap: from the budget, into Ryntra's account, the table's share of the two together, which
 * stay within the trade cap — exactly the size of a regular buy.
 */
export function agentFeeRefusal(mandate: Mandate, instructions: readonly InnerInstruction[], feeBps: number): string | null {
  if (!AGENT_FEE_RATES.includes(feeBps)) return "the fee is not a rate of Ryntra's table";
  const account = agentFeeAccount(feeMintOf(mandate.terms));
  const swap = instructions.at(-1);
  const trade = swap ? tradeTerms(swap) : null;
  if (!swap || !trade) return "the trade names no minimum for the person";
  if (mandate.terms.venue.kind === "jupiter") {
    if (instructions.length !== 1) return "not one venue instruction in the execution";
    const fee = jupiterFeeOf(swap);
    if (!fee || fee.bps === 0) return "the route carries no Ryntra fee";
    if (!fee.account?.equals(account)) return "the fee goes to an account other than Ryntra's";
    if (fee.bps !== feeBps) return "the fee is not the table's rate for this trade";
    if (fee.positiveSlippageBps !== 0) return "the route takes positive slippage";
    return null;
  }
  if (instructions.length !== 2) return "not Ryntra's fee and one venue instruction in the execution";
  const transfer = readFeeTransfer(instructions[0]!);
  if (!transfer) return "the fee is not a transfer to Ryntra";
  if (!transfer.destination.equals(account)) return "the fee goes to an account other than Ryntra's";
  if (!transfer.source.equals(mandate.budgetAccount) || !transfer.mint.equals(mandate.terms.budgetMint) || !transfer.authority.equals(mandate.vault)) return "the fee is not paid from the budget";
  const gross = transfer.amount + trade.amountIn;
  if (transfer.amount <= 0n || transfer.amount !== agentFeeRaw(gross, feeBps)) return "the fee is not the table's share of the trade";
  const fixed = mandate.terms.fixedBuy;
  if (fixed ? gross !== fixed.amountIn : gross > mandate.terms.perTrade) return "the trade and its fee are over the trade cap";
  return null;
}

/** Why the message is not a trade this mandate's agent signs; null when it is. */
export function tradeRefusal(message: Uint8Array, mandate: Mandate, policy: ProgramInteractionPolicy, request: AgentSignRequest): string | null {
  let decoded: VersionedMessage;
  try {
    decoded = VersionedMessage.deserialize(message);
  } catch (error) {
    return `not a transaction message (${error instanceof Error ? error.message.split("\n")[0] : "unreadable"})`;
  }
  const agent = mandate.terms.agent;
  if (!decoded.staticAccountKeys[0]?.equals(agent)) return "the agent does not pay this transaction";
  if (decoded.header.numRequiredSignatures !== 1) return "the agent is not the only signer";
  let instructions;
  try {
    instructions = TransactionMessage.decompile(decoded, { addressLookupTableAccounts: [...(request.lookupTables ?? [])] }).instructions;
  } catch {
    return "the message names lookup tables it was not handed";
  }
  let executions = 0;
  let results = 0;
  let trade: TradeTerms | null = null;
  /* What the person must hold more of after the trade: its minimum, less the bought coin's transfer fee. */
  let reaches = 0n;
  let withholds = false;
  /* A token account the message itself opens is read as what it will be when the rules look into it. */
  const facts = new Map(request.facts);
  for (const instruction of instructions) {
    const program = instruction.programId;
    if (program.equals(ComputeBudgetProgram.programId)) {
      const data = instruction.data;
      const tag = data[0];
      if (tag === 2 && data.length === 5 && data.readUInt32LE(1) <= AGENT_COMPUTE_UNIT_LIMIT) continue;
      if (tag === 1 && data.length === 5 && data.readUInt32LE(1) <= AGENT_HEAP_BYTES) continue;
      if (tag === 3 && data.length === 9 && data.readBigUInt64LE(1) <= AGENT_UNIT_PRICE_MAX) continue;
      return "a compute-budget instruction beyond the agent's bounds";
    }
    if (program.equals(ASSOCIATED_TOKEN_PROGRAM)) {
      const [payer, account, owner, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
      if (instruction.data.length !== 1 || instruction.data[0] !== 1) return "a token-account instruction other than an idempotent opening";
      if (!payer?.equals(agent)) return "a token account the agent does not pay for";
      if (!owner || !(owner.equals(mandate.vault) || owner.equals(mandate.terms.human))) return "a token account for someone other than the vault or the person";
      if (!tokenProgram || !isTokenProgram(tokenProgram)) return "a token account of a program other than the token programs";
      if (!mint || !account?.equals(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram))) return "a token account that is not the owner's own";
      if (!facts.has(account.toBase58())) facts.set(account.toBase58(), { owner: tokenProgram, data: Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Uint8Array(101)]) });
      continue;
    }
    if (program.equals(LIGHTHOUSE_PROGRAM_ID)) {
      results += 1;
      const rule = readReceivedAtLeast(instruction);
      if (!rule) return "a rule other than what reached the person";
      if (!trade) return "the rule on what reached the person stands before the trade";
      if (!rule.account.equals(trade.receiver)) return "the rule looks at another account than the one receiving";
      const held = heldIn(facts.get(trade.receiver.toBase58())?.data);
      if (rule.amount < held + reaches) return "the rule asks less than the trade's minimum";
      /* A coin with a transfer fee: the rule asks exactly what is left of the minimum — more could never arrive. */
      if (withholds && rule.amount !== held + reaches) return "the rule does not count the coin's transfer fee off the minimum";
      continue;
    }
    if (program.equals(SSA_PROGRAM_ID)) {
      executions += 1;
      let view;
      try {
        view = readPolicyExecute({ programId: program, keys: instruction.keys.map((key) => key.pubkey), data: instruction.data });
      } catch (error) {
        return `a smart-account instruction other than this mandate's trade (${error instanceof Error ? error.message : "unreadable"})`;
      }
      if (!view.policy.equals(mandate.policy)) return "an execution under another policy";
      if (view.signers.length !== 1 || !view.signers[0]!.equals(agent)) return "an execution signed by someone other than the agent";
      if (!view.constraintIndices || view.constraintIndices.length !== view.instructions.length) return "an execution that does not name its rules";
      const jupiter = mandate.terms.venue.kind === "jupiter";
      if (view.instructions.length !== (jupiter ? 1 : 2)) return jupiter ? "not one venue instruction in the execution" : "not Ryntra's fee and one venue instruction in the execution";
      for (const [at, inner] of view.instructions.entries()) {
        const constraint = policy.constraints[view.constraintIndices[at]!];
        if (!constraint) return "an execution naming a rule the policy does not have";
        const refusal = instructionRefusal(inner, constraint, facts);
        if (refusal) return refusal;
      }
      trade = tradeTerms(view.instructions.at(-1)!);
      if (!trade || trade.minOut <= 0n) return "the trade names no minimum for the person";
      if (trade.minOut < (request.promisedOut * BigInt(10_000 - mandate.terms.slippageBps)) / 10_000n) return "the trade's minimum is under what the person was promised";
      const receiving = facts.get(trade.receiver.toBase58());
      const bought = receiving?.data;
      if (!receiving || !bought || bought.length < 32) return "the person's receiving account could not be read";
      const boughtMint = new PublicKey(bought.subarray(0, 32));
      /* CITY-184: a coin of Token-2022 on either side only when every feature of its mint is on the agent's list. */
      const output = sideCoin(boughtMint, receiving.owner, facts, request.epoch);
      if ("refusal" in output) return output.refusal;
      if (mandate.terms.budgetCoin) {
        const input = sideCoin(mandate.terms.budgetMint, mandate.terms.budgetCoin.program, facts, request.epoch);
        if ("refusal" in input) return input.refusal;
      }
      if (output.coin.transferFee && request.epoch === undefined) return "the epoch the coin's transfer fee is read at is not known";
      reaches = afterTransferFee(trade.minOut, output.coin, request.epoch ?? 0n);
      withholds = reaches !== trade.minOut;
      const floor = mandate.terms.fixedBuy?.minOut;
      if (output.coin.transferFee && floor !== undefined && reaches < floor) return "after the coin's transfer fee, less than the person's floor reaches her";
      const feeBps = pairFeeBps(mandate.terms.budgetMint.toBase58(), boughtMint.toBase58(), request.feeSides);
      if (feeBps === null) return "Ryntra's table names no router fee for this pair";
      const feeRefusal = agentFeeRefusal(mandate, view.instructions, feeBps);
      if (feeRefusal) return feeRefusal;
      continue;
    }
    return `an instruction of a program outside the mandate (${program.toBase58()})`;
  }
  if (executions !== 1) return "not exactly one trade under the mandate";
  return results === 1 ? null : "not exactly one rule on what reached the person";
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/** The agent's key under the mandate's bounds, its check and its journal. */
export function mandateSigner(
  key: KeySigner,
  options: Readonly<{ mandate: Mandate; policy: ProgramInteractionPolicy; journal: AgentJournal; now?: () => Date }>,
): AgentSigner {
  const { mandate } = options;
  const publicKey = mandate.terms.agent;
  const address = publicKey.toBase58();
  const now = options.now ?? (() => new Date());
  const row = (fields: Pick<AgentSignatureRow, "messageSha256" | "signature" | "outcome" | "reason">): AgentSignatureRow => ({
    v: 1,
    cluster: mandate.cluster,
    role: "agent",
    mode: key.mode,
    signer: address,
    keyRef: key.keyRef,
    policy: mandate.policy.toBase58(),
    action: "mandate.trade",
    ...fields,
    at: now().toISOString(),
  });
  const refuse = async (reason: string, messageSha256: string): Promise<never> => {
    await options.journal(row({ messageSha256, signature: null, outcome: "REFUSED", reason })).catch(() => undefined);
    throw new AgentSignerRefused(reason);
  };
  return {
    address,
    publicKey,
    mode: key.mode,
    keyRef: key.keyRef,
    async signMessage(message, request) {
      const messageSha256 = sha256(message);
      const refusal = tradeRefusal(message, mandate, options.policy, request);
      if (refusal) return refuse(refusal, messageSha256);
      let signature: Uint8Array;
      try {
        signature = await key.sign(message);
      } catch (error) {
        return refuse(`the ${key.mode} key did not sign (${reasonOf(error)})`, messageSha256);
      }
      if (signature.length !== 64 || !ed25519Valid(message, signature, publicKey)) return refuse(`the ${key.mode} key's signature is not ${address}'s`, messageSha256);
      await options.journal(row({ messageSha256, signature: getBase58Decoder().decode(signature), outcome: "SIGNED", reason: null }));
      return Uint8Array.from(signature);
    },
  };
}
