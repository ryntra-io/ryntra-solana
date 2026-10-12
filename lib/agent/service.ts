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
 */

import type { AgentAnswer, AgentCard, AgentContext, AgentDraftCard, AgentHandoff, AgentMessageResponse, AgentQuestionClass, AgentSessionResponse, AgentToolOutcome, AgentTurn } from "../api/v1/contract.ts";
import { AGENT_CARDS_MAX, AGENT_CITATIONS_MAX } from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";
import { composeDeterministic, headline, verifyAnswer, type AnswerPacket } from "./answer.ts";
import { readBudgetState, reserveCall, writeReceipt, type AgentBudgetConfig } from "./budget.ts";
import { newDraftId, storeDraft } from "./drafts.ts";
import { parseIntent, type Intent } from "./intent.ts";
import { composeBrief } from "./lens/brief.ts";
import { composeCritic } from "./lens/critic.ts";
import { projectReads } from "./lens/reads.ts";
import { AGENT_PROMPT_VERSION, safetyIdentifier, type AgentModel } from "./model.ts";
import { CitationBook, type Locale } from "./provenance.ts";
import { appendTurns, newTurnId, openSession, projectSession, readSession, type AgentSessionRecord } from "./session.ts";
import { suggestionsFor } from "./suggestions.ts";
import { resolveAsset, type AgentReaders } from "./tools/readers.ts";
import { runTool } from "./tools/registry.ts";
import type { ToolContext, ToolNote, ToolRun } from "./tools/types.ts";

export type AgentDeps = Readonly<{
  store: GuardStore;
  readers: AgentReaders;
  /** The configured model, or null: every answer is then deterministic and nothing is spent. */
  model: AgentModel | null;
  budget: AgentBudgetConfig;
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
      const calls: ToolCall[] = queries.slice(0, 2).map((query) => ({ name: "market_read", input: { query } }));
      if (calls.length === 0 && first) calls.push({ name: "market_read", input: { query: first } });
      if (first && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(first)) calls.push({ name: "plan_read", input: { symbol: first } });
      /* Why it moves: the day's flows beside the price — one evidence read, through the layer's own budget. */
      if (first && intent.movement) calls.push({ name: "evidence_read_by_query", input: { query: first, window: "24h" } });
      return calls;
    }
    case "evidence": {
      if (!first) return [];
      return [
        { name: "market_read", input: { query: first } },
        { name: "evidence_read_by_query", input: { query: first, window: "now" } },
        { name: "evidence_read_by_query", input: { query: first, window: intent.window && intent.window !== "now" ? intent.window : "24h" } },
      ];
    }
    case "portfolio":
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
      /* A plan's or a note's context names the asset *this* means — the plan's own, read first. */
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

/* ------------------------------------------------------------ refusals and the words for the classes without tools */

function refusalTurnNotes(klass: AgentQuestionClass, locale: Locale, hasDraft: boolean): ToolNote[] {
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
  if (klass === "help") {
    return [
      { section: "observation", cites: [], text: w(locale, "Ryntra researches and prepares; it never executes. It reads the Spot catalogue, the stock desk, the evidence layer, your holdings, plans, history, watchlist and monitoring notes — through the same reads the pages use, with the source and the time beside every figure.", "Ryntra досліджує і готує; ніколи не виконує. Вона читає каталог Spot, стіл акцій, шар доказів, твої активи, плани, історію, список спостереження і нотатки Нагляду — тими ж читаннями, що й сторінки, з джерелом і часом біля кожної цифри.") },
      { section: "meaning", cites: [], text: w(locale, "Ask in your own words: what changed in my portfolio; why is SOL moving; what am I actually buying with OPENAI; compare NVDAx and NVDAon; prepare a SOL plan with $50 max risk; why can't this trade pass my plan.", "Питай своїми словами: що змінилось у моєму портфелі; чому SOL рухається; що я насправді купую з OPENAI; порівняй NVDAx і NVDAon; підготуй план на SOL з максимальним ризиком $50; чому ця угода не проходить мій план.") },
      { section: "actions", cites: [], text: w(locale, "A prepared plan opens in the builder, a prepared trade opens the Spot ticket, a monitoring rule goes into a new version of your plan — you decide and sign; Ryntra saves nothing.", "Підготовлений план відкривається у конструкторі, підготовлена угода — у тікеті Spot, правило Нагляду лягає новою версією твого плану — вирішуєш і підписуєш ти; Ryntra нічого не зберігає.") },
    ];
  }
  return [
    { section: "observation", cites: [], text: w(locale, "Ryntra could not place that question on anything it reads.", "Ryntra не змогла співвіднести це питання з тим, що читає.") },
    { section: "meaning", cites: [], text: w(locale, "Name an asset (SOL, BONK, NVDAx), ask about your portfolio or plans, or ask what Ryntra can do.", "Назви актив (SOL, BONK, NVDAx), спитай про свій портфель чи плани або спитай, що вміє Ryntra.") },
  ];
}

/* ------------------------------------------------------------ the session */

