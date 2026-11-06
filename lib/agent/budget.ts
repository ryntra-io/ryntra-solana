/**
 * The agent's budget — durable, per wallet, metered in the Guard store: an
 * allowance per wallet and a usage receipt for every model call.
 *
 * What is counted is a question that reaches the model. A deterministic
 * answer costs nothing and is never refused for budget. The counters are one
 * versioned record per (wallet, day), per (wallet, month), per (deployment,
 * day) and per (deployment, month), advanced by compare-and-set so two
 * instances answering one wallet count one call each and never lose one; the
 * in-flight lease is a versioned record per wallet holding the leases with
 * their expiry, so a second question while one is being answered is refused
 * `AGENT_BUSY` rather than run twice. A reservation is taken before the call
 * and refunded when the provider was never reached; a receipt is written
 * after it with the model, the tokens where the provider stated them, the
 * latency and the outcome — never the words.
 *
 * AI-02: every receipt also prices its call (schema 1.1.0) — the task and
 * its class, cached input and reasoning beside the tokens, and the cost in
 * micro-dollars from the provider's own usage (`lib/assistant/models.ts`),
 * `null` for a model with no price, never zero. A guest — a person asking
 * without a wallet — is metered on the same store by a digest of the
 * address the request came from, never the address: a small allowance per
 * guest per day, a guests' ceiling that is at most half the deployment's,
 * and the deployment's own ceilings over both.
 *
 * AI-04: a question that reaches the model is paid in credits — the day's
 * free ones first, then the welcome and bought ones, only at the price the
 * person was shown (`lib/assistant/credits`). The credits are held under the
 * same lease as the call, captured when the provider was reached and given
 * back when it was not. The per-wallet call counters stay as a safety cap
 * against a runaway client, set far above what credits allow; the
 * deployment's ceilings stay as they were.
 *
 * Never a process-local counter: the Strategy Lab's `StrategyAiBudgetController`
 * coordinates one warm instance and is not this.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { BASE58, type AgentBudgetState } from "../api/v1/contract.ts";
import { readCredits, reserveCredits, settleCredits, type ReserveRefusal } from "../assistant/credits/ledger.ts";
import { CREDIT_ACTIONS, priceOf, type CreditAction, type CreditsConfig } from "../assistant/credits/prices.ts";
import { assistantProviderOf, costMicroUsd, MODEL_TASKS, modelFor, providerKeyed, TASK_CLASS, type CallUsage, type ModelTask, type ServiceTier } from "../assistant/models.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

const BUDGET = "agentBudget" as const;
const RECEIPTS = "agentReceipts" as const;

export type AgentBudgetConfig = Readonly<{
  /** Questions that reach the model, per wallet per UTC day. */
  dailyCalls: number;
  /** Per wallet per UTC month. */
  monthlyCalls: number;
  /** Questions being answered at once, per wallet. */
  inFlight: number;
  /** The deployment's own ceilings — one provider key serves every wallet. */
  globalDailyCalls: number;
  globalMonthlyCalls: number;
  /** How long an in-flight lease lives when the answer never settled (a crashed instance). */
  leaseMs: number;
  /** Whether a model is configured to be called at all — an explicit switch plus the key. */
  modelEnabled: boolean;
  /** AI-02: questions of one guest (no wallet; a digest of the request's address) that reach the model, per UTC day. */
  guestDailyCalls: number;
  /** AI-02: every guest together, per UTC day — never above half the deployment's daily ceiling. */
  guestGlobalDailyCalls: number;
  /** AI-19: all «Доручення» of every wallet together a day — never more than half the deployment's day, so people's own questions keep the rest. */
  tasksGlobalDailyCalls: number;
}>;

