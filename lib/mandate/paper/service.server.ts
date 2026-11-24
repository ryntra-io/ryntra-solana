/**
 * The paper week as the route and the cron run it: a start from the person's own plan, coin and budget; a
 * read; the end she asks for, or «Start with money» marking the paper as taken live; and the cron's pass over every
 * paper agent at work. The store and the reads are handed in (`./wire.server.ts` on the deployment, memory and fixtures
 * in the tests); this file reads no environment and holds no key.
 *
 * The person's browser holds the key of her paper week — her proven wallet's own, which the start's door derives and
 * answers back (`paperKeyOf`, `./door.server.ts`); the store knows only its sha256 (`paperIdOf`). The key reads and ends
 * that one paper week and nothing else: it signs nothing, and «Start with money» is the mandate's own flow, one signature
 * in her wallet — the paper only learns that she did.
 */

import { createHash, createHmac } from "node:crypto";

import { budgetIssue, type AgentBudget } from "../budget.ts";
import { planFrom, planText } from "../plans.ts";
import { canGoLive, isMint, routedOf, symbolOf, viewOf, weekEnd, type PaperAgent, type PaperView } from "./model.ts";
import { PAPER_START_COST, PAPER_STEP_COST, type PaperQuota } from "./quota.ts";
import { paperStep, type PaperDid, type PaperReads } from "./step.server.ts";
import { PAPER_AT_WORK_MAX, type PaperStore } from "./store.ts";

/** The key a browser holds: 32 random bytes, base64url. */
const KEY = /^[A-Za-z0-9_-]{43}$/u;

