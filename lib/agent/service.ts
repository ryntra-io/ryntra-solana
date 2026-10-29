/**
 * Ryn's service — one question in, two turns out.
 *
 * The exchange: the person's words become an intent (`intent.ts`); the
 * intent and the session's context decide which tools run and with which
 * arguments — the server decides, never the model (`plan.ts` below); the
 * tools read through the existing services and return facts with citations
 * (`tools/`); the answer is composed — by the configured model under the
 * budget, verified against the reads, or deterministically from the tools'
 * own sentences (`answer.ts`, `model.ts`, `budget.ts`); the drafts a turn
 * prepared are stored for the builder and the ticket (`drafts.ts`); the two
 * turns are appended to the durable session (`session.ts`) with the
 * privacy-safe steps the exchange recorded. A request to execute is refused
 * and prepared for Review; a request for a secret is refused and nothing
 * else runs.
 *
 * AI-02: one exchange for two askers. A wallet's question goes into its
 * durable session under the wallet's allowance; a guest's (`handleGuestMessage`)
 * is answered on the market alone, stored nowhere, under a guest's
 * allowance (`lib/assistant/guest.ts`). Either way a question the parser
 * could not place may be read by the everyday model and is held to the words
 * (`mergeModelIntent`), the answer's words come from the everyday model, one
 * reservation covers both calls of a question, and every call leaves a
 * priced receipt.
 *
 * AI-06c: a talk — a greeting, a thanks, «who are you», a general question,
 * and whatever the parser and the model's read still could not place — is
 * answered by the everyday model in Ryntra's voice over no reads (`talk.ts`),
 * under the same reservation and price as any question; without the model, a
 * human sentence of the server's.
 */

import { readerOf, type Reader } from "../assistant/profile/service.ts";
import { readerMemory, type ReaderMemory } from "../assistant/memory/service.ts";
import { readMemoryRecord } from "../assistant/memory/store.ts";
import { noticeInMessage } from "../assistant/memory/notice.ts";
import { profileOf, readProfileRecord } from "../assistant/profile/store.ts";
import type { AgentAnswer, AgentCard, AgentContext, AgentDraftCard, AgentGuestResponse, AgentHandoff, AgentMessageResponse, AgentQuestionClass, AgentSessionListResponse, AgentSessionResponse, AgentToolOutcome, AgentTurn } from "../api/v1/contract.ts";
import { AGENT_CARDS_MAX, AGENT_CITATIONS_MAX, AGENT_SESSION_RETENTION_DAYS } from "../api/v1/contract.ts";
import type { ModelTask } from "../assistant/models.ts";
import { GUEST_CLASSES, GUEST_TOOLS, guestReaders } from "../assistant/guest.ts";
import { CBBTC_MINT, SOL_MINT } from "../assistant/news/tagging.ts";
import type { GuardStore } from "../guard/store.ts";
import { composeDeterministic, headline, verifyAnswer, verifyTalk, type AnswerPacket } from "./answer.ts";
import { resolveHolder, type AccountLookup } from "../assistant/credits/holder.ts";
import { walletHolder } from "../assistant/credits/ledger.ts";
import type { CreditsConfig } from "../assistant/credits/prices.ts";
import { readBudgetState, readGuestAllowance, reserveCall, reserveGuestCall, writeReceipt, type AgentBudgetConfig, type CreditsContext } from "./budget.ts";
import { newDraftId, storeDraft } from "./drafts.ts";
import { mergeModelIntent, parseIntent, type Intent } from "./intent.ts";
import { composeBrief } from "./lens/brief.ts";
import { composeCritic } from "./lens/critic.ts";
import { projectReads } from "./lens/reads.ts";
import { promptVersionOf, safetyIdentifier, type AgentModel, type ModelUsage, type ModelOutcome } from "./model.ts";
import { CitationBook, type Locale } from "./provenance.ts";
import { appendTurns, listSessions, newTurnId, openSession, projectSession, readSession, summariseSession, type AgentSessionRecord } from "./session.ts";
import { suggestionsFor } from "./suggestions.ts";
import { pickStarters, startersFor, talkAnswer, talkHeadline, talkKindOf, talkTemplate, type TalkFallback, type TalkKind } from "./talk.ts";
import { resolveAsset, type AgentReaders } from "./tools/readers.ts";
import { runTool } from "./tools/registry.ts";
import type { ToolContext, ToolNote, ToolRun } from "./tools/types.ts";

export type AgentDeps = Readonly<{
  store: GuardStore;
  readers: AgentReaders;
  /** The configured model, or null: every answer is then deterministic and nothing is spent. */
  model: AgentModel | null;
  budget: AgentBudgetConfig;
  /** AI-04: the credits a question that reaches the model is paid in, and how a wallet's account is found; absent, the call allowance alone meters. */
  credits?: Readonly<{ config: CreditsConfig; lookup: AccountLookup | null }> | null;
  now?: () => number;
  newSessionId?: () => string;
  newTurnId?: () => string;
  newDraftId?: () => string;
}>;

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

/* ------------------------------------------------------------ the tool plan */

export type ToolCall = Readonly<{ name: string; input: Record<string, unknown> }>;

function contextMint(context: AgentContext | null): string | null {
  return context?.kind === "asset" ? context.mint : null;
}

/**
 * Which tools run for an intent, with which arguments — the server's
 * decision. Every argument comes from the validated intent or the session's
 * context, never from free text, and never names another wallet.
 */