export const AGENT_BUDGET_ENV = {
  daily: "RYNTRA_AGENT_DAILY_CALLS",
  monthly: "RYNTRA_AGENT_MONTHLY_CALLS",
  inFlight: "RYNTRA_AGENT_IN_FLIGHT",
  globalDaily: "RYNTRA_AGENT_GLOBAL_DAILY_CALLS",
  globalMonthly: "RYNTRA_AGENT_GLOBAL_MONTHLY_CALLS",
  /** `1` switches the model on; absent, every answer is deterministic and nothing is spent. An explicit choice, never a default. */
  modelEnabled: "RYNTRA_AGENT_MODEL_ENABLED",
  guestDaily: "RYNTRA_ASSISTANT_GUEST_DAILY_CALLS",
  guestGlobalDaily: "RYNTRA_ASSISTANT_GUEST_GLOBAL_DAILY_CALLS",
  tasksGlobalDaily: "RYNTRA_ASSISTANT_TASKS_GLOBAL_DAILY_CALLS",
} as const;

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export function resolveAgentBudgetConfig(env: Readonly<Record<string, string | undefined>> = process.env): AgentBudgetConfig {
  const globalDailyCalls = positive(env[AGENT_BUDGET_ENV.globalDaily], 300);
  return {
    /* AI-04: credits are the meter; the call counters are a safety cap well above a day of credits. */
    dailyCalls: positive(env[AGENT_BUDGET_ENV.daily], 200),
    monthlyCalls: positive(env[AGENT_BUDGET_ENV.monthly], 3000),
    inFlight: positive(env[AGENT_BUDGET_ENV.inFlight], 1),
    globalDailyCalls,
    globalMonthlyCalls: positive(env[AGENT_BUDGET_ENV.globalMonthly], 3000),
    leaseMs: 90_000,
    /* CITY-205: the key of the provider the assistant answers with (OpenAI unless another is named and keyed). */
    modelEnabled: env[AGENT_BUDGET_ENV.modelEnabled]?.trim() === "1" && providerKeyed(assistantProviderOf(env), env),
    guestDailyCalls: positive(env[AGENT_BUDGET_ENV.guestDaily], 5),
    guestGlobalDailyCalls: Math.max(1, Math.min(positive(env[AGENT_BUDGET_ENV.guestGlobalDaily], 100), Math.floor(globalDailyCalls / 2))),
    /* `0` switches every task off; absent or not a number — 300. */
    tasksGlobalDailyCalls: Math.max(0, Math.min(Number(env[AGENT_BUDGET_ENV.tasksGlobalDaily]?.trim() || "x") === 0 ? 0 : positive(env[AGENT_BUDGET_ENV.tasksGlobalDaily], 300), Math.floor(globalDailyCalls / 2))),
  };
}

/* ------------------------------------------------------------ records */

const CounterSchema = z.object({ version: z.number().int().min(1), key: z.string().min(1), count: z.number().int().min(0), updatedAt: z.string().datetime({ offset: true }) }).strict();
type Counter = z.output<typeof CounterSchema>;

const LeasesSchema = z.object({ version: z.number().int().min(1), owner: z.string().regex(BASE58), leases: z.array(z.object({ id: z.string().min(8).max(64), expiresAt: z.string().datetime({ offset: true }) }).strict()).max(16), updatedAt: z.string().datetime({ offset: true }) }).strict();
type Leases = z.output<typeof LeasesSchema>;

/** A guest is metered by a digest of the request's address, never the address (`lib/assistant/guest.ts`). */
export const GUEST_KEY = /^guest_[0-9a-f]{32}$/;
/** AI-09: the platform's own calls — the news labelled for everyone — are paid by `system_<job>`, no wallet and no guest. */
export const SYSTEM_PAYER = /^system_[a-z]{2,16}$/;
const Payer = z.union([z.string().regex(BASE58), z.string().regex(GUEST_KEY), z.string().regex(SYSTEM_PAYER)]);
const Outcome = z.enum(["ok", "refused", "invalid-output", "timeout", "rate-limited", "quota", "unavailable"]);

const ReceiptV1 = z
  .object({
    schema: z.literal("ryntra.agent-receipt"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    id: z.string().regex(/^agr_[0-9a-f]{24}$/),
    owner: z.string().regex(BASE58),
    sessionId: z.string().min(8).max(64),
    turnId: z.string().min(8).max(64),
    model: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(32),
    /** Which call of the exchange: the intent read or the answer composed. */
    phase: z.enum(["intent", "answer"]),
    tokens: z.object({ input: z.number().int().min(0), output: z.number().int().min(0), total: z.number().int().min(0) }).strict(),
    latencyMs: z.number().int().min(0),
    outcome: Outcome,
    at: z.string().datetime({ offset: true }),
  })
  .strict();

/** AI-02: the call priced — its task and class, cached input and reasoning, micro-dollars from the provider's usage. */
const ReceiptV11 = z
  .object({
    schema: z.literal("ryntra.agent-receipt"),
    schemaVersion: z.literal("1.1.0"),
    version: z.number().int().min(1),
    id: z.string().regex(/^agr_[0-9a-f]{24}$/),
    owner: Payer,
    sessionId: z.string().min(8).max(64),
    turnId: z.string().min(8).max(64),
    model: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(32),
    task: z.enum(MODEL_TASKS),
    modelClass: z.enum(["L1", "L2"]),
    tokens: z.object({ input: z.number().int().min(0), cached: z.number().int().min(0), output: z.number().int().min(0), reasoning: z.number().int().min(0), total: z.number().int().min(0) }).strict(),
    /** Micro-dollars (1e-6 USD), rounded up; null when the model has no price in the table — unpriced, never free. */
    costMicroUsd: z.number().int().min(0).nullable(),
    /** AI-10: the tier the provider said it served — `flex` is priced at its own (half) rates; absent on a Standard call written before it. */
    serviceTier: z.enum(["default", "flex"]).optional(),
    latencyMs: z.number().int().min(0),
    outcome: Outcome,
    at: z.string().datetime({ offset: true }),
  })
  .strict();

export const AgentReceiptSchema = z.union([ReceiptV11, ReceiptV1]);
export type AgentReceipt = z.output<typeof AgentReceiptSchema>;
export type PricedReceipt = z.output<typeof ReceiptV11>;

export const dayOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);
export const monthOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 7);
const nextDayMs = (nowMs: number): number => Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate() + 1);
const nextMonthMs = (nowMs: number): number => Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth() + 1, 1);

