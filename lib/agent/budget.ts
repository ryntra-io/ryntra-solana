/**
 * The agent's budget — durable, per wallet, metered in the Guard store
 * (`RYN-AGENT-TEXT-001`; the Owner's rule of 2026-09-22 §14; the allowance
 * and the usage receipt `RYN-AI-001` describes).
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
 * Never a process-local counter: the Strategy Lab's `StrategyAiBudgetController`
 * coordinates one warm instance and is not this.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { BASE58, type AgentBudgetState } from "../api/v1/contract.ts";
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
  /** The deployment's own ceilings — the Owner's key is one key. */
  globalDailyCalls: number;
  globalMonthlyCalls: number;
  /** How long an in-flight lease lives when the answer never settled (a crashed instance). */
  leaseMs: number;
  /** Whether a model is configured to be called at all — the Owner's explicit switch plus the key. */
  modelEnabled: boolean;
}>;

export const AGENT_BUDGET_ENV = {
  daily: "RYNTRA_AGENT_DAILY_CALLS",
  monthly: "RYNTRA_AGENT_MONTHLY_CALLS",
  inFlight: "RYNTRA_AGENT_IN_FLIGHT",
  globalDaily: "RYNTRA_AGENT_GLOBAL_DAILY_CALLS",
  globalMonthly: "RYNTRA_AGENT_GLOBAL_MONTHLY_CALLS",
  /** `1` switches the model on; absent, every answer is deterministic and nothing is spent. The Owner's word, not a default. */
  modelEnabled: "RYNTRA_AGENT_MODEL_ENABLED",
} as const;

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export function resolveAgentBudgetConfig(env: Readonly<Record<string, string | undefined>> = process.env): AgentBudgetConfig {
  return {
    dailyCalls: positive(env[AGENT_BUDGET_ENV.daily], 20),
    monthlyCalls: positive(env[AGENT_BUDGET_ENV.monthly], 200),
    inFlight: positive(env[AGENT_BUDGET_ENV.inFlight], 1),
    globalDailyCalls: positive(env[AGENT_BUDGET_ENV.globalDaily], 300),
    globalMonthlyCalls: positive(env[AGENT_BUDGET_ENV.globalMonthly], 3000),
    leaseMs: 90_000,
    modelEnabled: env[AGENT_BUDGET_ENV.modelEnabled]?.trim() === "1" && Boolean(env.OPENAI_API_KEY?.trim()),
  };
}

/* ------------------------------------------------------------ records */

const CounterSchema = z.object({ version: z.number().int().min(1), key: z.string().min(1), count: z.number().int().min(0), updatedAt: z.string().datetime({ offset: true }) }).strict();
type Counter = z.output<typeof CounterSchema>;

const LeasesSchema = z.object({ version: z.number().int().min(1), owner: z.string().regex(BASE58), leases: z.array(z.object({ id: z.string().min(8).max(64), expiresAt: z.string().datetime({ offset: true }) }).strict()).max(16), updatedAt: z.string().datetime({ offset: true }) }).strict();
type Leases = z.output<typeof LeasesSchema>;

export const AgentReceiptSchema = z
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
    outcome: z.enum(["ok", "refused", "invalid-output", "timeout", "rate-limited", "quota", "unavailable"]),
    at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AgentReceipt = z.output<typeof AgentReceiptSchema>;

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