export function planTools(intent: Intent, context: AgentContext | null): readonly ToolCall[] {
  const queries = [...intent.symbols, ...intent.mints];
  const first = queries[0] ?? contextMint(context) ?? null;
  switch (intent.class) {
    case "market":
    case "stock": {
      /* AI-03: the market as a whole — Pulse's movers over the hour or the day; AI-09: and its news, when the words ask for news. */
      if (!first) return [...(intent.marketWide ? [{ name: "movers_read", input: { window: intent.marketWide } }] : []), ...(intent.news ? [{ name: "news_read", input: {} }] : [])];
      const calls: ToolCall[] = queries.slice(0, 2).map((query) => ({ name: "market_read", input: { query } }));
      if (calls.length === 0) calls.push({ name: "market_read", input: { query: first } });
      /* AI-03: the DEX's own figures beside the catalogue's — volume and trades over four windows, from DexScreener. */
      calls.push({ name: "dex_pairs_read", input: { query: first } });
      /* Why it moves: the day's range and the week's move from the candles, and the day's flows — one evidence read, through the layer's own budget. */
      if (intent.movement) calls.push({ name: "candles_read", input: { query: first, timeframe: "1h" } });
      /* AI-09: the token's news, when the words ask for news and not for the move (the move's lines carry its news already). */
      if (intent.news && !intent.movement) calls.push({ name: "news_read", input: { query: first } });
      if (intent.liquidity) calls.push({ name: "meteora_pools_read", input: { query: first } });
      calls.push({ name: "launch_health_read", input: { query: first } });
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(first)) calls.push({ name: "plan_read", input: { symbol: first } });
      if (intent.movement) calls.push({ name: "evidence_read_by_query", input: { query: first, window: "24h" } });
      /* AI-09: «what moved the price?» — the move, the market beside it and the news of that window, every line marked; last, so the reads it stands on are said first. */
      if (intent.movement) calls.push({ name: "price_move_read", input: { query: first, window: intent.moveWindow ?? "24h" } });
      return calls;
    }
    case "evidence": {
      if (!first) return [];
      return [
        { name: "market_read", input: { query: first } },
        /* AI-03: RugCheck's report, the Meteora pools and, for a Ryntra launch, Market Health — keyless, for anyone. */
        { name: "token_report_read", input: { query: first } },
        { name: "meteora_pools_read", input: { query: first } },
        { name: "launch_health_read", input: { query: first } },
        { name: "evidence_read_by_query", input: { query: first, window: "now" } },
        { name: "evidence_read_by_query", input: { query: first, window: intent.window && intent.window !== "now" ? intent.window : "24h" } },
      ];
    }
    case "portfolio":
      /* AI-03: the watchlist is read when the words ask about it — the list and each token's market. */
      if (intent.watchlist) return [{ name: "watchlist_read", input: {} }];
      return [{ name: "holdings_read", input: {} }, { name: "plans_read", input: {} }, { name: "activity_read", input: { limit: 5 } }];
    case "plans":
      return [{ name: "plans_read", input: {} }, { name: "monitoring_read", input: {} }];
    case "plan": {
      const input = intent.planId ? { planId: intent.planId } : first ? { symbol: first } : null;
      if (!input) return [{ name: "plans_read", input: {} }];
      return [{ name: "plan_read", input }, { name: "market_read_for_plan", input }];
    }
    case "results": {
      const input = intent.planId ? { planId: intent.planId } : first ? { symbol: first } : {};
      return [{ name: "results_read", input }, { name: "plans_read", input: {} }];
    }
    case "monitoring": {
      const input = context?.kind === "note" ? { inboxId: context.inboxId } : first ? { symbol: first } : {};
      return [{ name: "monitoring_read", input }, { name: "plan_read_for_note", input }];
    }
    case "compare": {
      const items = intent.compare.length > 0 ? intent.compare : first ? [first] : [];
      return items.length > 0 ? [{ name: "prepare_comparison", input: { items: items.slice(0, 4) } }] : [];
    }
    case "prepare_plan": {
      const query = first ?? null;
      if (!query && context?.kind === "plan") return [{ name: "prepare_plan_for_plan", input: { planId: context.planId } }];
      if (!query) return [];
      return [
        {
          name: "prepare_plan_draft",
          input: { query, riskUsd: intent.amounts.riskUsd, budgetUsd: intent.amounts.budgetUsd, entryUsd: intent.amounts.entryUsd, maxPriceUsd: intent.amounts.maxPriceUsd, invalidationUsd: intent.amounts.invalidationUsd, targetUsd: intent.amounts.targetUsd, horizonDays: intent.horizonDays, condition: intent.condition && Number.isFinite(intent.condition.threshold) ? { ...intent.condition, mode: "advisory", onUnknown: "warn" } : null },
        },
      ];
    }
    case "prepare_monitoring": {
      if (!intent.condition || !Number.isFinite(intent.condition.threshold)) return [];
      const condition = { ...intent.condition, mode: "advisory", onUnknown: "warn" };
      if (intent.planId) return [{ name: "prepare_monitoring_draft", input: { planId: intent.planId, condition } }];
      if (first) return [{ name: "prepare_monitoring_draft", input: { query: first, condition } }];
      return [];
    }
    case "prepare_trade":
    case "execute": {
      const trade = { side: intent.side ?? "BUY", amountUsd: intent.amounts.tradeUsd ?? intent.amounts.budgetUsd ?? null };
      if (first) return [{ name: "prepare_trade_draft", input: { query: first, ...trade } }];
      /* The mobile line's request 29: a plan's or a note's context names the asset *this* means — the plan's own, read first. */
      if (context?.kind === "plan") return [{ name: "prepare_trade_for_plan", input: { planId: context.planId, ...trade } }];
      if (context?.kind === "note") return [{ name: "prepare_trade_for_plan", input: { inboxId: context.inboxId, ...trade } }];
      return [];
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------ composite calls */

/**
 * A few calls need a read to decide the next one (a mint from a symbol, a
 * plan's asset for the market read); they are resolved here, in the service,
 * and still run the registered tools with validated input.
 */
async function runCall(call: ToolCall, ctx: ToolContext, intent: Intent): Promise<ToolRun[]> {
  if (call.name === "evidence_read_by_query") {
    const query = String(call.input.query ?? "");
    const resolved = await resolveAsset(ctx.readers, query);
    if (resolved.kind === "none") return [];
    return [await runTool("evidence_read", { mint: resolved.mint, window: call.input.window, symbol: resolved.symbol }, ctx)];
  }
  if (call.name === "market_read_for_plan" || call.name === "plan_read_for_note" || call.name === "prepare_plan_for_plan" || call.name === "prepare_trade_for_plan") {
    const planId = typeof call.input.planId === "string" ? call.input.planId : null;
    const symbol = typeof call.input.symbol === "string" ? call.input.symbol : null;
    const listed = await ctx.readers.plans(ctx.owner);
    let plan = planId ? listed.plans.find((entry) => entry.id === planId) ?? null : symbol ? listed.plans.find((entry) => entry.status === "active" && entry.asset.symbol.toLowerCase() === symbol.toLowerCase()) ?? listed.plans.find((entry) => entry.asset.symbol.toLowerCase() === symbol.toLowerCase()) ?? null : null;
    if (call.name === "plan_read_for_note" || (call.name === "prepare_trade_for_plan" && typeof call.input.inboxId === "string")) {
      const inboxId = typeof call.input.inboxId === "string" ? call.input.inboxId : null;
      const note = inboxId ? await ctx.readers.inboxNote(ctx.owner, inboxId) : null;
      const subjectId = note?.subject?.kind === "trading-plan" ? note.subject.id : null;
      plan = subjectId ? listed.plans.find((entry) => entry.id === subjectId) ?? null : plan;
      if (!plan) return [];
      if (call.name === "plan_read_for_note") return [await runTool("plan_read", { planId: plan.id }, ctx), await runTool("market_read", { query: plan.asset.mint }, ctx)];
    }
    if (!plan) return [];
    if (call.name === "prepare_trade_for_plan") {
      /* The wallet's own plan only: `listed` is this owner's plans, so another wallet's plan id resolves to nothing. */
      return [await runTool("prepare_trade_draft", { query: plan.asset.mint, side: call.input.side, amountUsd: call.input.amountUsd ?? null }, ctx)];
    }
    if (call.name === "prepare_plan_for_plan") {
      return [await runTool("prepare_plan_draft", { query: plan.asset.mint, riskUsd: intent.amounts.riskUsd, budgetUsd: intent.amounts.budgetUsd, entryUsd: intent.amounts.entryUsd, maxPriceUsd: intent.amounts.maxPriceUsd, invalidationUsd: intent.amounts.invalidationUsd, targetUsd: intent.amounts.targetUsd, horizonDays: intent.horizonDays, condition: null }, ctx)];
    }
    return [await runTool("market_read", { query: plan.asset.mint }, ctx)];
  }
  return [await runTool(call.name, call.input, ctx)];
}

/**
 * AI-03: one exchange's readers, each read made once — the tools resolve
 * the same asset and a warm-up asks the same sources, and every one of them
 * gets the first call's answer. Readers only read, so nothing here can repeat
 * a write; the memo lives for one question and is dropped with it.
 */
export function memoReaders(readers: AgentReaders): AgentReaders {
  const memo = new Map<string, Promise<unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(readers) as [string, (...args: unknown[]) => Promise<unknown>][]) {
    wrapped[name] = (...args: unknown[]) => {
      const key = `${name}:${JSON.stringify(args)}`;
      let pending = memo.get(key);
      if (!pending) {
        pending = read(...args);
        memo.set(key, pending);
      }
      return pending;
    };
  }
  return wrapped as AgentReaders;
}

/** The keyless sources the planned calls will read, by the call that reads them. */
const WARM: Readonly<Record<string, (readers: AgentReaders, mint: string, input: Record<string, unknown>) => Promise<unknown>>> = {
  dex_pairs_read: (readers, mint) => readers.dexPairs(mint),
  token_report_read: (readers, mint) => readers.tokenReport(mint),
  candles_read: (readers, mint, input) => readers.candles(mint, input.timeframe === "4h" || input.timeframe === "1d" ? input.timeframe : "1h"),
  meteora_pools_read: (readers, mint) => readers.pools(mint),
  launch_health_read: (readers, mint) => readers.launchHealth(mint),
  /* AI-09: the move's market beside it and both digests — the news reads are the store's, the pairs DexScreener's. */
  price_move_read: (readers, mint) => Promise.all([readers.dexPairs(mint), readers.dexPairs(mint === SOL_MINT ? CBBTC_MINT : SOL_MINT), readers.news(mint), readers.news(null)]),
  news_read: (readers, mint) => readers.news(mint),
};

/**
 * AI-03: the planned calls' public sources asked at once, before the tools
 * run one by one — through the exchange's memo, so each tool then takes the
 * answer already on its way and a question waits on its slowest source, not
 * on their sum. The paid evidence layer is never warmed: it is read only by
 * its own call. A warm-up's failure is the tool's to say; here it is ignored.
 */
function warmReads(calls: readonly ToolCall[], ctx: ToolContext): void {
  const query = calls.map((call) => (typeof call.input.query === "string" ? call.input.query : null)).find((value) => value !== null) ?? null;
  const warm = calls.filter((call) => WARM[call.name]);
  if (warm.length === 0) return;
  if (query === null) return;
  void resolveAsset(ctx.readers, query)
    .then((resolved) => {
      if (resolved.kind === "none") return;
      for (const call of warm) void WARM[call.name](ctx.readers, resolved.mint, call.input).catch(() => null);
    })
    .catch(() => null);
}

/** AI-03: Market Health speaks only of a Ryntra launch; for any other token its read is not part of the answer at all. */
function silentWhenEmpty(run: ToolRun): boolean {
  return !(run.tool === "launch_health_read" && run.outcome !== "ok");
}

/** A sentence the service adds when two reads meet: the market now against the plan's own bounds — a comparison of two read figures, never a new one. */
function crossNotes(runs: readonly ToolRun[], locale: Locale): ToolNote[] {
  const plan = runs.find((run) => run.tool === "plan_read" && run.outcome === "ok");
  const market = runs.find((run) => (run.tool === "market_read" || run.tool === "stock_read") && run.outcome === "ok" && run.facts.some((fact) => fact.key === "price"));
  if (!plan || !market) return [];
  const price = market.facts.find((fact) => fact.key === "price");
  const invalidation = plan.facts.find((fact) => fact.key === "plan.invalidation");
  const maxPrice = plan.facts.find((fact) => fact.key === "plan.maxPrice");
  if (!price || price.number === null || !invalidation || invalidation.number === null) return [];
  const notes: ToolNote[] = [];
  const below = price.number <= invalidation.number;
  notes.push({
    section: "meaning",
    cites: [price.cite, invalidation.cite],
    text: below
      ? w(locale, `The market price ${price.value} (${price.state}) is at or below your invalidation ${invalidation.value}: by your own rule the thesis is wrong at this price, and the Review refuses the plan's version here.`, `Ринкова ціна ${price.value} (${price.state === "current" ? "актуально" : "застаріло"}) на рівні або нижче твоєї інвалідації ${invalidation.value}: за твоїм же правилом теза хибна за цієї ціни, і Review тут відмовляє версії плану.`)
      : w(locale, `The market price ${price.value} (${price.state}) is above your invalidation ${invalidation.value}: the invalidation has not happened on this read.`, `Ринкова ціна ${price.value} (${price.state === "current" ? "актуально" : "застаріло"}) вище твоєї інвалідації ${invalidation.value}: на цьому читанні інвалідація не сталася.`),
  });
  if (maxPrice && maxPrice.number !== null && price.number > maxPrice.number) {
    notes.push({ section: "meaning", cites: [price.cite, maxPrice.cite], text: w(locale, `The market price ${price.value} is above your maximum ${maxPrice.value}: a buy at this price would not pass the plan.`, `Ринкова ціна ${price.value} вище твоєї максимальної ${maxPrice.value}: купівля за цією ціною не пройшла б план.`) });
  }
  return notes;
}

/* ------------------------------------------------------------ refusals */

function refusalTurnNotes(klass: "secret" | "execute", locale: Locale, hasDraft: boolean): ToolNote[] {
  if (klass === "secret") {
    return [
      { section: "observation", cites: [], text: w(locale, "Ryntra does not share keys, secrets, sessions, its own instructions or anything of another wallet — not to anyone, in any wording.", "Ryntra не розкриває ключі, секрети, сесії, власні інструкції чи будь-що іншого гаманця — нікому, за жодного формулювання.") },
      { section: "meaning", cites: [], text: w(locale, "What is yours here is read only through your own proven wallet; nothing else is reachable from this conversation.", "Те, що твоє, тут читається лише через твій підтверджений гаманець; ніщо інше з цієї розмови не досяжне.") },
      { section: "actions", cites: [], text: w(locale, "Ask about a market, an asset's evidence, your holdings, your plans or a note — that is what Ryntra reads.", "Спитай про ринок, докази щодо активу, свої активи, плани чи нотатку — це те, що Ryntra читає.") },
    ];
  }
  if (klass === "execute") {
    return [
      { section: "observation", cites: [], text: w(locale, "Ryntra does not buy, sell, swap, send or sign — there is no such tool. The final action is always yours: the Review, your confirmation and your wallet's signature.", "Ryntra не купує, не продає, не обмінює, не відправляє і не підписує — такого інструмента нема. Остання дія завжди твоя: Review, твоє підтвердження і підпис твого гаманця.") },
      { section: "meaning", cites: [], text: hasDraft ? w(locale, "What Ryntra can do is prepare the trade for the Review — and it has, below.", "Ryntra може підготувати угоду для Review — і підготувала, нижче.") : w(locale, "Name the asset and, if you like, the sum, and Ryntra prepares the trade for the Review.", "Назви актив і, за бажання, суму — і Ryntra підготує угоду для Review.") },
    ];
  }
  /* AI-06c: «help» and an unplaced question are a talk (`talk.ts`) and never reach here. */
  return [];
}

/* ------------------------------------------------------------ the credits (AI-04) */

/** Whose credits this wallet spends now — its own, or its account's (moving its own there at the first call after the link). */
export async function creditsContextFor(deps: Pick<AgentDeps, "store" | "credits">, owner: string, nowMs: number): Promise<CreditsContext | null> {
  if (!deps.credits) return null;
  const resolved = await resolveHolder(deps.store, owner, deps.credits.lookup, nowMs).catch(() => ({ holder: walletHolder(owner) }));
  return { holder: resolved.holder, config: deps.credits.config };
}

/* ------------------------------------------------------------ the session */

export async function openAgentSession(
  deps: AgentDeps,
  input: Readonly<{ owner: string; locale: Locale; context: AgentContext | null; sessionId?: string; fresh?: boolean }>,
): Promise<Readonly<{ ok: true; response: AgentSessionResponse; opened: boolean }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "UNAVAILABLE" }>> {
  const nowMs = (deps.now ?? Date.now)();
  const opened = await openSession(deps.store, { owner: input.owner, locale: input.locale, context: input.context, sessionId: input.sessionId, fresh: input.fresh, nowMs, newId: deps.newSessionId });
  if (!opened.ok) return opened;
  const budget = await readBudgetState(deps.store, input.owner, deps.budget, nowMs, await creditsContextFor(deps, input.owner, nowMs));
  return { ok: true, opened: opened.opened, response: { session: projectSession(opened.record), budget, suggestions: suggestionsFor(opened.record.context, input.locale) } };
}