export const walletDayKey = (owner: string, nowMs: number): string => `solana:mainnet:${owner}:day:${dayOf(nowMs)}`;
export const walletMonthKey = (owner: string, nowMs: number): string => `solana:mainnet:${owner}:month:${monthOf(nowMs)}`;
export const walletLeaseKey = (owner: string): string => `solana:mainnet:${owner}:inflight`;
export const globalDayKey = (nowMs: number): string => `global:day:${dayOf(nowMs)}`;
export const globalMonthKey = (nowMs: number): string => `global:month:${monthOf(nowMs)}`;

function counters(store: GuardStore) {
  return store.versioned<Counter>(BUDGET);
}
function leases(store: GuardStore) {
  return store.versioned<Leases>(BUDGET);
}
function receipts(store: GuardStore) {
  return store.versioned<AgentReceipt>(RECEIPTS);
}

async function readCount(store: GuardStore, key: string): Promise<number> {
  const raw = await counters(store).get(key);
  const parsed = CounterSchema.safeParse(raw);
  return parsed.success ? parsed.data.count : 0;
}

/** Advance one counter by `delta` (never below zero), with bounded compare-and-set retries. */
async function advance(store: GuardStore, key: string, delta: number, nowMs: number): Promise<number> {
  return withBoundedCasRetry(async () => {
    const raw = await counters(store).get(key);
    const parsed = CounterSchema.safeParse(raw);
    const current = parsed.success ? parsed.data : null;
    const count = Math.max(0, (current?.count ?? 0) + delta);
    const next: Counter = { version: (current?.version ?? 0) + 1, key, count, updatedAt: new Date(nowMs).toISOString() };
    const written = await counters(store).compareAndSet(key, current?.version ?? null, next);
    return written ? count : false;
  });
}

/* ------------------------------------------------------------ the state */

/** AI-04: whose credits a wallet spends and on what terms — the holder resolved for this request (`lib/assistant/credits/holder.ts`). */
export type CreditsContext = Readonly<{ holder: string; config: CreditsConfig }>;

/** One model call's price: the action, what the person was shown (`null` — nothing; only free credits may go) and the call's own key. */
export type CreditCharge = Readonly<{ context: CreditsContext; action: CreditAction; acceptCredits: number | null; idem: string }>;

const CREDIT_REASONS: Readonly<Record<Exclude<ReserveRefusal, "UNAVAILABLE">, string>> = {
  PRICE_NOT_SHOWN: "Today's free credits are spent; the price was not shown for this question.",
  CREDITS_EXHAUSTED: "Today's free credits are spent and the balance holds fewer credits than this question costs.",
  CREDITS_LIMIT: "The day's limit of credits is reached; it starts again tomorrow (UTC).",
  CREDITS_BUSY: "Too many questions are being answered at once.",
};

/** The credits as the contract carries them (1.52.0). */
export async function readAgentCredits(store: GuardStore, context: CreditsContext, nowMs: number): Promise<NonNullable<AgentBudgetState["credits"]>> {
  const view = await readCredits(store, context.holder, context.config, nowMs);
  const prices = Object.fromEntries(CREDIT_ACTIONS.map((action) => [action, priceOf(context.config, action)])) as Record<CreditAction, number>;
  return {
    unit: "credits",
    balance: view.bonus + view.paid,
    welcome: view.bonus,
    bought: view.paid,
    free: view.free,
    reserved: view.reserved,
    dailySpend: view.dailySpend,
    prices,
    welcomeOffer: view.welcome ? "taken" : "open",
    holder: context.holder.startsWith("account:") ? "account" : "wallet",
  };
}

