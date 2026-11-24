/**
 * The agent's signer: the one key a person's policy names, and the bounds it signs within.
 *
 * The key sits under the same interface as Ryntra Launch's keys (`../launch/signer/signer.server.ts`): a
 * `KeySigner` signs bytes and never hands its key out. On devnet the key may be the deployment's own (`env` —
 * `envKey`); on mainnet it is in Google Cloud KMS and nowhere else (`kmsKeySigner`, which
 * `./agent-service.server.ts` chooses). Over the key, every time:
 * 1. the bounds — the message is read from its own bytes: the agent pays and is the only signer; besides the compute
 *    budget (at most 1.4 M units, a 256 KB heap, a capped price) and token accounts it opens for the vault or the
 *    person, there is exactly one execution of the mandate's own policy with one inner instruction that meets the
 *    policy's rules (`./judge.ts`) and whose minimum is no less than what the person was promised, and after it the one
 *    rule that her account really received that minimum (`./result.ts`). The trade pays Ryntra's fee at exactly the
 *    table's rate for its pair, into Ryntra's fee account and no other (`./fee.ts`): inside Jupiter's route, or
 *    on devnet as the one transfer before the pool's swap, the two together within the trade cap. A coin of Token-2022
 *    on either side is one whose every feature is on the agent's list (`./token-2022.ts`), and the rule on what
 *    reached the person counts the coin's transfer fee off the minimum. A stock is taken with its issuer's rights only
 *    when the signer itself found its mint on the shelf of verified companies — the screen's own read, never a word of
 *    the request — and only under the stock's conditions. Anything else is refused with its reason, and
 *    the key is never asked;
 * 2. the check — the signature verifies against the agent's address before it is given back;
 * 3. the journal — what was signed, under which policy, its hash and signature: public data only. No row, no signature.
 * Her copy (`terms.copyCoins`): a buy lands only in the vault's own account of one of the coins she signed for,
 * under that coin's program; a sale runs under the sales' policy of that coin's group, from the vault's own account of
 * the coin into her own account of the budget's token — each coin judged on its own side by the agent's list.
 * Before the key, too (`./ryntra-coins.server.ts`): the coin bought is no coin of Ryntra's launchpad and none of
 * the person's own, and no other key of Ryntra's — no other agent's vault — stands in the trade. The registry not read
 * is a refusal.
 *
 * The chain holds the same rules again and is the authority: this signer only keeps the agent from signing, or paying
 * for, a trade the program would refuse — or one a bug of ours built.
 */

import { createHash } from "node:crypto";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedMessage, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import type { KeySigner, LaunchSignerMode } from "../launch/signer/signer.server.ts";
import { AGENT_COMPUTE_UNIT_LIMIT, AGENT_HEAP_BYTES, AGENT_UNIT_PRICE_MAX } from "./agent.ts";
import { AGENT_FEE_RATES, agentFeeAccount, agentFeeRaw, pairFeeBps, readFeeTransfer, type FeeSides } from "./fee.ts";
import { instructionRefusal, type AccountFacts, type InnerInstruction } from "./judge.ts";
import { LIGHTHOUSE_PROGRAM_ID, heldIn, jupiterFeeOf, readReceivedAtLeast, tradeTerms, type TradeTerms } from "./result.ts";
import { SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, type ProgramInteractionPolicy } from "./ssa.ts";
import { DLMM_PROGRAM_ID, JUPITER_PROGRAM_ID, LAYOUT, ROUTE_V2, copyChunks, copySalePolicyOf, feeMintOf, heldAccountOf, proceedsAccountOf, salePolicyOf, type HeldCoin } from "./terms.ts";
import { COIN_REFUSED, TOKEN_2022_PROGRAM_ID, afterTransferFee, isTokenProgram, readCoin, stockAccountRefusal, type Coin } from "./token-2022.ts";
import { copySaleChunk, type Mandate } from "./human.ts";
import { coinRefusal, ryntraAccountRefusal, type AgentScreen } from "./ryntra-coins.server.ts";

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
 * features; one of Token-2022 — a coin judged from its mint, which the facts must hold. `stock` — the signer found this
 * mint on the shelf of verified companies: it is judged as a stock (`./token-2022.ts` `readCoin`).
 */