export async function readAgentSession(deps: AgentDeps, owner: string, sessionId: string): Promise<AgentSessionResponse | null> {
  const nowMs = (deps.now ?? Date.now)();
  const record = await readSession(deps.store, owner, sessionId, nowMs);
  if (!record) return null;
  return { session: projectSession(record), budget: await readBudgetState(deps.store, owner, deps.budget, nowMs, await creditsContextFor(deps, owner, nowMs)), suggestions: suggestionsFor(record.context, record.locale) };
}

/** 1.43.0: the wallet's conversations within their retention — first question, dates, expiry; never an answer. */
export async function listAgentSessions(deps: AgentDeps, owner: string): Promise<AgentSessionListResponse> {
  const nowMs = (deps.now ?? Date.now)();
  const records = await listSessions(deps.store, owner, nowMs);
  /* A conversation with no question yet is not a conversation to go back to. */
  return { sessions: records.filter((record) => record.turnCount > 0).map(summariseSession), retentionDays: AGENT_SESSION_RETENTION_DAYS };
}

/* ------------------------------------------------------------ the message */

export type MessageResult = Readonly<{ ok: true; response: AgentMessageResponse }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "AGENT_BUSY" | "AGENT_BUDGET_EXHAUSTED" | "UNAVAILABLE"; reason: string }>;