export async function readBudgetState(store: GuardStore, owner: string, config: AgentBudgetConfig, nowMs: number, credits: CreditsContext | null = null): Promise<AgentBudgetState> {
  /* Read in sequence, not at once: a stand's single-connection store answers one query at a time, and five reads cost nothing worth racing. */
  const day = await readCount(store, walletDayKey(owner, nowMs));
  const month = await readCount(store, walletMonthKey(owner, nowMs));
  const globalDay = await readCount(store, globalDayKey(nowMs));
  const globalMonth = await readCount(store, globalMonthKey(nowMs));
  const leaseRow = await leases(store).get(walletLeaseKey(owner));
  const lease = LeasesSchema.safeParse(leaseRow);
  const live = lease.success ? lease.data.leases.filter((entry) => Date.parse(entry.expiresAt) > nowMs).length : 0;
  let reason = refusalReason({ day, month, globalDay, globalMonth, inFlight: live }, config, nowMs);
  const wallet = credits ? await readAgentCredits(store, credits, nowMs).catch(() => null) : null;
  if (wallet && reason === null) {
    const price = wallet.prices.question;
    const fromBalance = Math.max(0, price - wallet.free.left);
    if (fromBalance > wallet.balance) reason = CREDIT_REASONS.CREDITS_EXHAUSTED;
    else if (wallet.dailySpend.used + fromBalance > wallet.dailySpend.cap) reason = CREDIT_REASONS.CREDITS_LIMIT;
  }
  return {
    unit: "calls",
    day: { used: day, allowance: config.dailyCalls, resetsAt: new Date(nextDayMs(nowMs)).toISOString() },
    month: { used: month, allowance: config.monthlyCalls, resetsAt: new Date(nextMonthMs(nowMs)).toISOString() },
    inFlight: { used: live, limit: config.inFlight },
    exhausted: reason !== null && !reason.startsWith("busy"),
    reason: reason ? reason.replace(/^busy:/, "") : null,
    model: config.modelEnabled ? "configured" : "absent",
    ...(wallet ? { credits: wallet } : {}),
  };
}

function refusalReason(used: Readonly<{ day: number; month: number; globalDay: number; globalMonth: number; inFlight: number }>, config: AgentBudgetConfig, nowMs: number): string | null {
  if (used.day >= config.dailyCalls) return `The daily allowance of ${config.dailyCalls} model calls for this wallet is spent; it resets at ${new Date(nextDayMs(nowMs)).toISOString()}.`;
  if (used.month >= config.monthlyCalls) return `The monthly allowance of ${config.monthlyCalls} model calls for this wallet is spent; it resets at ${new Date(nextMonthMs(nowMs)).toISOString()}.`;
  if (used.globalDay >= config.globalDailyCalls) return `The deployment's daily ceiling of ${config.globalDailyCalls} model calls is spent; it resets at ${new Date(nextDayMs(nowMs)).toISOString()}.`;
  if (used.globalMonth >= config.globalMonthlyCalls) return `The deployment's monthly ceiling of ${config.globalMonthlyCalls} model calls is spent; it resets at ${new Date(nextMonthMs(nowMs)).toISOString()}.`;
  if (used.inFlight >= config.inFlight) return `busy:A question of this wallet is being answered right now.`;
  return null;
}

/* ------------------------------------------------------------ the lease and the reservation */

export type BudgetReservation =
  | Readonly<{ ok: true; leaseId: string; release: () => Promise<void>; refund: () => Promise<void>; charge: (amount?: number) => Promise<void>; forgive: () => Promise<void>; credits: number }>
  | Readonly<{ ok: false; code: "AGENT_BUDGET_EXHAUSTED" | "AGENT_BUSY" | "UNAVAILABLE"; reason: string; credits?: ReserveRefusal }>;

/**
 * Take the in-flight lease and count one call on every counter. Refused with
 * the reason when an allowance or a ceiling is spent, or when a lease is live;
 * `release` gives the lease back, `refund` gives the call back too (the
 * provider was never reached). With `credit` (AI-04) the price is held under
 * the lease: `charge` keeps it once the provider was reached, `refund` gives
 * it back with the call.
 */