export function sideCoin(mint: PublicKey, program: PublicKey, facts: AccountFacts, epoch?: bigint, stock = false): Readonly<{ coin: Coin }> | Readonly<{ refusal: string }> {
  const read = facts.get(mint.toBase58());
  if (read && !read.owner.equals(program)) return { refusal: "a token account is not of its coin's program" };
  if (program.equals(TOKEN_PROGRAM_ID)) return { coin: { mint, program, decimals: 0, transferFee: null } };
  if (!program.equals(TOKEN_2022_PROGRAM_ID)) return { refusal: "a side of the trade is not a token account" };
  const reading = readCoin(mint, read, epoch, stock ? { stock: true } : undefined);
  return reading.ok ? { coin: reading.coin } : { refusal: reading.reason };
}

/** No side of a trade is a stock: what the bounds are judged by until the signer has asked the shelf itself. */
const NO_STOCK_SIDES: ReadonlySet<string> = new Set();

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

/**
 * Why a sale's instructions do not pay Ryntra's fee as the table names it; null when they do. Through Jupiter
 * the fee is the route's own, exactly as on a buy, in the budget's token she receives. On devnet it is the transfer before
 * the pool's swap: of the coin, from the vault's account of it, into Ryntra's account of that coin, the table's share of the
 * two together — the sale's whole amount is hers, so no cap stands over it.
 */
export function agentSaleFeeRefusal(mandate: Mandate, instructions: readonly InnerInstruction[], feeBps: number, sold?: Pick<HeldCoin, "mint" | "program">): string | null {
  /* A copy's sale names the coin it sells. */
  const held = sold ?? mandate.terms.heldCoin;
  if (!held) return "the mandate keeps no coin to sell";
  if (mandate.terms.venue.kind === "jupiter") return agentFeeRefusal(mandate, instructions, feeBps);
  if (!AGENT_FEE_RATES.includes(feeBps)) return "the fee is not a rate of Ryntra's table";
  const trade = instructions.at(-1) ? tradeTerms(instructions.at(-1)!) : null;
  if (!trade) return "the trade names no minimum for the person";
  if (instructions.length !== 2) return "not Ryntra's fee and one venue instruction in the execution";
  const transfer = readFeeTransfer(instructions[0]!);
  if (!transfer) return "the fee is not a transfer to Ryntra";
  if (!transfer.destination.equals(agentFeeAccount(held.mint))) return "the fee goes to an account other than Ryntra's";
  if (!transfer.source.equals(heldAccountOf(mandate.vault, held)) || !transfer.mint.equals(held.mint) || !transfer.authority.equals(mandate.vault)) return "the fee is not paid from the coin sold";
  if (transfer.amount <= 0n || transfer.amount !== agentFeeRaw(transfer.amount + trade.amountIn, feeBps)) return "the fee is not the table's share of the trade";
  return null;
}

/** The vault's account a venue instruction sells from — Jupiter's source, or the pool's input; null — none named. */
function soldAccountOf(inner: InnerInstruction): PublicKey | null {
  if (inner.programId.equals(JUPITER_PROGRAM_ID)) return inner.accounts[ROUTE_V2.every((byte, index) => inner.data[index] === byte) ? LAYOUT.routeV2.source : LAYOUT.sharedRouteV2.source] ?? null;
  if (inner.programId.equals(DLMM_PROGRAM_ID)) return inner.accounts[LAYOUT.dlmmSwap2.source] ?? null;
  return null;
}

/** The coin of her copy whose vault account this is — within the group of one sale's policy when named; null — none. */
function copyCoinAt(mandate: Mandate, account: PublicKey | null, chunk: number | null = null): HeldCoin | null {
  const coins = mandate.terms.copyCoins;
  if (!coins || !account) return null;
  const among = chunk === null ? coins : (copyChunks(coins)[chunk] ?? []);
  return among.find((coin) => heldAccountOf(mandate.vault, coin).equals(account)) ?? null;
}

/**
 * Why the message is not a trade this mandate's agent signs; null when it is. `stocks` — the mints of this trade the
 * signer itself found on the shelf of verified companies (`stockSides`); with none, every coin is judged by the strict rule.
 * An execution under the mandate's sale policy is judged as a sale of the coin the agent keeps — by that policy's
 * rules, which the signer writes itself from the terms, never from the request: the coin from the vault's account of it,
 * the money to her own account of the budget's token and nowhere else.
 */