/**
 * One question's allowance: reserved once, at the first call that needs the
 * model; both calls of a question ride on it. AI-04: the question's price in
 * credits is held with it under the key `idem`, kept only when the model's
 * words were used (`charge`), given back otherwise (`forgive`, or `refund`
 * with the call when the provider was never reached).
 */
type Taken = Readonly<{ ok: true; refund: () => Promise<void>; release: () => Promise<void>; charge: () => Promise<void>; forgive: () => Promise<void> }>;
type Meter = Readonly<{
  reserve(idem: string): Promise<Taken | Readonly<{ ok: false; code: "AGENT_BUDGET_EXHAUSTED" | "AGENT_BUSY" | "UNAVAILABLE"; reason: string; credits?: string }>>;
}>;

type Exchange = Readonly<{
  /** Who pays: the proven wallet, or a guest's digest. */
  payer: string;
  /** The tools' owner: the wallet — or, for a guest, the digest, which no reader of someone's own answers. */
  owner: string;
  sessionId: string;
  text: string;
  locale: Locale;
  context: AgentContext | null;
  guest: boolean;
  meter: Meter;
  /** AI-06c: the conversation's last lines, for a talk to answer in place — a wallet's session only; a guest's is kept nowhere. */
  recent?: readonly Readonly<{ role: "person" | "ryntra"; text: string }>[];
  /** AI-06: the wallet's answers to «Знайомство», as the model is told them; a guest has none. */
  reader?: Reader | null;
  /** AI-18: «Про мене» and the notes the person's own words left — untrusted words about how to talk to them; a guest has none. */
  memory?: ReaderMemory | null;
  /** AI-18: the person typed the words — «запам'ятай» is a talk only then (the route keeps the note only then). */
  typed?: boolean;
  /** AI-18: whether Ryntra keeps what the person says about themselves (the memory's switch); absent — it does. */
  noticing?: boolean;
}>;

