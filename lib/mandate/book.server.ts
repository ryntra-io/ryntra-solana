/**
 * The agent's book: the mandates it works for, each with the strategy the person chose and the trades the
 * agent made. Kept in the Guard store's `agentMandates` (a value in the same column; no DDL), keyed
 * `m:<cluster>:<policy>`. Public data only: addresses, numbers, signatures, the person's own words — never a key.
 *
 * A mandate joins the book only as the chain has it: the policy exists under the smart account program, its one signer
 * is this agent, the person is the account's settings signer, and the vault and the budget's account are the ones the
 * program derives. Its numbers are the policy's own: the day's cap and the trade's the person signed stand in
 * the policy on chain, so the agent never trades by numbers she did not sign — any numbers, no ceiling of Ryntra's. And
 * its coin is no coin of Ryntra's launchpad and none of the person's own (`./ryntra-coins.server.ts`) — the
 * signer asks the same again before every trade.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import type { GuardCollection, GuardStore } from "../guard/store.ts";
import type { Mandate } from "./human.ts";
import { tokenAccountOf } from "./human.ts";
import { BUDGET_PRESETS, type BudgetPresetId } from "./presets.ts";
import { agentNetworkOf, budgetFund, budgetRefusal, DAYS_MAX, termOf, type AgentBudget } from "./budget.ts";
import { policyCarriesFee } from "./fee.ts";
import type { MandateGate, MandateNetwork, MandateRecord } from "./service.server.ts";
import { NATIVE_MINT, readPolicyHead, readSettings, ssaAddress, SSA_PROGRAM_ID } from "./ssa.ts";
import { planFrom, planText, STEADY, type Mark, type StrategyPlan } from "./plans.ts";
import { type AgentTrade, type PauseReason, type StrategyId } from "./strategy.ts";
import { storeScreen, type AgentScreen } from "./ryntra-coins.server.ts";

export const AGENT_BOOK = "agentMandates";

/** The trades a mandate keeps in the book: the newest ones — enough for a day's rhythm and the person's result. */
export const TRADES_KEPT = 200;

export type BookStatus = "working" | "stopped" | "ended" | "spent" | "paused";

export type BookEntry = Readonly<{
  v: 1;
  cluster: MandateNetwork;
  record: MandateRecord;
  preset?: BudgetPresetId;
  /** What the signature moved into her vault, and gave the agent for its network fees, lamports. */
  fundRaw?: string;
  networkRaw?: string;
  strategy: StrategyId;
  /** The strategy with its numbers (`./plans.ts` `planText`); absent on an entry of before — the steady one. */
  plan?: string;
  /** The prices the agent saw for a dip or a grid, oldest first, the last day's. */
  marks?: readonly Mark[];
  /** A grid's first price: its levels stand under it. */
  anchor?: number;
  /** An early plan's launch: when the coin was born, ms. */
  bornAt?: number;
  /** The person's sentence, when the agent was asked in words (≤ 140 characters). */
  said: string | null;
  /** The coin the agent buys for the person. */
  receiveMint: string;
  status: BookStatus;
  /** Why it paused itself, when `status` is `paused`. */
  pausedBy?: PauseReason;
  /** Since when a figure it needs to buy stays unread, ms; absent when all were read last time. */
  unreadSince?: number;
  trades: readonly AgentTrade[];
  createdAt: number;
  updatedAt: number;
}>;

export type OpenGate = Extract<MandateGate, { open: true }>;

export const entryKey = (cluster: string, policy: string) => `m:${cluster}:${policy}`;
export const claimKey = (cluster: string, policy: string, slot: number) => `c:${cluster}:${policy}:${slot}`;

export const bookOf = (store: GuardStore): GuardCollection<BookEntry | Readonly<{ claimedAt: number }>> => store.collection(AGENT_BOOK);

const addressOf = (value: string): PublicKey | null => {
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value ? key : null;
  } catch {
    return null;
  }
};

/** The mandate the entry stands for, as the agent's trade and signer read it: the pool on devnet, Jupiter on mainnet. */
export function mandateOf(entry: BookEntry, gate: OpenGate): Mandate {
  const r = entry.record;
  return {
    cluster: gate.network,
    terms: {
      human: new PublicKey(r.owner),
      agent: gate.agent,
      budgetMint: NATIVE_MINT,
      perTrade: BigInt(r.perTrade),
      perDay: BigInt(r.perDay),
      slippageBps: 100,
      expiresAt: BigInt(r.expiresAt),
      venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
    },
    settings: new PublicKey(r.settings),
    vault: new PublicKey(r.vault),
    policy: new PublicKey(r.policy),
    policySeed: 0n,
    budgetAccount: new PublicKey(r.budget),
  };
}