export function tradeRefusal(message: Uint8Array, mandate: Mandate, policy: ProgramInteractionPolicy, request: AgentSignRequest, stocks: ReadonlySet<string> = NO_STOCK_SIDES): string | null {
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
      /* The buy's policy, or the sale's — whose rules the signer writes from the terms itself. */
      const held = mandate.terms.heldCoin;
      const selling = Boolean(held && mandate.salePolicy?.equals(view.policy));
      /* Or one of her copy's sales' policies — its group's rules, written from the terms too. */
      const copyChunk = copySaleChunk(mandate, view.policy);
      if (!view.policy.equals(mandate.policy) && !selling && copyChunk === null) return "an execution under another policy";
      const accounts = { vault: mandate.vault, budgetAccount: mandate.budgetAccount };
      const rules = selling ? salePolicyOf(mandate.terms, accounts) : copyChunk !== null ? copySalePolicyOf(mandate.terms, accounts, copyChunk) : policy;
      if (view.signers.length !== 1 || !view.signers[0]!.equals(agent)) return "an execution signed by someone other than the agent";
      if (!view.constraintIndices || view.constraintIndices.length !== view.instructions.length) return "an execution that does not name its rules";
      const jupiter = mandate.terms.venue.kind === "jupiter";
      if (view.instructions.length !== (jupiter ? 1 : 2)) return jupiter ? "not one venue instruction in the execution" : "not Ryntra's fee and one venue instruction in the execution";
      for (const [at, inner] of view.instructions.entries()) {
        const constraint = rules.constraints[view.constraintIndices[at]!];
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
      /* A sale's money is the budget's token, in her own account of it — whatever the request says. */
      if ((selling || copyChunk !== null) && (!trade.receiver.equals(proceedsAccountOf(mandate.terms)) || !boughtMint.equals(mandate.terms.budgetMint))) return "the sale's money does not land in the person's own account of the budget's token";
      /* A copy's sale sells a coin of this policy's group, from the vault's own account of it. */
      const copySold = copyChunk !== null ? copyCoinAt(mandate, soldAccountOf(view.instructions.at(-1)!), copyChunk) : null;
      if (copyChunk !== null && !copySold) return "the copy sells only a coin of this sale's group, from the vault's own account of it";
      /* One sale never more than the coin's whole day — the chain refuses it, and the signer before it (on devnet the fee counts too). */
      if (copySold && trade.amountIn + (mandate.terms.venue.kind === "dlmm" ? (readFeeTransfer(view.instructions[0]!)?.amount ?? 0n) : 0n) > copySold.dailyMax) return "the sale is over the coin's day";
      /* The same for the coin the agent keeps — a grid's level, a signal's leave, her rules' sale: never more than its whole day in one sale. */
      if (selling && held && trade.amountIn + (mandate.terms.venue.kind === "dlmm" ? (readFeeTransfer(view.instructions[0]!)?.amount ?? 0n) : 0n) > held.dailyMax) return "the sale is over the coin's day";
      /* A copy's buy is of a coin she signed for, into the vault's own account of it under its program. */
      if (mandate.terms.copyCoins && copyChunk === null) {
        const coin = mandate.terms.copyCoins.find((entry) => entry.mint.equals(boughtMint));
        if (!coin) return "the copy buys only a coin she signed for";
        if (!trade.receiver.equals(heldAccountOf(mandate.vault, coin)) || !receiving.owner.equals(coin.program)) return "the copy's buy does not land in the vault's own account of the coin";
      }
      /* A coin of Token-2022 on either side only when every feature of its mint is on the agent's list. */
      const boughtStock = stocks.has(boughtMint.toBase58());
      const output = sideCoin(boughtMint, receiving.owner, facts, request.epoch, boughtStock);
      if ("refusal" in output) return output.refusal;
      /* A stock lands only on an account its issuer has not frozen and that takes plain amounts. */
      const stockAccount = boughtStock ? stockAccountRefusal(bought) : null;
      if (stockAccount) return stockAccount;
      if (mandate.terms.budgetCoin) {
        const input = sideCoin(mandate.terms.budgetMint, mandate.terms.budgetCoin.program, facts, request.epoch, stocks.has(mandate.terms.budgetMint.toBase58()));
        if ("refusal" in input) return input.refusal;
      }
      /* The coin sold is the one the agent kept, judged as on its buy. */
      if (selling && held) {
        const input = sideCoin(held.mint, held.program, facts, request.epoch, stocks.has(held.mint.toBase58()));
        if ("refusal" in input) return input.refusal;
      }
      /* The copy's coin sold, judged as on its buy — a coin of Token-2022 only with every feature on the list. */
      if (copySold) {
        const input = sideCoin(copySold.mint, copySold.program, facts, request.epoch);
        if ("refusal" in input) return input.refusal;
      }
      if (output.coin.transferFee && request.epoch === undefined) return "the epoch the coin's transfer fee is read at is not known";
      reaches = afterTransferFee(trade.minOut, output.coin, request.epoch ?? 0n);
      withholds = reaches !== trade.minOut;
      const floor = mandate.terms.fixedBuy?.minOut;
      if (output.coin.transferFee && floor !== undefined && reaches < floor) return "after the coin's transfer fee, less than the person's floor reaches her";
      /* A sale is priced by the table as the coin into the budget's token: its sides are named in that order. */
      const soldMint = selling && held ? held.mint : copySold ? copySold.mint : mandate.terms.budgetMint;
      const feeBps = pairFeeBps(soldMint.toBase58(), boughtMint.toBase58(), request.feeSides);
      if (feeBps === null) return "Ryntra's table names no router fee for this pair";
      const feeRefusal = selling ? agentSaleFeeRefusal(mandate, view.instructions, feeBps) : copySold ? agentSaleFeeRefusal(mandate, view.instructions, feeBps, copySold) : agentFeeRefusal(mandate, view.instructions, feeBps);
      if (feeRefusal) return feeRefusal;
      continue;
    }
    return `an instruction of a program outside the mandate (${program.toBase58()})`;
  }
  if (executions !== 1) return "not exactly one trade under the mandate";
  return results === 1 ? null : "not exactly one rule on what reached the person";
}