type ExchangeResult =
  /* `settle(delivered)` — the allowance settled once the answer is kept: credits are kept only for an answer the person gets. */
  | Readonly<{ ok: true; person: AgentTurn; ryn: AgentTurn; steps: readonly string[]; drafts: readonly AgentDraftCard[]; needsWallet: boolean; settle: (delivered: boolean) => Promise<void> }>
  | Readonly<{ ok: false; code: "AGENT_BUSY"; reason: string }>;

/** A guest's question about something of one's own: the way to connect a wallet, said plainly. */
function needsWalletNotes(locale: Locale): ToolNote[] {
  return [
    { section: "observation", cites: [], text: w(locale, "This is a question about what is yours — a portfolio, a plan or a trade. Without a wallet Ryntra does not see it.", "Це питання про твоє — портфель, план чи угоду. Без гаманця Ryntra цього не бачить.") },
    { section: "actions", cites: [], text: w(locale, "Connect a wallet and confirm it with one signature: Ryntra then reads what is yours and nothing else.", "Підключи гаманець і підтверди його одним підписом — тоді Ryntra читатиме твоє і нічого іншого.") },
  ];
}

const GUEST_EVIDENCE_NOTE = (locale: Locale): ToolNote => ({ section: "risks", cites: [], text: w(locale, "Holders, flows and authorities are read once a wallet is connected; here — the market's own figures only.", "Тримачів, потоки й права Ryntra читає після підключення гаманця; тут — лише ринкові цифри.") });

/**
 * One exchange — the person's words into two turns — for a wallet or a
 * guest. The server decides the tools; the model may read an unplaced
 * question and words the answer; nothing here signs, sends or spends.
 */
