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
import type { MandateGate, MandateNetwork, MandateRecord } from "./service.server.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, readPolicyHead, readSettings, ssaAddress, SSA_PROGRAM_ID } from "./ssa.ts";
import { planFrom, planText, STEADY, type Mark, type StrategyPlan } from "./plans.ts";
import { type AgentTrade, type PauseReason, type StrategyId } from "./strategy.ts";
import { exitText, TRADER_EXIT, type AgentEvent, type AgentSale, type ExitRules } from "./exit.ts";
import { agentFeeAccount, policyCarriesFee } from "./fee.ts";
import { heldAccountOf, proceedsAccountOf, type HeldCoin } from "./terms.ts";
import { isTokenProgram } from "./token-2022.ts";
import { storeScreen, type AgentScreen } from "./ryntra-coins.server.ts";
import { botOfPlan, type MoneyBot } from "../bots/money/gates.ts";

export const AGENT_BOOK = "agentMandates";

/** The trades a mandate keeps in the book: the newest ones — enough for a day's rhythm and the person's result. */
export const TRADES_KEPT = 200;

export type BookStatus = "working" | "stopped" | "ended" | "spent" | "paused";

/**
 * The entry's version. `1` — every budget's. `2` — a bot's that sells (`../bots/money/gates.ts` `botOfPlan`).
 */
export type BookVersion = 1 | 2;

export type BookEntry = Readonly<{
  v: BookVersion;
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
  /** The rules it leaves a trade by (`./exit.ts` `exitText`); absent — it does not sell on its own. */
  exit?: string;
  /** The sales it made on its own, the newest `TRADES_KEPT`. */
  sales?: readonly AgentSale[];
  /** What it did that she hears of at once, the newest `EVENTS_KEPT`. */
  events?: readonly AgentEvent[];
  /** Since when the price of what it holds stays unread, ms; absent — read last time. */
  exitUnreadSince?: number;
  /** Since when the sale its rules call for could not be built (the network, Jupiter's rate, the route), ms. */
  exitStuckSince?: number;
  /**
   * The grid's level whose sale the route last could not make pay its cost and the network's fees, and when —
   * that level is not built again before the next mark (`./tick.server.ts` `MARK_EVERY_MS`), and the buys go on meanwhile.
   */
  gridShort?: Readonly<{ level: number; at: number }>;
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

const RAW = /^\d{1,20}$/u;

/** The coin a record's agent keeps in the vault and its day's limit; null — none, or not a coin's address and a number. */
export function heldOfRecord(record: Pick<MandateRecord, "held" | "heldProgram" | "salePolicy" | "heldDaily">): HeldCoin | null {
  if (!record.held || !record.salePolicy || !record.heldDaily || !RAW.test(record.heldDaily)) return null;
  const mint = addressOf(record.held);
  const program = record.heldProgram === undefined ? TOKEN_PROGRAM_ID : addressOf(record.heldProgram);
  const dailyMax = BigInt(record.heldDaily);
  return mint && program && isTokenProgram(program) && addressOf(record.salePolicy) && dailyMax > 0n && dailyMax < 1n << 64n ? { mint, program, dailyMax } : null;
}

/** The mandate the entry stands for, as the agent's trade and signer read it: the pool on devnet, Jupiter on mainnet. */
export function mandateOf(entry: BookEntry, gate: OpenGate): Mandate {
  const r = entry.record;
  const held = heldOfRecord(r);
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
      ...(held ? { heldCoin: held } : {}),
    },
    settings: new PublicKey(r.settings),
    vault: new PublicKey(r.vault),
    policy: new PublicKey(r.policy),
    policySeed: 0n,
    budgetAccount: new PublicKey(r.budget),
    ...(held && r.salePolicy ? { salePolicy: new PublicKey(r.salePolicy) } : {}),
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
  if (record.salePolicy !== undefined || record.held !== undefined || record.heldProgram !== undefined || record.heldDaily !== undefined) return saleChainRefusal(record, gate, connection, { settings, vault, owner, buy: policyInfo.data });
  return null;
}

const carries = (data: Uint8Array, key: PublicKey) => Buffer.from(data).indexOf(key.toBuffer()) >= 0;