export async function reserveCall(store: GuardStore, owner: string, config: AgentBudgetConfig, nowMs: number, credit: CreditCharge | null = null): Promise<BudgetReservation> {
  const leaseId = `lease_${randomBytes(8).toString("hex")}`;
  const leaseKey = walletLeaseKey(owner);
  try {
    const taken = await withBoundedCasRetry(async () => {
      const raw = await leases(store).get(leaseKey);
      const parsed = LeasesSchema.safeParse(raw);
      const current = parsed.success ? parsed.data : null;
      const live = (current?.leases ?? []).filter((entry) => Date.parse(entry.expiresAt) > nowMs);
      if (live.length >= config.inFlight) return "busy" as const;
      const next: Leases = { version: (current?.version ?? 0) + 1, owner, leases: [...live, { id: leaseId, expiresAt: new Date(nowMs + config.leaseMs).toISOString() }], updatedAt: new Date(nowMs).toISOString() };
      const written = await leases(store).compareAndSet(leaseKey, current?.version ?? null, next);
      return written ? ("taken" as const) : false;
    });
    if (taken === "busy") return { ok: false, code: "AGENT_BUSY", reason: "A question of this wallet is being answered right now." };
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The budget store did not answer." };
  }
  const release = async () => {
    try {
      await withBoundedCasRetry(async () => {
        const raw = await leases(store).get(leaseKey);
        const parsed = LeasesSchema.safeParse(raw);
        if (!parsed.success) return "released" as const;
        const next: Leases = { ...parsed.data, version: parsed.data.version + 1, leases: parsed.data.leases.filter((entry) => entry.id !== leaseId), updatedAt: new Date(nowMs).toISOString() };
        const written = await leases(store).compareAndSet(leaseKey, parsed.data.version, next);
        return written ? ("released" as const) : false;
      });
    } catch {
      /* An expired lease releases itself. */
    }
  };
  /* The counters, read under the lease: the wallet's, then the deployment's. A ceiling reached refuses and the lease goes back. */
  const day = await readCount(store, walletDayKey(owner, nowMs));
  const month = await readCount(store, walletMonthKey(owner, nowMs));
  const globalDay = await readCount(store, globalDayKey(nowMs));
  const globalMonth = await readCount(store, globalMonthKey(nowMs));
  const reason = refusalReason({ day, month, globalDay, globalMonth, inFlight: 0 }, config, nowMs);
  if (reason !== null) {
    await release();
    return { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason };
  }
  /* AI-04: the price held before anything is counted — refused, the lease goes back and nothing was taken. */
  let hold: Readonly<{ holdId: string; amount: number }> | null = null;
  if (credit) {
    const amount = priceOf(credit.context.config, credit.action);
    const held = await reserveCredits(store, credit.context.holder, { action: credit.action, amount, acceptCredits: credit.acceptCredits, idem: credit.idem, config: credit.context.config, nowMs });
    if (!held.ok) {
      await release();
      return held.code === "UNAVAILABLE" ? { ok: false, code: "UNAVAILABLE", reason: held.reason, credits: held.code } : { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason: CREDIT_REASONS[held.code], credits: held.code };
    }
    hold = { holdId: held.holdId, amount: held.amount };
  }
  const settle = async (charged: number, suffix: string) => {
    if (!credit || !hold) return;
    /* A settle that failed leaves the hold to expire — given back whole: the person is never charged by an outage. */
    await settleCredits(store, credit.context.holder, { holdId: hold.holdId, charged, idem: `${credit.idem}:${suffix}`, nowMs }).catch(() => null);
  };
  try {
    for (const key of [walletDayKey(owner, nowMs), walletMonthKey(owner, nowMs), globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, 1, nowMs);
  } catch {
    await settle(0, "release");
    await release();
    return { ok: false, code: "UNAVAILABLE", reason: "The budget store did not answer." };
  }
  const refund = async () => {
    await settle(0, "release");
    try {
      for (const key of [walletDayKey(owner, nowMs), walletMonthKey(owner, nowMs), globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, -1, nowMs);
    } catch {
      /* A refund that failed leaves a conservative count. */
    }
  };
  /* AI-11: `amount` keeps less than the hold — a plan whose critic did not come back keeps only its own part; never more than was held. */
  const charge = async (amount?: number) => settle(Math.max(0, Math.min(hold?.amount ?? 0, amount ?? hold?.amount ?? 0)), "capture");
  /* The provider was reached but its words were not used (a failure, a timeout, an answer that did not verify): the call stays counted, the credits go back. */
  const forgive = async () => settle(0, "release");
  return { ok: true, leaseId, release, refund, charge, forgive, credits: hold?.amount ?? 0 };
}

/**
 * AI-10: one call the platform makes on its own schedule — «Ранковий огляд»,
 * the market's summary for everyone or a person's changes — counted on the
 * deployment's daily and monthly ceilings only: it is no question of the
 * person's, so it never spends their allowance or takes their lease. Refused
 * when a ceiling is spent; `refund` gives the call back when the provider was
 * never reached.
 */
export async function reserveScheduledCall(store: GuardStore, config: AgentBudgetConfig, nowMs: number): Promise<Readonly<{ ok: true; refund: () => Promise<void> }> | Readonly<{ ok: false; code: "AGENT_BUDGET_EXHAUSTED" | "UNAVAILABLE"; reason: string }>> {
  if (!config.modelEnabled) return { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason: "No model is switched on for this deployment." };
  try {
    const globalDay = await readCount(store, globalDayKey(nowMs));
    const globalMonth = await readCount(store, globalMonthKey(nowMs));
    const reason = refusalReason({ day: 0, month: 0, globalDay, globalMonth, inFlight: 0 }, { ...config, dailyCalls: Number.MAX_SAFE_INTEGER, monthlyCalls: Number.MAX_SAFE_INTEGER, inFlight: Number.MAX_SAFE_INTEGER }, nowMs);
    if (reason !== null) return { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason };
    for (const key of [globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, 1, nowMs);
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The budget store did not answer." };
  }
  return {
    ok: true,
    refund: async () => {
      try {
        for (const key of [globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, -1, nowMs);
      } catch {
        /* A refund that failed leaves a conservative count. */
      }
    },
  };
}

/* ------------------------------------------------------------ receipts and the admin's usage */

export function newReceiptId(): string {
  return `agr_${randomBytes(12).toString("hex")}`;
}

export type ReceiptInput = Readonly<{
  owner: string;
  sessionId: string;
  turnId: string;
  model: string;
  promptVersion: string;
  task: ModelTask;
  tokens: CallUsage;
  latencyMs: number;
  outcome: z.output<typeof Outcome>;
  at: string;
  id?: string;
  /** AI-10: the tier the response stated; a Flex call is priced at Flex rates. */
  serviceTier?: ServiceTier;
}>;

function receiptKey(owner: string, id: string): string {
  return GUEST_KEY.test(owner) ? `guest:${owner}:${id}` : SYSTEM_PAYER.test(owner) ? `system:${owner}:${id}` : `solana:mainnet:${owner}:${id}`;
}

/**
 * The receipt of one call, priced. Written once; a failed write is not a
 * failed answer, so callers catch it — and the same figures go to the
 * runtime log as one line without a wallet or a word, so the cost of a
 * question is measurable on production without reading the store.
 */
export async function writeReceipt(store: GuardStore, input: ReceiptInput): Promise<PricedReceipt | null> {
  const record: PricedReceipt = {
    schema: "ryntra.agent-receipt",
    schemaVersion: "1.1.0",
    version: 1,
    id: input.id ?? newReceiptId(),
    owner: input.owner,
    sessionId: input.sessionId,
    turnId: input.turnId,
    model: input.model.slice(0, 64),
    promptVersion: input.promptVersion,
    task: input.task,
    modelClass: TASK_CLASS[input.task],
    tokens: { input: input.tokens.input, cached: input.tokens.cached, output: input.tokens.output, reasoning: input.tokens.reasoning, total: input.tokens.total },
    /* A call answered but not read (no usage came back with it) was billed for what nobody can see here: unpriced, never free. */
    costMicroUsd: input.tokens.total === 0 && input.outcome !== "ok" && input.outcome !== "unavailable" ? null : costMicroUsd(input.model, input.tokens, input.serviceTier ?? "default"),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    outcome: input.outcome,
    at: input.at,
  };
  if (record.model !== "fixture") console.info(costLine(record));
  const written = await receipts(store).compareAndSet(receiptKey(record.owner, record.id), null, ReceiptV11.parse(record));
  return written ? record : null;
}

/** One line per call for the runtime log: the task, the model, the tokens, the cost, the latency, the outcome, whether a guest asked — never a wallet, a digest or a word. */
export function costLine(record: PricedReceipt): string {
  return `[assistant.cost] ${JSON.stringify({ task: record.task, class: record.modelClass, model: record.model, guest: GUEST_KEY.test(record.owner), system: SYSTEM_PAYER.test(record.owner), input: record.tokens.input, cached: record.tokens.cached, output: record.tokens.output, reasoning: record.tokens.reasoning, costUsd: record.costMicroUsd === null ? null : record.costMicroUsd / 1_000_000, ...(record.serviceTier ? { tier: record.serviceTier } : {}), latencyMs: record.latencyMs, outcome: record.outcome })}`;
}

export type AgentUsage = Readonly<{
  config: Omit<AgentBudgetConfig, "leaseMs">;
  /** The model each task calls on this deployment, by class. */
  models: Readonly<Record<ModelTask, Readonly<{ class: "L1" | "L2"; name: string }>>>;
  today: Readonly<{ day: string; calls: number; ceiling: number }>;
  month: Readonly<{ month: string; calls: number; ceiling: number }>;
  /** The receipts of the last `days` days, aggregated by day and by model — never a wallet, never words. Dollars from the priced receipts; `unpriced` counts the calls that carry no price. */
  byDay: readonly Readonly<{ day: string; calls: number; tokens: number; wallets: number; guests: number; costUsd: number; unpriced: number; outcomes: Record<string, number> }>[];
  byModel: readonly Readonly<{ model: string; calls: number; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number; unpriced: number }>[];
  observedAt: string;
}>;

/** The admin's view of what the agent spent, from the durable meter and the receipts; wallets are counted, never listed. */
export async function readAgentUsage(store: GuardStore, config: AgentBudgetConfig, nowMs: number, days = 14, env: Readonly<Record<string, string | undefined>> = {}): Promise<AgentUsage> {
  const dayCalls = await readCount(store, globalDayKey(nowMs));
  const monthCalls = await readCount(store, globalMonthKey(nowMs));
  const rows = [...(await receipts(store).valuesWithPrefix("solana:mainnet:")), ...(await receipts(store).valuesWithPrefix("guest:")), ...(await receipts(store).valuesWithPrefix("system:"))];
  const since = nowMs - days * 86_400_000;
  const kept = rows
    .map((row) => AgentReceiptSchema.safeParse(row))
    .filter((parsed): parsed is { success: true; data: AgentReceipt } => parsed.success)
    .map((parsed) => parsed.data)
    .filter((row) => Date.parse(row.at) >= since);
  const byDayMap = new Map<string, { calls: number; tokens: number; wallets: Set<string>; guests: Set<string>; micro: number; unpriced: number; outcomes: Record<string, number> }>();
  const byModelMap = new Map<string, { calls: number; inputTokens: number; cachedTokens: number; outputTokens: number; micro: number; unpriced: number }>();
  for (const row of kept) {
    const priced = row.schemaVersion === "1.1.0" ? row : null;
    const micro = priced?.costMicroUsd ?? null;
    const day = row.at.slice(0, 10);
    const entry = byDayMap.get(day) ?? { calls: 0, tokens: 0, wallets: new Set<string>(), guests: new Set<string>(), micro: 0, unpriced: 0, outcomes: {} };
    entry.calls += 1;
    entry.tokens += row.tokens.total;
    /* The platform's own calls (AI-09) are neither a wallet nor a guest: counted in calls and dollars, not in people. */
    if (!SYSTEM_PAYER.test(row.owner)) (GUEST_KEY.test(row.owner) ? entry.guests : entry.wallets).add(row.owner);
    if (micro === null) entry.unpriced += 1;
    else entry.micro += micro;
    entry.outcomes[row.outcome] = (entry.outcomes[row.outcome] ?? 0) + 1;
    byDayMap.set(day, entry);
    const model = byModelMap.get(row.model) ?? { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, micro: 0, unpriced: 0 };
    model.calls += 1;
    model.inputTokens += row.tokens.input;
    model.cachedTokens += priced?.tokens.cached ?? 0;
    model.outputTokens += row.tokens.output;
    if (micro === null) model.unpriced += 1;
    else model.micro += micro;
    byModelMap.set(row.model, model);
  }
  const { leaseMs: _lease, ...rest } = config;
  const models = Object.fromEntries(MODEL_TASKS.map((task) => [task, { class: TASK_CLASS[task], name: modelFor(task, env).name }])) as AgentUsage["models"];
  return {
    config: rest,
    models,
    today: { day: dayOf(nowMs), calls: dayCalls, ceiling: config.globalDailyCalls },
    month: { month: monthOf(nowMs), calls: monthCalls, ceiling: config.globalMonthlyCalls },
    byDay: [...byDayMap]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, entry]) => ({ day, calls: entry.calls, tokens: entry.tokens, wallets: entry.wallets.size, guests: entry.guests.size, costUsd: entry.micro / 1_000_000, unpriced: entry.unpriced, outcomes: entry.outcomes })),
    byModel: [...byModelMap].map(([model, entry]) => ({ model, calls: entry.calls, inputTokens: entry.inputTokens, cachedTokens: entry.cachedTokens, outputTokens: entry.outputTokens, costUsd: entry.micro / 1_000_000, unpriced: entry.unpriced })),
    observedAt: new Date(nowMs).toISOString(),
  };
}

/* ------------------------------------------------------------ the guest's allowance (AI-02) */

export const guestDayKey = (guest: string, nowMs: number): string => `guest:${guest}:day:${dayOf(nowMs)}`;
export const guestsDayKey = (nowMs: number): string => `guests:day:${dayOf(nowMs)}`;

export type GuestAllowance = Readonly<{ used: number; allowance: number; resetsAt: string }>;

export async function readGuestAllowance(store: GuardStore, guest: string, config: AgentBudgetConfig, nowMs: number): Promise<GuestAllowance> {
  return { used: await readCount(store, guestDayKey(guest, nowMs)), allowance: config.guestDailyCalls, resetsAt: new Date(nextDayMs(nowMs)).toISOString() };
}

export type GuestReservation = Readonly<{ ok: true; refund: () => Promise<void> }> | Readonly<{ ok: false; code: "AGENT_BUDGET_EXHAUSTED" | "UNAVAILABLE"; reason: string }>;

/**
 * Count one guest question that reaches the model on the guest's day, the
 * guests' day and the deployment's day and month — refused, with nothing
 * counted, when any of them is spent. `refund` gives the call back when the
 * provider was never reached.
 */
export async function reserveGuestCall(store: GuardStore, guest: string, config: AgentBudgetConfig, nowMs: number): Promise<GuestReservation> {
  if (!GUEST_KEY.test(guest)) return { ok: false, code: "UNAVAILABLE", reason: "No guest key." };
  const keys = [guestDayKey(guest, nowMs), guestsDayKey(nowMs), globalDayKey(nowMs), globalMonthKey(nowMs)] as const;
  const limits = [config.guestDailyCalls, config.guestGlobalDailyCalls, config.globalDailyCalls, config.globalMonthlyCalls] as const;
  /*
   * Count first, then judge: every advance is a compare-and-set, so two
   * guests at once each see their own count and the one past a limit gives
   * its counts back — no read-then-write window to slip through.
   */
  const advanced: string[] = [];
  const giveBack = async () => {
    for (const key of advanced) await advance(store, key, -1, nowMs).catch(() => 0);
  };
  try {
    for (const [index, key] of keys.entries()) {
      const count = await advance(store, key, 1, nowMs);
      advanced.push(key);
      if (count > limits[index]) {
        await giveBack();
        return { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason: index === 0 ? `A guest's ${config.guestDailyCalls} model answers for today are spent; connect a wallet for more.` : "The guests' model answers for today are spent; connect a wallet for more." };
      }
    }
  } catch {
    await giveBack();
    return { ok: false, code: "UNAVAILABLE", reason: "The budget store did not answer." };
  }
  return {
    ok: true,
    refund: async () => {
      try {
        for (const key of keys) await advance(store, key, -1, nowMs);
      } catch {
        /* A refund that failed leaves a conservative count. */
      }
    },
  };
}

/* ------------------------------------------------------------ AI-19: the tasks' share of the deployment's day */

export const tasksDayKey = (nowMs: number): string => `tasks:day:${dayOf(nowMs)}`;

/**
 * One run of a «Доручення» counted on the tasks' day before it asks — refused, with nothing counted, once every
 * wallet's tasks together reached `tasksGlobalDailyCalls`. The run then goes through the person's own path, which
 * meters the wallet's and the deployment's day as for any question. `refund` gives the run back when nothing was asked.
 */
export async function reserveTaskRun(store: GuardStore, config: AgentBudgetConfig, nowMs: number): Promise<Readonly<{ ok: true; refund: () => Promise<void> }> | Readonly<{ ok: false }>> {
  const key = tasksDayKey(nowMs);
  try {
    const count = await advance(store, key, 1, nowMs);
    if (count > config.tasksGlobalDailyCalls) {
      await advance(store, key, -1, nowMs).catch(() => 0);
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  return { ok: true, refund: async () => void (await advance(store, key, -1, nowMs).catch(() => 0)) };
}