async function runExchange(deps: AgentDeps, input: Exchange): Promise<ExchangeResult> {
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  const locale = input.locale;
  const text = input.text.trim().slice(0, 2000);
  const readers = memoReaders(input.guest ? guestReaders(deps.readers) : deps.readers);
  const citations = new CitationBook();
  const ctx: ToolContext = { owner: input.owner, locale, nowMs, readers, citations, newDraftId: deps.newDraftId ?? newDraftId };
  const steps: string[] = [];
  /* The two turns' ids first: the receipts of the question name the assistant's turn they answered. */
  const personId = (deps.newTurnId ?? newTurnId)();
  const turnId = (deps.newTurnId ?? newTurnId)();
  const safetyKey = safetyIdentifier(input.payer);

  /* The allowance, taken once at the first call that needs it; `reached` decides whether it is given back, `charged` whether the credits are kept. */
  let reservation = null as Taken | null;
  let refused = null as Readonly<{ code: "AGENT_BUDGET_EXHAUSTED" | "AGENT_BUSY" | "UNAVAILABLE"; reason: string; credits?: string }> | null;
  let reached = false;
  let charged = false;
  const allowance = async (): Promise<boolean> => {
    if (reservation) return true;
    if (refused) return false;
    const taken = await input.meter.reserve(`q:${turnId}`);
    if (!taken.ok) {
      refused = taken;
      steps.push(taken.code === "AGENT_BUDGET_EXHAUSTED" ? "budget_exhausted" : taken.code === "AGENT_BUSY" ? "busy" : "budget_unavailable");
      if (taken.credits) steps.push(`credits:${taken.credits}`);
      return false;
    }
    reservation = taken;
    return true;
  };
  const receipt = async (task: ModelTask, call: Readonly<{ model: string; usage: ModelUsage; latencyMs: number }>, outcome: ModelOutcome) => {
    await writeReceipt(deps.store, { owner: input.payer, sessionId: input.sessionId, turnId, model: call.model, promptVersion: promptVersionOf(task), task, tokens: call.usage, latencyMs: call.latencyMs, outcome, at }).catch(() => null);
  };
  let settled = false;
  const settle = async () => {
    if (!reservation || settled) return;
    settled = true;
    if (!reached) await reservation.refund();
    else if (charged) await reservation.charge();
    else await reservation.forgive();
    await reservation.release();
  };
  let handed = false;

  try {
    let intent = parseIntent(text, input.context);
    steps.push(`question_class:${intent.class}`);
    /* AI-06c: a greeting, a thanks, «who are you» or a definition is a talk from the words alone — no read of its class is needed. */
    /* On a token, a plan, a note or the portfolio a bare question is about that subject (AI-06c critic). */
    const onSubject = input.context !== null && input.context.kind !== "page";
    /*
     * AI-18: «запам'ятай…» from a wallet is kept by the message route; here it is answered as a talk, never read as a
     * market question. A sentence about oneself with no question in it («я торгую мемкоїнами й не люблю плече») is
     * kept the same way while the noticing is on — and answered as a person would, not with a card of the market.
     */
    const noticed = !input.guest && input.typed === true ? noticeInMessage(text) : [];
    const aboutSelf = noticed.some((item) => item.source === "asked") || (input.noticing !== false && noticed.length > 0 && !/[?？]/u.test(text));
    const spoken = aboutSelf ? "remember" : talkKindOf(text, intent, onSubject);

    /* A question the parser could not place: the everyday model reads its class and the symbols named — held to the words. */
    if (spoken === null && intent.class === "unknown" && deps.model?.composeIntent && deps.budget.modelEnabled) {
      if (await allowance()) {
        const read = await deps.model.composeIntent({ text, locale, contextKind: input.context?.kind ?? null }, safetyKey);
        if (read.ok || read.reached) reached = true;
        await receipt("intent", read, read.ok ? "ok" : read.outcome);
        if (read.ok) {
          const merged = mergeModelIntent(intent, read.intent, text, input.context);
          if (merged.class !== intent.class) steps.push(`model_intent:${merged.class}`);
          intent = merged;
        } else steps.push(`model_intent_${read.outcome}`);
      } else if (refused?.code === "AGENT_BUSY" && !input.guest) return { ok: false, code: "AGENT_BUSY", reason: refused.reason };
    }

    /* AI-06c: «що ти думаєш про BONK?» reads as help by its words, but names a token: the reads answer it, as on a token's own page. */
    if (spoken === null && intent.class === "help" && (intent.symbols.length > 0 || intent.mints.length > 0 || input.context?.kind === "asset")) {
      intent = { ...intent, class: "market" };
      steps.push("help_names_a_token");
    }
    /* AI-06c: what no tool answers is a talk — «who are you» as the model read it, and anything still unplaced. */
    const talk: TalkKind | null = spoken ?? (intent.class === "help" ? "about" : intent.class === "unknown" ? "chat" : null);
    if (talk !== null) {
      steps.push(`talk:${talk}`);
      const offered = startersFor(input.guest).map((starter) => ({ id: starter.id, text: locale === "uk" ? starter.uk : starter.en }));
      let reply: string[] | null = null;
      let picked: readonly string[] | null = null;
      let why: TalkFallback = "absent";
      if (deps.model?.composeTalk && deps.budget.modelEnabled) {
        if (await allowance()) {
          const said = await deps.model.composeTalk({ locale, kind: talk, guest: input.guest, recent: input.recent ?? [], text, starters: offered, memory: input.guest ? null : (input.memory ?? null) }, safetyKey);
          if (said.ok || said.reached) reached = true;
          await receipt("talk", said, said.ok ? "ok" : said.outcome);
          if (said.ok) {
            const verified = verifyTalk(said.talk.reply, text, talk === "remember" ? "chat" : talk);
            if (verified.dropped > 0) steps.push("model_sentences_dropped");
            /* The judge: the rubric's yes/no on each sentence that stood (`model.ts`); a sentence it flags is not said, a reply it could not judge is not said at all. */
            let blocks = verified.answered ? [...verified.kept] : [];
            let answered = verified.answered && blocks.length > 0;
            if (answered) {
              const judged = deps.model.judgeTalk ? await deps.model.judgeTalk({ locale, sentences: blocks }, safetyKey) : null;
              if (judged) await receipt("talk_check", judged, judged.ok ? "ok" : judged.outcome);
              if (!judged || !judged.ok) {
                steps.push(judged ? `talk_check_${judged.outcome}` : "talk_check_absent");
                answered = false;
              } else {
                /* A repeated index cannot clear what it flagged: any rule but «none» wins for its index. */
                const rules = new Map<number, string>();
                for (const verdict of judged.check.verdicts) {
                  const prior = rules.get(verdict.i);
                  if (prior === undefined || prior === "none") rules.set(verdict.i, verdict.rule);
                }
                /* A sentence with no verdict is not cleared. */
                const clear = blocks.map((_, i) => rules.get(i) === "none");
                const flagged = [...new Set(blocks.map((_, i) => rules.get(i) ?? "missing").filter((rule) => rule !== "none"))];
                for (const rule of flagged) steps.push(`talk_check:${rule}`);
                answered = clear.slice(0, verified.firstBlocks).every(Boolean);
                blocks = blocks.filter((_, i) => clear[i]);
              }
            }
            /* Kept — and paid — only when the reply's first sentence, the answer itself, stood both checks: a reply without it, or one the server had to say itself, costs nothing. */
            if (answered && blocks.length > 0) {
              reply = blocks;
              picked = said.talk.starters;
              charged = true;
            } else why = "dropped";
          } else steps.push(`model_${said.outcome}`);
        } else {
          if (refused?.code === "AGENT_BUSY" && !input.guest) return { ok: false, code: "AGENT_BUSY", reason: refused.reason };
          /* «Spent» only for the guest's own day, or the wallet's free credits with no shown price the balance could pay — never a busy hold or the deployment's ceiling (AI-06a). */
          const spent = refused?.code === "AGENT_BUDGET_EXHAUSTED" && (input.guest ? refused.reason.startsWith("A guest's") : refused.credits === "PRICE_NOT_SHOWN" || refused.credits === "CREDITS_EXHAUSTED");
          why = spent ? "spent" : "absent";
        }
      }
      if (reply === null) steps.push(`talk_template:${why}`);
      const answer = talkAnswer(reply ?? talkTemplate(talk, locale, why, input.guest, text), pickStarters(picked, talk, input.guest, locale));
      const person: AgentTurn = { id: personId, role: "person", at, text, class: "help", answer: null, cards: [], citations: [], handoffs: [], tools: [], composedBy: null, refusal: null, brief: null, critic: null };
      const ryn: AgentTurn = { id: turnId, role: "ryn", at, text: talkHeadline(talk, locale), class: "help", answer, cards: [], citations: [], handoffs: [], tools: [], composedBy: reply ? "model" : "deterministic", refusal: null, brief: null, critic: null };
      handed = true;
      return {
        ok: true,
        person,
        ryn,
        steps,
        drafts: [],
        needsWallet: false,
        settle: async (delivered) => {
          if (!delivered) charged = false;
          await settle();
        },
      };
    }

    /* A guest is answered on the market alone; a question about one's own says how to connect a wallet. */
    const needsWallet = input.guest && !GUEST_CLASSES.has(intent.class);
    const runs: ToolRun[] = [];
    if (intent.class !== "secret" && !needsWallet) {
      const calls = planTools(intent, input.context).map((call) => (input.guest && call.name === "evidence_read_by_query" ? null : call)).filter((call): call is ToolCall => call !== null && (!input.guest || GUEST_TOOLS.has(call.name)));
      /* A guest's evidence question reads the market of its subject: the deeper reads need a wallet. */
      if (input.guest && intent.class === "evidence") {
        const subject = intent.symbols[0] ?? intent.mints[0] ?? contextMint(input.context);
        if (subject && !calls.some((call) => call.name === "market_read")) calls.push({ name: "market_read", input: { query: subject } });
      }
      warmReads(calls, ctx);
      for (const call of calls) runs.push(...(await runCall(call, ctx, intent)).filter(silentWhenEmpty));
    }
    /* A market question whose asset is a stock is a stock question. */
    const klass: AgentQuestionClass = intent.class === "market" && runs.some((run) => run.cards.some((card) => card.kind === "stock")) ? "stock" : intent.class;
    const finalIntent: Intent = { ...intent, class: klass };
    const drafts = runs.map((run) => run.draft).filter((draft): draft is AgentDraftCard => draft !== null && (draft.kind === "planDraft" || draft.kind === "monitoringDraft" || draft.kind === "tradeDraft"));
    /* A guest who asks to trade hears first that Ryntra never trades — a wallet would not change that — then the way to connect. */
    const guestTrade = needsWallet && (klass === "execute" || klass === "prepare_trade");
    const extra = [...crossNotes(runs, locale), ...(guestTrade ? [refusalTurnNotes("execute", locale, false)[0], ...needsWalletNotes(locale).filter((note) => note.section === "actions")] : needsWallet ? needsWalletNotes(locale) : klass === "secret" || klass === "execute" ? refusalTurnNotes(klass, locale, drafts.some((draft) => draft.kind === "tradeDraft")) : [])];
    if (input.guest && klass === "evidence" && runs.length > 0) extra.push(GUEST_EVIDENCE_NOTE(locale));
    if (!needsWallet && klass === "prepare_monitoring" && runs.length === 0) extra.push({ section: "meaning", cites: [], text: w(locale, "A monitoring rule needs a measurable figure — a 24h volume, a share of the top ten holders, a holder count, an authority — and the asset or plan it stands on. Say, for example: alert me when BONK's 24h volume drops below $1M.", "Правилу Нагляду потрібна вимірювана цифра — обсяг за 24 год, частка десяти найбільших тримачів, кількість тримачів, право емісії — і актив чи план, на якому воно стоїть. Скажи, наприклад: сповісти мене, коли обсяг BONK за 24 год впаде нижче $1M.") });
    if (!needsWallet && klass === "prepare_plan" && runs.length === 0) extra.push({ section: "meaning", cites: [], text: w(locale, "A plan needs an asset: name a token or a stock (SOL, BONK, NVDAx) with the most you are willing to lose, and Ryntra drafts it.", "Плану потрібен актив: назви токен чи акцію (SOL, BONK, NVDAx) і скільки ти готовий втратити — і Ryntra складе чернетку.") });
    /* The service's own sentences first: the plan's bound against the market (two reads met) outranks any one tool's in a section that fills up (AI-09). */
    if (extra.length > 0) runs.unshift({ tool: "service", kind: "research", outcome: "ok", state: null, facts: [], notes: extra, cards: [], handoffs: [], draft: null });
    if (runs.some((run) => run.kind === "research" && run.outcome === "ok" && run.facts.length > 0)) steps.push("research_returned");
    for (const draft of drafts) steps.push(draft.kind === "planDraft" ? "plan_draft_prepared" : draft.kind === "monitoringDraft" ? "monitoring_draft_prepared" : "trade_draft_prepared");
    if (needsWallet) steps.push("guest_needs_wallet");

    const packet: AnswerPacket = { intent: finalIntent, personText: text, runs, citations, locale, reader: input.guest ? null : (input.reader ?? null), memory: input.guest ? null : (input.memory ?? null) };
    /* A guest's question about one's own is answered by the way to connect a wallet, in the register of a refusal: no "not enough data", no generic filler. */
    const composedFrom: AnswerPacket = needsWallet ? { ...packet, intent: { ...finalIntent, class: "help" } } : packet;

    /* The words: the everyday model under the allowance where the deployment switched it on and the question is one the model improves; deterministic otherwise. */
    let answer: AgentAnswer = composeDeterministic(composedFrom);
    let composedBy: "model" | "deterministic" = "deterministic";
    const modelWorthy = deps.model !== null && deps.budget.modelEnabled && !needsWallet && !["secret", "help", "unknown"].includes(klass) && runs.some((run) => run.facts.length > 0);
    if (modelWorthy && deps.model) {
      if (await allowance()) {
        const composed = await deps.model.compose(packet, safetyKey);
        if (composed.ok || composed.reached) reached = true;
        await receipt("answer", composed, composed.ok ? "ok" : composed.outcome);
        if (composed.ok) {
          const verified = verifyAnswer(composed.answer, packet);
          answer = verified.answer;
          composedBy = "model";
          /* Kept only when a sentence of the model's stood: an answer the verifier rebuilt from the tools costs nothing. */
          charged = verified.kept > 0;
          if (verified.dropped > 0) steps.push("model_sentences_dropped");
          if (verified.fellBack.length > 0) steps.push("model_section_from_tools");
        } else steps.push(`model_${composed.outcome}`);
      } else {
        if (refused?.code === "AGENT_BUSY" && !input.guest) return { ok: false, code: "AGENT_BUSY", reason: refused.reason };
      }
    }

    /*
     * The formats, when the words asked for one. The same runs carry them: no
     * extra read, no extra call, no second budget — and the six-section answer
     * is written beside them, so a client that knows nothing of either still
     * reads a whole answer.
     */
    const wantsLens = needsWallet ? null : finalIntent.lens;
    const lensReads = wantsLens ? projectReads(runs, finalIntent.planId ?? (input.context?.kind === "plan" ? input.context.planId : null)) : null;
    const brief = wantsLens === "brief" && lensReads ? composeBrief(lensReads, locale) : null;
    const critic = wantsLens === "critic" && lensReads ? composeCritic(lensReads, locale) : null;
    if (wantsLens) steps.push(`lens:${wantsLens}`);

    /* The turns. */
    const person: AgentTurn = { id: personId, role: "person", at, text, class: klass, answer: null, cards: [], citations: [], handoffs: [], tools: [], composedBy: null, refusal: null, brief: null, critic: null };
    const cards: AgentCard[] = runs.flatMap((run) => run.cards).slice(0, AGENT_CARDS_MAX);
    const handoffs = dedupeHandoffs(runs.flatMap((run) => run.handoffs)).slice(0, 6);
    const tools: AgentToolOutcome[] = runs.filter((run) => run.tool !== "service").map((run) => ({ tool: run.tool, kind: run.kind, outcome: run.outcome, state: run.state, latencyMs: 0 })).slice(0, 16);
    const refusal = klass === "secret" ? { code: "secret" as const, reason: w(locale, "Ryntra does not share keys, secrets, sessions or another wallet's data.", "Ryntra не розкриває ключі, секрети, сесії чи дані іншого гаманця.") } : klass === "execute" || guestTrade ? { code: "execute" as const, reason: w(locale, "Ryntra does not execute; the Review, your confirmation and your signature do.", "Ryntra не виконує; виконують Review, твоє підтвердження і твій підпис.") } : null;
    const ryn: AgentTurn = { id: turnId, role: "ryn", at, text: needsWallet ? w(locale, "Connect a wallet for this", "Для цього підключи гаманець") : headline(packet), class: klass, answer, cards, citations: citations.list().slice(0, AGENT_CITATIONS_MAX), handoffs, tools, composedBy, refusal, brief, critic };
    handed = true;
    return {
      ok: true,
      person,
      ryn,
      steps,
      drafts,
      needsWallet,
      settle: async (delivered) => {
        if (!delivered) charged = false;
        await settle();
      },
    };
  } finally {
    /* Refused, busy or thrown: settled here; an answer handed out is settled by its caller once it is kept. */
    if (!handed) await settle();
  }
}