/**
 * Whether the instructions before the trade open her own account of the budget's token — the one account a sale's
 * money lands in (`proceedsAccountOf`) — as the agent opens it on her first sale, when she holds none yet: an idempotent
 * opening the agent pays for, for her, of the budget's mint under Token. Exactly what the bounds read it as.
 */
function opensProceeds(instructions: readonly TransactionInstruction[], mandate: Mandate): boolean {
  const proceeds = proceedsAccountOf(mandate.terms);
  return instructions.some((instruction) => {
    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM) || instruction.data.length !== 1 || instruction.data[0] !== 1) return false;
    const [payer, account, owner, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
    return Boolean(payer?.equals(mandate.terms.agent) && account?.equals(proceeds) && owner?.equals(mandate.terms.human) && mint?.equals(mandate.terms.budgetMint) && tokenProgram?.equals(TOKEN_PROGRAM_ID));
  });
}

/**
 * The coin of her copy whose vault account the instructions before the trade open — as the agent opens it before
 * its first buy of that coin: an idempotent opening the agent pays for, for the vault, of that coin under its program, at
 * the vault's own address of it. Null — no such opening of `receiver`.
 */
function opensCopyCoin(instructions: readonly TransactionInstruction[], mandate: Mandate, receiver: PublicKey): PublicKey | null {
  const coin = mandate.terms.copyCoins?.find((entry) => heldAccountOf(mandate.vault, entry).equals(receiver));
  if (!coin) return null;
  const opened = instructions.some((instruction) => {
    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM) || instruction.data.length !== 1 || instruction.data[0] !== 1) return false;
    const [payer, account, owner, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
    return Boolean(payer?.equals(mandate.terms.agent) && account?.equals(receiver) && owner?.equals(mandate.vault) && mint?.equals(coin.mint) && tokenProgram?.equals(coin.program));
  });
  return opened ? coin.mint : null;
}

/**
 * What a trade the bounds let through buys, and every account its instructions name; null when the message is not such a
 * trade. Read only after `tradeRefusal` passed it. What it buys is read off the receiving account the caller read — and,
 * for a sale whose money lands in her own account of the budget's token that the chain does not hold yet, off that
 * account's address, when the message itself opens it before the trade (her first sale; the copy's first
 * buy of a coin, into the vault's own account of it).
 */