export type RegisterResult = Readonly<{ ok: true; entry: BookEntry }> | Readonly<{ ok: false; code: string; reason: string }>;

/** Why the record is not a mandate this agent works for, read from the chain; null when it is. */
export async function chainRefusal(record: MandateRecord, gate: OpenGate, connection: Pick<Connection, "getAccountInfo">): Promise<string | null> {
  const owner = addressOf(record.owner);
  const settings = addressOf(record.settings);
  const policy = addressOf(record.policy);
  if (!owner || !settings || !policy || !addressOf(record.vault) || !addressOf(record.budget)) return "not addresses";
  const [policyInfo, settingsInfo] = await Promise.all([connection.getAccountInfo(policy, "confirmed"), connection.getAccountInfo(settings, "confirmed")]);
  if (!policyInfo || !policyInfo.owner.equals(SSA_PROGRAM_ID)) return "no such mandate on chain";
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID)) return "no such smart account";
  let head;
  let state;
  try {
    head = readPolicyHead(policyInfo.data);
    state = readSettings(settingsInfo.data);
  } catch {
    return "not a mandate";
  }
  if (!head.settings.equals(settings) || !ssaAddress.policy(settings, head.seed).equals(policy)) return "the mandate is not this account's";
  if (head.signers.length !== 1 || !head.signers[0]!.key.equals(gate.agent)) return "the mandate names another agent";
  if (!policyCarriesFee(policyInfo.data, NATIVE_MINT)) return "the mandate was signed before Ryntra's fee";
  const caps = budgetOfRecord(record, 0);
  if (!caps || !policyCarriesCaps(policyInfo.data, caps)) return "the numbers are not the policy's";
  if (!state.signers.some((signer) => signer.key.equals(owner))) return "not the person's smart account";
  const vault = ssaAddress.vault(settings, 0);
  if (vault.toBase58() !== record.vault || tokenAccountOf(vault, NATIVE_MINT).toBase58() !== record.budget) return "not the account's vault";
  return null;
}

/** A u64 as the policy's bytes hold it, little-endian. */
const u64Bytes = (value: bigint): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};

/**
 * Whether the policy's bytes carry the record's caps: the day's in its spending limit, the trade's in its amount rules
 * (`./terms.ts` `mandatePolicy`). A record whose numbers the policy does not hold is not the person's signature.
 */
export function policyCarriesCaps(policyData: Uint8Array, caps: Readonly<{ perTrade: bigint; perDay: bigint }>): boolean {
  const data = Buffer.from(policyData);
  return data.indexOf(u64Bytes(caps.perDay)) >= 0 && data.indexOf(u64Bytes(caps.perTrade)) >= 0;
}

/** The budget a record stands for, its term read back from its end. */
export function budgetOfRecord(record: Pick<MandateRecord, "perTrade" | "perDay" | "expiresAt">, nowMs: number): AgentBudget | null {
  if (![record.perTrade, record.perDay, record.expiresAt].every((value) => typeof value === "string" && /^\d{1,20}$/u.test(value))) return null;
  return { perDay: BigInt(record.perDay), perTrade: BigInt(record.perTrade), days: termOf(BigInt(record.expiresAt), nowMs) };
}

/** What the mandate moved into her vault: the entry's own figure, or — an entry of before — its preset's. */
export const fundOf = (entry: Pick<BookEntry, "preset" | "fundRaw">): bigint => (entry.fundRaw !== undefined ? BigInt(entry.fundRaw) : entry.preset ? (BUDGET_PRESETS[entry.preset]?.budget ?? 0n) : 0n);

/** What she gave the agent for its network fees with the mandate, the same way. */
export const networkOf = (entry: Pick<BookEntry, "preset" | "networkRaw">): bigint => (entry.networkRaw !== undefined ? BigInt(entry.networkRaw) : entry.preset ? (BUDGET_PRESETS[entry.preset]?.agentFee ?? 0n) : 0n);

/**
 * Put a mandate in the agent's book: checked on chain, its numbers the policy's own and a budget the agent takes, its end
 * in the future. A mandate already in the book stays as it is — the strategy is the one it joined with.
 */