export async function openAgentSession(
  deps: AgentDeps,
  input: Readonly<{ owner: string; locale: Locale; context: AgentContext | null; sessionId?: string }>,
): Promise<Readonly<{ ok: true; response: AgentSessionResponse; opened: boolean }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "UNAVAILABLE" }>> {
  const nowMs = (deps.now ?? Date.now)();
  const opened = await openSession(deps.store, { owner: input.owner, locale: input.locale, context: input.context, sessionId: input.sessionId, nowMs, newId: deps.newSessionId });
  if (!opened.ok) return opened;
  const budget = await readBudgetState(deps.store, input.owner, deps.budget, nowMs);
  return { ok: true, opened: opened.opened, response: { session: projectSession(opened.record), budget, suggestions: suggestionsFor(opened.record.context, input.locale) } };
}

export async function readAgentSession(deps: AgentDeps, owner: string, sessionId: string): Promise<AgentSessionResponse | null> {
  const nowMs = (deps.now ?? Date.now)();
  const record = await readSession(deps.store, owner, sessionId);
  if (!record) return null;
  return { session: projectSession(record), budget: await readBudgetState(deps.store, owner, deps.budget, nowMs), suggestions: suggestionsFor(record.context, record.locale) };
}

/* ------------------------------------------------------------ the message */

export type MessageResult = Readonly<{ ok: true; response: AgentMessageResponse }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "AGENT_BUSY" | "AGENT_BUDGET_EXHAUSTED" | "UNAVAILABLE"; reason: string }>;