export async function handleAgentMessage(deps: AgentDeps, input: Readonly<{ owner: string; sessionId: string; text: string; locale: Locale; acceptCredits?: number | null; typed?: boolean }>): Promise<MessageResult> {
  const nowMs = (deps.now ?? Date.now)();
  const session = await readSession(deps.store, input.owner, input.sessionId, nowMs);
  if (!session) return { ok: false, code: "AGENT_SESSION_NOT_FOUND", reason: "No session of this wallet has that id." };
  const credits = await creditsContextFor(deps, input.owner, nowMs);
  const meter: Meter = {
    async reserve(idem) {
      const taken = await reserveCall(deps.store, input.owner, deps.budget, nowMs, credits ? { context: credits, action: "question", acceptCredits: input.acceptCredits ?? null, idem } : null);
      return taken.ok ? { ok: true, refund: taken.refund, release: taken.release, charge: taken.charge, forgive: taken.forgive } : taken;
    },
  };
  /* AI-06c: the last lines of this conversation, for a talk — the person's words and Ryntra's first sentence, never a card. */
  const recent = session.turns.slice(-4).map((turn) => ({ role: turn.role === "person" ? ("person" as const) : ("ryntra" as const), text: turn.role === "person" ? turn.text : [turn.text, ...(turn.answer?.observation ?? []).slice(0, 2).map((sentence) => sentence.text)].join(" ") }));
  /* AI-06: «Знайомство» shapes the words only; a store that does not answer leaves the answer as it was for anyone. */
  const reader = readerOf(profileOf(await readProfileRecord(deps.store, input.owner).catch(() => null)));
  /* AI-18: what the person told Ryntra about themselves — the same «only the words» as the reader; a store that does not answer leaves it out. */
  const kept = await readMemoryRecord(deps.store, input.owner).catch(() => null);
  const memory = readerMemory(kept);
  const exchange = await runExchange(deps, { payer: input.owner, owner: input.owner, sessionId: session.id, text: input.text, locale: input.locale, context: session.context, guest: false, meter, recent, reader, memory, typed: input.typed === true, noticing: kept?.noticing ?? true });
  if (!exchange.ok) return exchange;

  let written = null as Awaited<ReturnType<typeof appendTurns>> | null;
  try {
    for (const draft of exchange.drafts) await storeDraft(deps.store, { owner: input.owner, sessionId: session.id, turnId: exchange.ryn.id, draft, nowMs });
    written = await appendTurns(deps.store, session, { turns: [exchange.person, exchange.ryn], steps: exchange.steps, nowMs });
    if (!written) {
      const again = await readSession(deps.store, input.owner, input.sessionId, nowMs);
      written = again ? await appendTurns(deps.store, again, { turns: [exchange.person, exchange.ryn], steps: exchange.steps, nowMs }) : null;
    }
  } finally {
    /* An answer that was not kept costs nothing: the credits come back, the lease goes back either way. */
    await exchange.settle(Boolean(written));
  }
  if (!written) return { ok: false, code: "UNAVAILABLE", reason: "The session could not be written; ask again." };
  const budget = await readBudgetState(deps.store, input.owner, deps.budget, nowMs, credits);
  return { ok: true, response: { sessionId: session.id, person: exchange.person, ryn: exchange.ryn, budget } };
}