export async function readBudgetState(store: GuardStore, owner: string, config: AgentBudgetConfig, nowMs: number): Promise<AgentBudgetState> {
  /* Read in sequence, not at once: a stand's single-connection store answers one query at a time, and five reads cost nothing worth racing. */
  const day = await readCount(store, walletDayKey(owner, nowMs));
  const month = await readCount(store, walletMonthKey(owner, nowMs));
  const globalDay = await readCount(store, globalDayKey(nowMs));
  const globalMonth = await readCount(store, globalMonthKey(nowMs));
  const leaseRow = await leases(store).get(walletLeaseKey(owner));
  const lease = LeasesSchema.safeParse(leaseRow);
  const live = lease.success ? lease.data.leases.filter((entry) => Date.parse(entry.expiresAt) > nowMs).length : 0;
  const reason = refusalReason({ day, month, globalDay, globalMonth, inFlight: live }, config, nowMs);
  return {
    unit: "calls",
    day: { used: day, allowance: config.dailyCalls, resetsAt: new Date(nextDayMs(nowMs)).toISOString() },
    month: { used: month, allowance: config.monthlyCalls, resetsAt: new Date(nextMonthMs(nowMs)).toISOString() },
    inFlight: { used: live, limit: config.inFlight },
    exhausted: reason !== null && !reason.startsWith("busy"),
    reason: reason ? reason.replace(/^busy:/, "") : null,
    model: config.modelEnabled ? "configured" : "absent",
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

export type BudgetReservation = Readonly<{ ok: true; leaseId: string; release: () => Promise<void>; refund: () => Promise<void> }> | Readonly<{ ok: false; code: "AGENT_BUDGET_EXHAUSTED" | "AGENT_BUSY" | "UNAVAILABLE"; reason: string }>;

/**
 * Take the in-flight lease and count one call on every counter. Refused with
 * the reason when an allowance or a ceiling is spent, or when a lease is live;
 * `release` gives the lease back, `refund` gives the call back too (the
 * provider was never reached).
 */
export async function reserveCall(store: GuardStore, owner: string, config: AgentBudgetConfig, nowMs: number): Promise<BudgetReservation> {
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
  try {
    for (const key of [walletDayKey(owner, nowMs), walletMonthKey(owner, nowMs), globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, 1, nowMs);
  } catch {
    await release();
    return { ok: false, code: "UNAVAILABLE", reason: "The budget store did not answer." };
  }
  const refund = async () => {
    try {
      for (const key of [walletDayKey(owner, nowMs), walletMonthKey(owner, nowMs), globalDayKey(nowMs), globalMonthKey(nowMs)]) await advance(store, key, -1, nowMs);
    } catch {
      /* A refund that failed leaves a conservative count. */
    }
  };
  return { ok: true, leaseId, release, refund };
}

/* ------------------------------------------------------------ receipts and the admin's usage */

export function newReceiptId(): string {
  return `agr_${randomBytes(12).toString("hex")}`;
}

export async function writeReceipt(store: GuardStore, input: Omit<AgentReceipt, "schema" | "schemaVersion" | "version" | "id"> & { id?: string }): Promise<AgentReceipt | null> {
  const record: AgentReceipt = { schema: "ryntra.agent-receipt", schemaVersion: "1.0.0", version: 1, id: input.id ?? newReceiptId(), ...input };
  const written = await receipts(store).compareAndSet(`solana:mainnet:${record.owner}:${record.id}`, null, AgentReceiptSchema.parse(record));
  return written ? record : null;
}

export type AgentUsage = Readonly<{
  config: Omit<AgentBudgetConfig, "leaseMs">;
  today: Readonly<{ day: string; calls: number; ceiling: number }>;
  month: Readonly<{ month: string; calls: number; ceiling: number }>;
  /** The receipts of the last `days` days, aggregated by day and by model — never a wallet, never words. */
  byDay: readonly Readonly<{ day: string; calls: number; tokens: number; wallets: number; outcomes: Record<string, number> }>[];
  byModel: readonly Readonly<{ model: string; calls: number; inputTokens: number; outputTokens: number }>[];
  observedAt: string;
}>;

/** The Owner's view of what the agent spent, from the durable meter and the receipts; wallets are counted, never listed. */
export async function readAgentUsage(store: GuardStore, config: AgentBudgetConfig, nowMs: number, days = 14): Promise<AgentUsage> {
  const dayCalls = await readCount(store, globalDayKey(nowMs));
  const monthCalls = await readCount(store, globalMonthKey(nowMs));
  const rows = await receipts(store).valuesWithPrefix("solana:mainnet:");
  const since = nowMs - days * 86_400_000;
  const kept = rows.map((row) => AgentReceiptSchema.safeParse(row)).filter((parsed): parsed is { success: true; data: AgentReceipt } => parsed.success).map((parsed) => parsed.data).filter((row) => Date.parse(row.at) >= since);
  const byDayMap = new Map<string, { calls: number; tokens: number; wallets: Set<string>; outcomes: Record<string, number> }>();
  const byModelMap = new Map<string, { calls: number; inputTokens: number; outputTokens: number }>();
  for (const row of kept) {
    const day = row.at.slice(0, 10);
    const entry = byDayMap.get(day) ?? { calls: 0, tokens: 0, wallets: new Set<string>(), outcomes: {} };
    entry.calls += 1;
    entry.tokens += row.tokens.total;
    entry.wallets.add(row.owner);
    entry.outcomes[row.outcome] = (entry.outcomes[row.outcome] ?? 0) + 1;
    byDayMap.set(day, entry);
    const model = byModelMap.get(row.model) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    model.calls += 1;
    model.inputTokens += row.tokens.input;
    model.outputTokens += row.tokens.output;
    byModelMap.set(row.model, model);
  }
  const { leaseMs: _lease, ...rest } = config;
  return {
    config: rest,
    today: { day: dayOf(nowMs), calls: dayCalls, ceiling: config.globalDailyCalls },
    month: { month: monthOf(nowMs), calls: monthCalls, ceiling: config.globalMonthlyCalls },
    byDay: [...byDayMap].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, entry]) => ({ day, calls: entry.calls, tokens: entry.tokens, wallets: entry.wallets.size, outcomes: entry.outcomes })),
    byModel: [...byModelMap].map(([model, entry]) => ({ model, ...entry })),
    observedAt: new Date(nowMs).toISOString(),
  };
}