/** The store's id of a key; null for anything that is not one. */
export function paperIdOf(key: unknown): string | null {
  if (typeof key !== "string" || !KEY.test(key)) return null;
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Who asks for a start, as the store's ledger of starts knows them: an HMAC of the caller under a server-only key (the
 * deployment's app secret, `./wire.server.ts`) — the start's door names the proven wallet, `wallet:<address>`
 * (`./door.server.ts`). The address itself is never stored, and the ledger forgets every row after a day
 * (`supabase/migrations/20261120190100_agent_paper_week_v1.sql`).
 */
export function whoOf(address: string, key: string): string {
  return createHmac("sha256", key).update(`agent-paper:${address}`, "utf8").digest("hex");
}

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
/** The shortest server key a wallet's paper key is derived under: anything shorter is no secret. */
export const PAPER_SECRET_MIN = 16;

/**
 * The key of a proven wallet's paper week: an HMAC of the address under the server's key, base64url — the same shape as
 * the key a browser held before (`KEY`), so the store, the reads and the end take it as they are. One wallet, one key:
 * one paper week at a time per wallet (a start while it is at work answers that week). Only the wallet's own proof gets
 * it (`./door.server.ts`); without the server's key nobody can derive it from a public address, and the store still
 * knows only its sha256 (`paperIdOf`). Null for anything that is not an address, or a key too short to be a secret.
 */
export function paperKeyOf(address: string, secret: string): string | null {
  if (!WALLET.test(address) || typeof secret !== "string" || secret.length < PAPER_SECRET_MIN) return null;
  return createHmac("sha256", secret).update(`agent-paper:key:${address}`, "utf8").digest("base64url");
}

const WHO = /^[0-9a-f]{64}$/u;

export type PaperDeps = Readonly<{
  store: PaperStore;
  /** The live reads of one coin. */
  reads: (coin: string) => PaperReads;
  /** Paper's budget of Jupiter's asks (`./quota.ts`): a start or a pass it cannot afford waits. Absent — unbounded (tests). */
  quota?: PaperQuota;
  now?: () => number;
}>;

export type StartInput = Readonly<{
  key: unknown;
  coin: unknown;
  symbol?: unknown;
  plan: unknown;
  perDay: unknown;
  perTrade: unknown;
  days: unknown;
  bornAt?: unknown;
  /** The caller, as `whoOf` names them: the route's, never the browser's own word. */
  who: unknown;
}>;

/**
 * Why a start was refused: no key; not the agent's input; a pair the agent does not trade; no price now; the store full;
 * this caller (or everyone) started too many lately (`LIMITED`); paper's share of Jupiter spent for now (`BUSY`).
 */
export type PaperRefusal = "KEY" | "INPUT" | "PAIR" | "NO_PRICE" | "FULL" | "LIMITED" | "BUSY";

export type StartAnswer = Readonly<{ ok: true; view: PaperView; already: boolean }> | Readonly<{ ok: false; code: PaperRefusal }>;

const RAW = /^\d{1,20}$/u;

/** The budget the input names, when it is one the agent takes; null otherwise. */
function budgetFrom(input: StartInput): AgentBudget | null {
  if (typeof input.perDay !== "string" || typeof input.perTrade !== "string" || !RAW.test(input.perDay) || !RAW.test(input.perTrade) || !Number.isInteger(input.days)) return null;
  const budget = { perDay: BigInt(input.perDay), perTrade: BigInt(input.perTrade), days: input.days as number };
  return budgetIssue(budget) === null ? budget : null;
}

/** A new paper week on the person's plan, coin and budget — the very numbers «Start with money» would sign. */
export async function startPaper(input: StartInput, deps: PaperDeps): Promise<StartAnswer> {
  const now = (deps.now ?? Date.now)();
  const id = paperIdOf(input.key);
  if (!id) return { ok: false, code: "KEY" };
  const plan = typeof input.plan === "string" ? planFrom(input.plan) : null;
  const budget = budgetFrom(input);
  const bornAt = typeof input.bornAt === "number" && Number.isSafeInteger(input.bornAt) && input.bornAt > 0 && input.bornAt <= now ? input.bornAt : null;
  if (!plan || !budget || !isMint(input.coin) || (plan.id === "early" && bornAt === null)) return { ok: false, code: "INPUT" };
  if (typeof input.who !== "string" || !WHO.test(input.who)) return { ok: false, code: "INPUT" };
  const coin = input.coin;

  /* A week already at work for this key is the one the person sees: one at a time, nothing replaced by a second tap. */
  const was = await deps.store.get(id);
  if (was && (was.agent.status === "working" || was.agent.status === "paused")) return { ok: true, view: viewOf(was.agent, now), already: true };

  /* Before a single quote: paper's share of Jupiter must hold a whole start, and the store's ledger must admit this caller. */
  if (deps.quota && deps.quota.room() < PAPER_START_COST) return { ok: false, code: "BUSY" };
  const admitted = await deps.store.admit(input.who, "mainnet", PAPER_AT_WORK_MAX);
  if (admitted === "full") return { ok: false, code: "FULL" };
  if (admitted === "limited") return { ok: false, code: "LIMITED" };
  /* Everyone's hour is spent — not this wallet's doing: paper is full for now, never «this wallet started too often». */
  if (admitted === "busy") return { ok: false, code: "FULL" };
  const refused = deps.quota?.refusals() ?? 0;
  const spent = () => deps.quota !== undefined && deps.quota.refusals() > refused;

  const reads = deps.reads(coin);
  const fees = await reads.fees().catch(() => null);
  if (!fees) return { ok: false, code: spent() ? "BUSY" : "NO_PRICE" };
  if (fees.buyBps === null) return { ok: false, code: "PAIR" };
  /* The coins a trade of the budget buys now: the route quotes the coin, and a dip's or a grid's price is read in it. */
  const unit = await reads.buy(routedOf(budget.perTrade, fees.buyBps)).catch(() => null);
  if (unit === null || unit <= 0n) return { ok: false, code: spent() ? "BUSY" : "NO_PRICE" };

  const agent: PaperAgent = {
    id,
    kind: "paper",
    network: "mainnet",
    plan: planText(plan),
    coin,
    symbol: symbolOf(input.symbol),
    perDayRaw: budget.perDay.toString(),
    perTradeRaw: budget.perTrade.toString(),
    days: budget.days,
    startedAt: now,
    endsAt: weekEnd(now, budget.days),
    bornAt,
    unitRaw: unit.toString(),
    status: "working",
    trades: [],
    worthRaw: null,
    worthAt: null,
    exitBps: fees.sellBps,
    updatedAt: now,
  };
  const started = await deps.store.start(agent, PAPER_AT_WORK_MAX);
  if (started === "full") return { ok: false, code: "FULL" };
  const row = await deps.store.get(id);
  if (!row) return { ok: true, view: viewOf(agent, now), already: started === "working" };
  if (started === "working") return { ok: true, view: viewOf(row.agent, now), already: true };
  /*
   * Its first pass at once, as the agent's first buy comes at once: the person sees it at work in a moment. A first pass
   * that ran out of paper's share is not written — the cron's next pass makes it — so a spent share never counts as a
   * price not read.
   */
  const first = await paperStep(row.agent, reads, now).catch(() => null);
  if (first && first.agent !== row.agent && !spent()) {
    const written = await deps.store.put(first.agent, row.version);
    if (written !== null) return { ok: true, view: viewOf(first.agent, now), already: false };
  }
  return { ok: true, view: viewOf(row.agent, now), already: false };
}

/** The paper week of this key; null when there is none. */
export async function readPaper(key: unknown, deps: Pick<PaperDeps, "store" | "now">): Promise<Readonly<{ ok: true; view: PaperView | null }> | Readonly<{ ok: false; code: "KEY" }>> {
  const id = paperIdOf(key);
  if (!id) return { ok: false, code: "KEY" };
  const row = await deps.store.get(id);
  return { ok: true, view: row ? viewOf(row.agent, (deps.now ?? Date.now)()) : null };
}

/**
 * The person ends the paper week (`ended`), or tells it she started with money from it (`live`): the paper stops and stays
 * as it was. Nothing of it travels into the agent's book — the mandate she signed carries her plan and budget, not the
 * paper's trades. Asked twice, the second answer is the first one's.
 */
export async function closePaper(key: unknown, to: "ended" | "live", deps: Pick<PaperDeps, "store" | "now">): Promise<Readonly<{ ok: true; view: PaperView | null }> | Readonly<{ ok: false; code: "KEY" }>> {
  const id = paperIdOf(key);
  if (!id) return { ok: false, code: "KEY" };
  for (let tries = 0; tries < 3; tries += 1) {
    const now = (deps.now ?? Date.now)();
    const row = await deps.store.get(id);
    if (!row) return { ok: true, view: null };
    if (!canGoLive(row.agent)) return { ok: true, view: viewOf(row.agent, now) };
    const { pausedBy: _paused, unreadSince: _seen, ...rest } = row.agent;
    const next: PaperAgent = { ...rest, status: to, ...(to === "live" ? { liveAt: now } : {}), updatedAt: now };
    if ((await deps.store.put(next, row.version)) !== null) return { ok: true, view: viewOf(next, now) };
  }
  throw new Error("the paper week kept changing under the close");
}

/* ---------------------------------------------------------------- the cron's pass */

/** The most paper agents one pass trades for: each costs a few quotes. */
export const PAPER_PER_PASS = 40;
/** After this long a pass starts no new paper agent: the function has 60 s. */
export const PAPER_PASS_WITHIN_MS = 40_000;

/**
 * One line per paper agent the pass took: what its step did; `raced` — another pass wrote first; `unread` — its reads
 * threw; `held` — paper's share of Jupiter ran out, so the pass stopped here and wrote nothing for it: this agent and
 * the rest keep their place at the head of the next pass.
 */
export type PaperPassLine = Readonly<{ did: PaperDid | "raced" | "unread" | "held" }>;

/**
 * One pass over the paper agents at work: each one's step, written over the version it was read at. Before each, paper's
 * share of Jupiter must hold a whole step; a step that was refused an ask anyway is dropped, not written as a price not
 * read, and the pass ends.
 */
export async function runPaperPass(deps: PaperDeps & Readonly<{ limit?: number; withinMs?: number }>): Promise<readonly PaperPassLine[]> {
  const clock = deps.now ?? Date.now;
  const started = clock();
  const due = await deps.store.due("mainnet", deps.limit ?? PAPER_PER_PASS);
  const lines: PaperPassLine[] = [];
  for (const row of due) {
    if (lines.length > 0 && clock() - started >= (deps.withinMs ?? PAPER_PASS_WITHIN_MS)) break;
    if (deps.quota && deps.quota.room() < PAPER_STEP_COST) {
      lines.push({ did: "held" });
      break;
    }
    const refused = deps.quota?.refusals() ?? 0;
    try {
      const step = await paperStep(row.agent, deps.reads(row.agent.coin), clock());
      if (deps.quota && deps.quota.refusals() > refused) {
        lines.push({ did: "held" });
        break;
      }
      if (step.agent === row.agent) {
        lines.push({ did: step.did });
        continue;
      }
      const written = await deps.store.put(step.agent, row.version);
      lines.push({ did: written === null ? "raced" : step.did });
    } catch {
      if (deps.quota && deps.quota.refusals() > refused) {
        lines.push({ did: "held" });
        break;
      }
      /* One paper agent that could not be read costs only itself: the others go on. */
      lines.push({ did: "unread" });
    }
  }
  return lines;
}