/**
 * 1.43.0: a guest's question — no wallet, no session, nothing stored but the
 * meter. `guest` is the digest of the request's address (`guestKeyFor`).
 * Over the guest's day the answer is still given, composed from the reads.
 */
export async function handleGuestMessage(deps: AgentDeps, input: Readonly<{ guest: string; text: string; locale: Locale; context: AgentContext | null }>): Promise<Readonly<{ ok: true; response: AgentGuestResponse }> | Readonly<{ ok: false; code: "UNAVAILABLE"; reason: string }>> {
  const nowMs = (deps.now ?? Date.now)();
  /* A guest's context is an asset or a page; anything of someone's own is dropped before it is read. */
  const context = input.context && (input.context.kind === "asset" || input.context.kind === "page") ? input.context : null;
  const meter: Meter = {
    async reserve() {
      const taken = await reserveGuestCall(deps.store, input.guest, deps.budget, nowMs);
      /* A guest pays no credits: a few model answers a day by the request's address, nothing more. */
      return taken.ok ? { ok: true, refund: taken.refund, release: async () => undefined, charge: async () => undefined, forgive: async () => undefined } : taken;
    },
  };
  const exchange = await runExchange(deps, { payer: input.guest, owner: input.guest, sessionId: "guest:none", text: input.text, locale: input.locale, context, guest: true, meter });
  if (!exchange.ok) return { ok: false, code: "UNAVAILABLE", reason: exchange.reason };
  await exchange.settle(true);
  const day = await readGuestAllowance(deps.store, input.guest, deps.budget, nowMs);
  return { ok: true, response: { person: exchange.person, ryn: exchange.ryn, guest: { day, model: deps.model !== null && deps.budget.modelEnabled ? "configured" : "absent", needsWallet: exchange.needsWallet } } };
}

function dedupeHandoffs(handoffs: readonly AgentHandoff[]): AgentHandoff[] {
  const seen = new Set<string>();
  const out: AgentHandoff[] = [];
  for (const handoff of handoffs) {
    if (seen.has(handoff.href)) continue;
    seen.add(handoff.href);
    out.push(handoff);
  }
  /* One primary at most: the first that claims it. */
  let primarySeen = false;
  return out.map((handoff) => {
    if (handoff.primary && !primarySeen) {
      primarySeen = true;
      return handoff;
    }
    return { ...handoff, primary: false };
  });
}

export type { AgentSessionRecord };