export function tradeSides(message: Uint8Array, mandate: Mandate, request: AgentSignRequest): Readonly<{ bought: PublicKey; accounts: readonly PublicKey[] }> | null {
  try {
    const decoded = VersionedMessage.deserialize(message);
    const instructions = TransactionMessage.decompile(decoded, { addressLookupTableAccounts: [...(request.lookupTables ?? [])] }).instructions;
    const at = instructions.findIndex((instruction) => instruction.programId.equals(SSA_PROGRAM_ID));
    if (at < 0) return null;
    const execution = instructions[at]!;
    const view = readPolicyExecute({ programId: execution.programId, keys: execution.keys.map((key) => key.pubkey), data: execution.data });
    const trade = tradeTerms(view.instructions.at(-1)!);
    if (!trade) return null;
    const read = request.facts.get(trade.receiver.toBase58());
    const selling = Boolean(mandate.terms.heldCoin && mandate.salePolicy?.equals(view.policy)) || copySaleChunk(mandate, view.policy) !== null;
    let bought: PublicKey | null = null;
    if (read) bought = read.data.length >= 32 ? new PublicKey(read.data.subarray(0, 32)) : null;
    else if (selling && trade.receiver.equals(proceedsAccountOf(mandate.terms)) && opensProceeds(instructions.slice(0, at), mandate)) bought = mandate.terms.budgetMint;
    else if (!selling && mandate.terms.copyCoins) bought = opensCopyCoin(instructions.slice(0, at), mandate, trade.receiver); // A copy's first buy of a coin
    if (!bought) return null;
    const accounts = [...instructions.flatMap((instruction) => instruction.keys.map((key) => key.pubkey)), ...view.instructions.flatMap((inner) => inner.accounts)];
    return { bought, accounts };
  } catch {
    return null;
  }
}

/**
 * The mints of this trade's two sides that are stocks — found, each by its address, on the shelf of verified
 * companies, which the signer's own screen reads. The request names no stock and is not asked. A shelf not read, or a
 * screen with none, finds nothing: the strict rule's refusal then stands.
 */
export async function stockSides(message: Uint8Array, mandate: Mandate, request: AgentSignRequest, screen: AgentScreen): Promise<ReadonlySet<string>> {
  const shelf = screen.stock;
  if (!shelf) return NO_STOCK_SIDES;
  const bought = tradeSides(message, mandate, request)?.bought;
  const mints = new Set([...(bought ? [bought.toBase58()] : []), ...(mandate.terms.budgetCoin ? [mandate.terms.budgetMint.toBase58()] : []), ...(mandate.terms.heldCoin ? [mandate.terms.heldCoin.mint.toBase58()] : [])]);
  const found = new Set<string>();
  for (const mint of mints) if (await shelf(mint).catch(() => false)) found.add(mint);
  return found;
}

/** Why the trade buys a coin, or meets a key, Ryntra's agent never deals with; null when it does not. Throws when the screen is not read. */
export async function screenRefusal(message: Uint8Array, mandate: Mandate, request: AgentSignRequest, screen: AgentScreen): Promise<string | null> {
  const sides = tradeSides(message, mandate, request);
  if (!sides) return "the coin bought could not be read";
  const [origin, ryntra] = await Promise.all([screen.origin(sides.bought.toBase58()), screen.ryntra()]);
  return coinRefusal(sides.bought, origin, mandate, ryntra, request.facts) ?? ryntraAccountRefusal(sides.accounts, mandate, ryntra, request.facts, sides.bought);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/** The agent's key under the mandate's bounds, its check and its journal. */
export function mandateSigner(
  key: KeySigner,
  options: Readonly<{ mandate: Mandate; policy: ProgramInteractionPolicy; journal: AgentJournal; screen: AgentScreen; now?: () => Date }>,
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
      let refusal = tradeRefusal(message, mandate, options.policy, request);
      /* A coin the strict rule refused may be a stock: the signer asks the shelf itself, then judges the whole trade again. */
      if (refusal?.startsWith(COIN_REFUSED)) {
        const stocks = await stockSides(message, mandate, request, options.screen);
        if (stocks.size) refusal = tradeRefusal(message, mandate, options.policy, request, stocks);
      }
      if (!refusal) {
        try {
          refusal = await screenRefusal(message, mandate, request, options.screen);
        } catch (error) {
          refusal = `Ryntra's registry did not answer (${reasonOf(error)})`;
        }
      }
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