export async function registerMandate(
  input: Readonly<{ record: MandateRecord; strategy: StrategyId; said: string | null; plan?: StrategyPlan | null; bornAt?: number | null }>,
  gate: OpenGate,
  deps: Readonly<{ store: GuardStore; connection: Pick<Connection, "getAccountInfo">; receiveMint: () => Promise<PublicKey>; screen?: AgentScreen; now?: () => number }>,
): Promise<RegisterResult> {
  const now = (deps.now ?? Date.now)();
  const plan = input.plan ?? STEADY;
  if (plan.id !== input.strategy) return { ok: false, code: "REFUSED", reason: "The strategy and its plan disagree." };
  if (plan.id === "early" && (input.bornAt === null || input.bornAt === undefined || !(input.bornAt <= now))) return { ok: false, code: "REFUSED", reason: "An early plan needs the launch it buys." };
  /* Any budget the person signed — the agent's own bounds only (`./budget.ts`), no ceiling of Ryntra's. */
  const budget = budgetOfRecord(input.record, now);
  const wrong = budget ? budgetRefusal(budget) : "not numbers";
  if (!budget || wrong) return { ok: false, code: "REFUSED", reason: `The numbers are not a budget the agent takes: ${wrong}.` };
  const ends = Number(input.record.expiresAt) * 1000;
  if (!(ends > now) || ends - now > (DAYS_MAX + 1) * 86_400_000) return { ok: false, code: "REFUSED", reason: "The mandate's end is not one the agent takes." };
  const refusal = await chainRefusal(input.record, gate, deps.connection);
  if (refusal) return { ok: false, code: "REFUSED", reason: `Not a mandate for this agent: ${refusal}.` };
  const book = bookOf(deps.store);
  const key = entryKey(gate.network, input.record.policy);
  const known = (await book.get(key)) as BookEntry | undefined;
  if (known && "record" in known) return { ok: true, entry: known };
  let receive: PublicKey;
  try {
    receive = await deps.receiveMint();
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The coin the agent buys is not readable." };
  }
  /* Ryntra's agent buys no coin of Ryntra's launchpad, and none the person launched. */
  const origin = await (deps.screen ?? storeScreen(deps.store, gate.network)).origin(receive.toBase58()).catch(() => null);
  if (!origin) return { ok: false, code: "UNAVAILABLE", reason: "Ryntra's launch registry is not readable." };
  if (origin.launchedHere) return { ok: false, code: "REFUSED", reason: origin.creator === input.record.owner ? "The agent does not buy your own coin." : "The agent does not buy coins launched on Ryntra." };
  const entry: BookEntry = {
    v: 1,
    cluster: gate.network,
    record: input.record,
    /* What her numbers put in the vault — never the vault total: another mandate of hers may share the vault. */
    fundRaw: budgetFund(budget).toString(),
    networkRaw: agentNetworkOf(budget).toString(),
    strategy: input.strategy,
    plan: planText(plan),
    ...(plan.id === "early" && input.bornAt ? { bornAt: input.bornAt } : {}),
    said: input.said ? input.said.slice(0, 140) : null,
    receiveMint: receive.toBase58(),
    status: "working",
    trades: [],
    createdAt: now,
    updatedAt: now,
  };
  if (!(await book.insertIfAbsent(key, entry))) {
    const raced = (await book.get(key)) as BookEntry | undefined;
    return raced && "record" in raced ? { ok: true, entry: raced } : { ok: false, code: "UNAVAILABLE", reason: "The book did not keep it." };
  }
  return { ok: true, entry };
}

/** Every mandate in the book on this network. */
export async function readBook(store: GuardStore, cluster = "devnet"): Promise<readonly BookEntry[]> {
  const rows = await bookOf(store).valuesWithPrefix(`m:${cluster}:`);
  return rows.filter((row): row is BookEntry => "record" in row && row.v === 1);
}

export async function readEntry(store: GuardStore, policy: string, cluster = "devnet"): Promise<BookEntry | null> {
  const row = await bookOf(store).get(entryKey(cluster, policy));
  return row && "record" in row ? row : null;
}

export async function writeEntry(store: GuardStore, entry: BookEntry): Promise<void> {
  await bookOf(store).set(entryKey(entry.cluster, entry.record.policy), entry);
}

/** The strategy the entry trades by: its plan, or the steady one. */
export function planOfEntry(entry: Pick<BookEntry, "plan" | "strategy">): StrategyPlan {
  const plan = entry.plan === undefined ? null : planFrom(entry.plan);
  return plan && plan.id === entry.strategy ? plan : STEADY;
}

/** The entry with one more trade, the oldest past the book's length let go. */
export function withTrade(entry: BookEntry, trade: AgentTrade, now: number): BookEntry {
  return { ...entry, trades: [...entry.trades, trade].slice(-TRADES_KEPT), updatedAt: now };
}