/**
 * Why the record's sale policy is not the agent's sale of the coin it keeps for her; null when it is: a policy
 * of the same account at the seed after the buy's, its one signer this agent, naming the vault's account of the coin, her
 * own account of the budget's token, Ryntra's fee account and the record's day's limit of the coin — and the buy's policy
 * lands the coin in that same vault account.
 */
async function saleChainRefusal(
  record: MandateRecord,
  gate: OpenGate,
  connection: Pick<Connection, "getAccountInfo">,
  read: Readonly<{ settings: PublicKey; vault: PublicKey; owner: PublicKey; buy: Uint8Array }>,
): Promise<string | null> {
  const held = heldOfRecord(record);
  const sale = addressOf(record.salePolicy ?? "");
  if (!held || !sale) return "not the coin the agent keeps";
  const info = await connection.getAccountInfo(sale, "confirmed");
  if (!info || !info.owner.equals(SSA_PROGRAM_ID)) return "no such sale on chain";
  let head;
  try {
    head = readPolicyHead(info.data);
  } catch {
    return "not a sale's policy";
  }
  if (!head.settings.equals(read.settings) || !ssaAddress.policy(read.settings, head.seed).equals(sale)) return "the sale is not this account's";
  /* Signed in the same approval: the sale stands at the seed after the buy's — where her stop finds it on chain. */
  if (head.seed < 2n || !ssaAddress.policy(read.settings, head.seed - 1n).equals(new PublicKey(record.policy))) return "the sale was not signed with this budget";
  if (head.signers.length !== 1 || !head.signers[0]!.key.equals(gate.agent)) return "the sale names another agent";
  const coinAccount = heldAccountOf(read.vault, held);
  const fee = gate.network === "mainnet" ? agentFeeAccount(NATIVE_MINT) : agentFeeAccount(held.mint);
  if (!carries(info.data, coinAccount) || !carries(info.data, proceedsAccountOf({ human: read.owner, budgetMint: NATIVE_MINT })) || !carries(info.data, fee)) return "the sale's rules are not the agent's";
  if (!carries(read.buy, coinAccount)) return "the buys do not keep the coin in the vault";
  if (!Buffer.from(info.data).includes(u64Bytes(held.dailyMax))) return "the day's limit of the coin is not the sale's";
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
  input: Readonly<{ record: MandateRecord; strategy: StrategyId; said: string | null; plan?: StrategyPlan | null; bornAt?: number | null; exit?: ExitRules | null }>,
  gate: OpenGate,
  deps: Readonly<{ store: GuardStore; connection: Pick<Connection, "getAccountInfo">; receiveMint: () => Promise<PublicKey>; screen?: AgentScreen; now?: () => number; exitOn?: boolean; botMoneyOn?: (bot: MoneyBot) => boolean }>,
): Promise<RegisterResult> {
  const now = (deps.now ?? Date.now)();
  /* A budget signed with the agent's own sale joins only where the deployment lets the agent sell (`RYNTRA_AGENT_EXIT`). */
  const selling = input.record.salePolicy !== undefined || input.record.held !== undefined || input.record.heldProgram !== undefined || input.record.heldDaily !== undefined;
  if ((selling || input.exit) && deps.exitOn !== true) return { ok: false, code: "REFUSED", reason: "The agent does not sell on its own here." };
  const plan = input.plan ?? STEADY;
  if (plan.id !== input.strategy) return { ok: false, code: "REFUSED", reason: "The strategy and its plan disagree." };
  if (plan.id === "early" && (input.bornAt === null || input.bornAt === undefined || !(input.bornAt <= now))) return { ok: false, code: "REFUSED", reason: "An early plan needs the launch it buys." };
  /*
   * A bot that sells — the grid's levels, a signal — joins only where the deployment opens its money
   * (`../bots/money/gates.ts`), and only with the coin kept in her vault to sell (the sale's policy, signed with the budget).
   */
  const bot = botOfPlan(plan);
  if (bot !== null && deps.botMoneyOn?.(bot) !== true) return { ok: false, code: "REFUSED", reason: bot === "grid" ? "The grid trades on paper here." : "Signals trade on paper here." };
  if (bot !== null && !selling) return { ok: false, code: "REFUSED", reason: "A bot that sells needs its budget signed with the sale." };
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
  /* A sale signed with the budget is the coin the agent buys, and its rules are the ones she saw before signing. */
  const held = heldOfRecord(input.record);
  if (held && !held.mint.equals(receive)) return { ok: false, code: "REFUSED", reason: "The coin the agent keeps is not the coin it buys." };
  if (input.exit && !held) return { ok: false, code: "REFUSED", reason: "The agent sells on its own only with a budget signed for it." };
  const entry: BookEntry = {
    /* A bot's entry is one a build of before cannot take for regular buys. */
    v: bot === null ? 1 : 2,
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
    ...(held ? { exit: exitText(input.exit ?? TRADER_EXIT), sales: [] } : {}),
    createdAt: now,
    updatedAt: now,
  };
  if (!(await book.insertIfAbsent(key, entry))) {
    const raced = (await book.get(key)) as BookEntry | undefined;
    return raced && "record" in raced ? { ok: true, entry: raced } : { ok: false, code: "UNAVAILABLE", reason: "The book did not keep it." };
  }
  return { ok: true, entry };
}