export async function handleAgentMessage(deps: AgentDeps, input: Readonly<{ owner: string; sessionId: string; text: string; locale: Locale }>): Promise<MessageResult> {
  const nowMs = (deps.now ?? Date.now)();
  const session = await readSession(deps.store, input.owner, input.sessionId);
  if (!session) return { ok: false, code: "AGENT_SESSION_NOT_FOUND", reason: "No session of this wallet has that id." };
  const locale = input.locale;
  const text = input.text.trim().slice(0, 2000);
  const intent = parseIntent(text, session.context);
  const citations = new CitationBook();
  const ctx: ToolContext = { owner: input.owner, locale, nowMs, readers: deps.readers, citations, newDraftId: deps.newDraftId ?? newDraftId };
  const steps: string[] = [`question_class:${intent.class}`];

  /* The tools, in the server's order; a refusal of a secret runs none. */
  const runs: ToolRun[] = [];
  if (intent.class !== "secret") {
    for (const call of planTools(intent, session.context)) runs.push(...(await runCall(call, ctx, intent)));
  }
  /* A market question whose asset is a stock is a stock question. */
  const klass: AgentQuestionClass = intent.class === "market" && runs.some((run) => run.cards.some((card) => card.kind === "stock")) ? "stock" : intent.class;
  const finalIntent: Intent = { ...intent, class: klass };
  const drafts = runs.map((run) => run.draft).filter((draft): draft is AgentDraftCard => draft !== null && (draft.kind === "planDraft" || draft.kind === "monitoringDraft" || draft.kind === "tradeDraft"));
  const extra = [...crossNotes(runs, locale), ...(klass === "secret" || klass === "execute" || klass === "help" || klass === "unknown" ? refusalTurnNotes(klass, locale, drafts.some((draft) => draft.kind === "tradeDraft")) : [])];
  if (klass === "prepare_monitoring" && runs.length === 0) extra.push({ section: "meaning", cites: [], text: w(locale, "A monitoring rule needs a measurable figure — a 24h volume, a share of the top ten holders, a holder count, an authority — and the asset or plan it stands on. Say, for example: alert me when BONK's 24h volume drops below $1M.", "Правилу Нагляду потрібна вимірювана цифра — обсяг за 24 год, частка десяти найбільших тримачів, кількість тримачів, право емісії — і актив чи план, на якому воно стоїть. Скажи, наприклад: сповісти мене, коли обсяг BONK за 24 год впаде нижче $1M.") });
  if (klass === "prepare_plan" && runs.length === 0) extra.push({ section: "meaning", cites: [], text: w(locale, "A plan needs an asset: name a token or a stock (SOL, BONK, NVDAx) with the most you are willing to lose, and Ryntra drafts it.", "Плану потрібен актив: назви токен чи акцію (SOL, BONK, NVDAx) і скільки ти готовий втратити — і Ryntra складе чернетку.") });
  if (extra.length > 0) runs.push({ tool: "service", kind: "research", outcome: "ok", state: null, facts: [], notes: extra, cards: [], handoffs: [], draft: null });
  if (runs.some((run) => run.kind === "research" && run.outcome === "ok" && run.facts.length > 0)) steps.push("research_returned");
  for (const draft of drafts) steps.push(draft.kind === "planDraft" ? "plan_draft_prepared" : draft.kind === "monitoringDraft" ? "monitoring_draft_prepared" : "trade_draft_prepared");

  const packet: AnswerPacket = { intent: finalIntent, personText: text, runs, citations, locale };

  /* The words: the model under the budget where the deployment switched it on and the question is one the model improves; deterministic otherwise. */
  let answer: AgentAnswer = composeDeterministic(packet);
  let composedBy: "model" | "deterministic" = "deterministic";
  const modelWorthy = deps.model !== null && deps.budget.modelEnabled && !["secret", "help", "unknown"].includes(klass) && runs.some((run) => run.facts.length > 0);
  if (modelWorthy && deps.model) {
    const reservation = await reserveCall(deps.store, input.owner, deps.budget, nowMs);
    if (!reservation.ok) {
      if (reservation.code === "AGENT_BUSY") return { ok: false, code: "AGENT_BUSY", reason: reservation.reason };
      if (reservation.code === "AGENT_BUDGET_EXHAUSTED") {
        /* Over the allowance the answer is still given — deterministically — and the refusal is said on the turn's budget state, never silently. */
        steps.push("budget_exhausted");
      }
    } else {
      const turnId = (deps.newTurnId ?? newTurnId)();
      const composed = await deps.model.compose(packet, safetyIdentifier(input.owner));
      if (composed.ok) {
        const verified = verifyAnswer(composed.answer, packet);
        answer = verified.answer;
        composedBy = "model";
        if (verified.dropped > 0) steps.push("model_sentences_dropped");
        await writeReceipt(deps.store, { owner: input.owner, sessionId: session.id, turnId, model: deps.model.name, promptVersion: AGENT_PROMPT_VERSION, phase: "answer", tokens: composed.usage, latencyMs: Math.round(composed.latencyMs), outcome: "ok", at: new Date(nowMs).toISOString() }).catch(() => null);
      } else {
        if (!composed.reached) await reservation.refund();
        await writeReceipt(deps.store, { owner: input.owner, sessionId: session.id, turnId, model: deps.model.name, promptVersion: AGENT_PROMPT_VERSION, phase: "answer", tokens: composed.usage, latencyMs: Math.round(composed.latencyMs), outcome: composed.outcome, at: new Date(nowMs).toISOString() }).catch(() => null);
        steps.push(`model_${composed.outcome}`);
      }
      await reservation.release();
    }
  }

  /*
   * The formats, when the words asked for one. The same runs carry them: no
   * extra read, no extra call, no second budget — and the six-section answer
   * is written beside them, so a client that knows nothing of either still
   * reads a whole answer.
   */
  const wantsLens = finalIntent.lens;
  const lensReads = wantsLens ? projectReads(runs, finalIntent.planId ?? (session.context?.kind === "plan" ? session.context.planId : null)) : null;
  const brief = wantsLens === "brief" && lensReads ? composeBrief(lensReads, locale) : null;
  const critic = wantsLens === "critic" && lensReads ? composeCritic(lensReads, locale) : null;
  if (wantsLens) steps.push(`lens:${wantsLens}`);

  /* The turns. */
  const at = new Date(nowMs).toISOString();
  const personTurn: AgentTurn = { id: (deps.newTurnId ?? newTurnId)(), role: "person", at, text, class: klass, answer: null, cards: [], citations: [], handoffs: [], tools: [], composedBy: null, refusal: null, brief: null, critic: null };
  const cards: AgentCard[] = runs.flatMap((run) => run.cards).slice(0, AGENT_CARDS_MAX);
  const handoffs = dedupeHandoffs(runs.flatMap((run) => run.handoffs)).slice(0, 6);
  const tools: AgentToolOutcome[] = runs.filter((run) => run.tool !== "service").map((run) => ({ tool: run.tool, kind: run.kind, outcome: run.outcome, state: run.state, latencyMs: 0 })).slice(0, 16);
  const refusal = klass === "secret" ? { code: "secret" as const, reason: w(locale, "Ryntra does not share keys, secrets, sessions or another wallet's data.", "Ryntra не розкриває ключі, секрети, сесії чи дані іншого гаманця.") } : klass === "execute" ? { code: "execute" as const, reason: w(locale, "Ryntra does not execute; the Review, your confirmation and your signature do.", "Ryntra не виконує; виконують Review, твоє підтвердження і твій підпис.") } : null;
  const rynTurn: AgentTurn = { id: (deps.newTurnId ?? newTurnId)(), role: "ryn", at, text: headline(packet), class: klass, answer, cards, citations: citations.list().slice(0, AGENT_CITATIONS_MAX), handoffs, tools, composedBy, refusal, brief, critic };

  for (const draft of drafts) await storeDraft(deps.store, { owner: input.owner, sessionId: session.id, turnId: rynTurn.id, draft, nowMs });

  let written = await appendTurns(deps.store, session, { turns: [personTurn, rynTurn], steps, nowMs });
  if (!written) {
    const again = await readSession(deps.store, input.owner, input.sessionId);
    written = again ? await appendTurns(deps.store, again, { turns: [personTurn, rynTurn], steps, nowMs }) : null;
  }
  if (!written) return { ok: false, code: "UNAVAILABLE", reason: "The session could not be written; ask again." };
  const budget = await readBudgetState(deps.store, input.owner, deps.budget, nowMs);
  return { ok: true, response: { sessionId: session.id, person: personTurn, ryn: rynTurn, budget } };
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
