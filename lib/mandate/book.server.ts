/**
 * CITY-175 — the agent's book: the mandates it works for, each with the strategy the person chose and the trades the
 * agent made. Kept in the Guard store's `agentMandates` (a value in the same column; no DDL), keyed
 * `m:<cluster>:<policy>`. Public data only: addresses, numbers, signatures, the person's own words — never a key.
 *
 * A mandate joins the book only as the chain has it: the policy exists under the smart account program, its one signer
 * is this agent, the person is the account's settings signer, and the vault and the budget's account are the ones the
 * program derives. Its numbers are one of the city's presets, so the agent never trades by numbers the person did not
 * choose; the chain holds the very same caps again.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import type { GuardCollection, GuardStore } from "../guard/store.ts";
import type { Mandate } from "./human.ts";
import { tokenAccountOf } from "./human.ts";
import { BUDGET_PRESETS, presetOpenOn, type BudgetPresetId } from "./presets.ts";
import { policyCarriesFee } from "./fee.ts";
import type { MandateGate, MandateNetwork, MandateRecord } from "./service.server.ts";
import { NATIVE_MINT, readPolicyHead, readSettings, ssaAddress, SSA_PROGRAM_ID } from "./ssa.ts";
import { STARTER_CAPS } from "./terms.ts";
import { planFrom, planText, STEADY, type Mark, type StrategyPlan } from "./plans.ts";
import { type AgentTrade, type PauseReason, type StrategyId } from "./strategy.ts";

export const AGENT_BOOK = "agentMandates";

/** The trades a mandate keeps in the book: the newest ones — enough for a day's rhythm and the person's result. */
export const TRADES_KEPT = 200;

export type BookStatus = "working" | "stopped" | "ended" | "spent" | "paused";

export type BookEntry = Readonly<{
  v: 1;
  cluster: MandateNetwork;
  record: MandateRecord;
  preset: BudgetPresetId;
  strategy: StrategyId;
  /** CITY-193: the strategy with its numbers (`./plans.ts` `planText`); absent on an entry of before — the steady one. */
  plan?: string;
  /** The prices the agent saw for a dip or a grid, oldest first, the last day's (CITY-193). */
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
  if (!state.signers.some((signer) => signer.key.equals(owner))) return "not the person's smart account";
  const vault = ssaAddress.vault(settings, 0);
  if (vault.toBase58() !== record.vault || tokenAccountOf(vault, NATIVE_MINT).toBase58() !== record.budget) return "not the account's vault";
  return null;
}

/** The preset whose numbers the record carries; null — numbers the city never offers. */
export function presetOf(record: Pick<MandateRecord, "perTrade" | "perDay">): BudgetPresetId | null {
  const found = Object.values(BUDGET_PRESETS).find((preset) => preset.perTrade.toString() === record.perTrade && preset.perDay.toString() === record.perDay);
  return found?.id ?? null;
}

/**
 * Put a mandate in the agent's book: checked on chain, its numbers a preset's, its end within a new agent's length.
 * A mandate already in the book stays as it is — the strategy is the one it joined with.
 */
export async function registerMandate(
  input: Readonly<{ record: MandateRecord; strategy: StrategyId; said: string | null; plan?: StrategyPlan | null; bornAt?: number | null }>,
  gate: OpenGate,
  deps: Readonly<{ store: GuardStore; connection: Pick<Connection, "getAccountInfo">; receiveMint: () => Promise<PublicKey>; now?: () => number }>,
): Promise<RegisterResult> {
  const now = (deps.now ?? Date.now)();
  const plan = input.plan ?? STEADY;
  if (plan.id !== input.strategy) return { ok: false, code: "REFUSED", reason: "The strategy and its plan disagree." };
  if (plan.id === "early" && (input.bornAt === null || input.bornAt === undefined || !(input.bornAt <= now))) return { ok: false, code: "REFUSED", reason: "An early plan needs the launch it buys." };
  const preset = presetOf(input.record);
  if (!preset) return { ok: false, code: "REFUSED", reason: "The numbers are not a budget the city offers." };
  /* Mainnet takes only its own budgets: a larger mandate signed elsewhere is not the agent's. */
  if (!presetOpenOn(gate.network, preset)) return { ok: false, code: "REFUSED", reason: `The budget is not one ${gate.network} offers.` };
  const ends = Number(input.record.expiresAt) * 1000;
  if (!(ends > now) || ends - now > (STARTER_CAPS.SOL.days + 1) * 86_400_000) return { ok: false, code: "REFUSED", reason: "The mandate's end is not a new agent's." };
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
  const entry: BookEntry = {
    v: 1,
    cluster: gate.network,
    record: input.record,
    preset,
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

/** The strategy the entry trades by: its plan, or — an entry of before CITY-193, or one not read — the steady one. */
export function planOfEntry(entry: Pick<BookEntry, "plan" | "strategy">): StrategyPlan {
  const plan = entry.plan === undefined ? null : planFrom(entry.plan);
  return plan && plan.id === entry.strategy ? plan : STEADY;
}

/** The entry with one more trade, the oldest past the book's length let go. */
export function withTrade(entry: BookEntry, trade: AgentTrade, now: number): BookEntry {
  return { ...entry, trades: [...entry.trades, trade].slice(-TRADES_KEPT), updatedAt: now };
}