/** Whether a row of the book is a mandate's entry this build reads: every version it knows (`BookVersion`). */
export const isBookEntry = (row: BookEntry | Readonly<{ claimedAt: number }> | null | undefined): row is BookEntry => Boolean(row && "record" in row && (row.v === 1 || row.v === 2));

/** Every mandate in the book on this network. */
export async function readBook(store: GuardStore, cluster = "devnet"): Promise<readonly BookEntry[]> {
  const rows = await bookOf(store).valuesWithPrefix(`m:${cluster}:`);
  return rows.filter(isBookEntry);
}

export async function readEntry(store: GuardStore, policy: string, cluster = "devnet"): Promise<BookEntry | null> {
  const row = await bookOf(store).get(entryKey(cluster, policy));
  return isBookEntry(row) ? row : null;
}

export async function writeEntry(store: GuardStore, entry: BookEntry): Promise<void> {
  await bookOf(store).set(entryKey(entry.cluster, entry.record.policy), entry);
}

/** The strategy the entry trades by: its plan, or the steady one. */
export function planOfEntry(entry: Pick<BookEntry, "plan" | "strategy">): StrategyPlan {
  const plan = entry.plan === undefined ? null : planFrom(entry.plan);
  return plan && plan.id === entry.strategy ? plan : STEADY;
}

/**
 * The coin's day limit the server itself read for a budget with the agent's own sale (`./terms.ts`
 * `heldDailyMax`, at the venue's quote, when it built her transactions — `./service.server.ts` `reviewEnable`): kept
 * beside the book under the policy and the figure, so the mandate joins only with the figure Ryntra read, never one a
 * request names. The chain holds the real limit either way; this keeps the agent's own count of it (`./exit.ts`
 * `saleRoom`) the same number.
 */
export const heldTicketKey = (cluster: string, policy: string, heldDaily: string) => `h:${cluster}:${policy}:${heldDaily}`;

/** Keep the figure the server read for this policy. */
export async function rememberHeldDaily(store: GuardStore, cluster: string, ticket: Readonly<{ policy: string; heldDaily: string }>, now: number = Date.now()): Promise<void> {
  await bookOf(store).set(heldTicketKey(cluster, ticket.policy, ticket.heldDaily), { claimedAt: now });
}

/** Whether the server read this very figure for this policy. */
export async function heldDailyKnown(store: GuardStore, cluster: string, record: Pick<MandateRecord, "policy" | "heldDaily">): Promise<boolean> {
  if (!record.heldDaily || !RAW.test(record.heldDaily)) return false;
  return Boolean(await bookOf(store).get(heldTicketKey(cluster, record.policy, record.heldDaily)));
}

/** The entry with one more trade, the oldest past the book's length let go. */
export function withTrade(entry: BookEntry, trade: AgentTrade, now: number): BookEntry {
  return { ...entry, trades: [...entry.trades, trade].slice(-TRADES_KEPT), updatedAt: now };
}
