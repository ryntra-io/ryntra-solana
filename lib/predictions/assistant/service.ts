/**
 * «Спитати Ryntra» on a prediction market — the one assistant, on the
 * prediction reads.
 *
 * The exchange is the assistant's own (`lib/agent/service.ts`), on a market
 * instead of a token: the topic decides the reads — the server, never the
 * words or a model; the prediction tools read and write their cited sentences
 * (`agent-tools.ts`); the answer is composed by the assistant's composer, or
 * worded by its configured model under its allowance and held by its
 * verifier to the reads (a figure no read stated, a command, advice, a link
 * or another name than Ryntra is dropped). A question about a key is refused
 * and nothing runs; a request to trade is refused and answered with a plan
 * draft. Every call that reaches the model leaves a priced receipt; only the
 * free credits are spent here, never a price the person was not shown.
 *
 * What comes back is the six-section answer, the citations with their times,
 * the sources a person can open, the plan draft (opened in the plan builder,
 * saved by the person), and the line «Це не порада». The journal of
 * assessments takes a line (`journal.ts`).
 *
 * Server only.
 */

import { composeDeterministic, verifyAnswer, type AnswerPacket } from "../../agent/answer.ts";
import { reserveCall, reserveGuestCall, writeReceipt, type AgentBudgetConfig } from "../../agent/budget.ts";
import { parseIntent, type Intent } from "../../agent/intent.ts";
import { promptVersionOf, safetyIdentifier, type AgentModel, type ModelOutcome, type ModelUsage } from "../../agent/model.ts";
import { CitationBook, type Locale } from "../../agent/provenance.ts";
import { creditsContextFor, type AgentDeps } from "../../agent/service.ts";
import { newTurnId } from "../../agent/session.ts";
import { emptyRun, type ToolContext, type ToolNote, type ToolRun } from "../../agent/tools/types.ts";
import type { AgentAnswer, AgentCitation } from "../../api/v1/contract.ts";
import type { ModelTask } from "../../assistant/models.ts";
import type { GuardStore } from "../../guard/store.ts";
import type { PredictionProvider } from "../provider.ts";
import { createPredictionAgentTools, newToolSink, outcomeQuoted, scopeIn, type PredictionAgentToolName, type PredictionSourceKind } from "./agent-tools.ts";
import type { PredictionPlanDraft } from "./draft.ts";
import { settlementPhase } from "../resolution.ts";
import { writeJournalLine } from "./journal.ts";
import { topicOf, topicQuestion, type AskTopic } from "./topics.ts";

export type AskAsker = Readonly<{ kind: "wallet"; wallet: string }> | Readonly<{ kind: "guest"; key: string | null }>;

export type AskInput = Readonly<{
  asker: AskAsker;
  eventId: string;
  venueMarketId: string;
  outcomeId: string | null;
  /** A button's topic; null — the typed words decide it. */
  topic: AskTopic | null;
  text: string;
  locale: Locale;
  /** The person's usual amount, for the plan draft's stake. */
  amountUsd: number | null;
}>;

export type AskDeps = Readonly<{
  store: GuardStore;
  provider: PredictionProvider;
  model: AgentModel | null;
  budget: AgentBudgetConfig;
  credits?: AgentDeps["credits"];
  now?: () => number;
}>;

export type AskSource = Readonly<{ id: string; label: string; at: string | null; kind: PredictionSourceKind; href: string | null }>;

/** How the words were written: the model's (kept under the verifier), or composed from the reads — and why. */
export type AskWords = "model" | "reads" | "reads-free-spent" | "reads-busy";

export type AskResponse = Readonly<{
  topic: AskTopic;
  question: string;
  headline: string;
  answer: AgentAnswer;
  composedBy: "model" | "deterministic";
  words: AskWords;
  citations: readonly AgentCitation[];
  sources: readonly AskSource[];
  draft: PredictionPlanDraft | null;
  refusal: Readonly<{ code: "secret" | "execute"; reason: string }> | null;
  disclaimer: string;
  readAt: string;
  journal: boolean;
}>;

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

type Call = Readonly<{ name: PredictionAgentToolName; input: Record<string, unknown> }>;

/** The reads each topic takes — decided here, in this order; nothing the words or a model say adds one. */
export function planPredictionCalls(topic: AskTopic, scope: Readonly<{ eventId: string; venueMarketId: string; outcomeId: string | null }>, amountUsd: number | null = null): readonly Call[] {
  const s = { eventId: scope.eventId, venueMarketId: scope.venueMarketId, outcomeId: scope.outcomeId };
  const names: Record<AskTopic, readonly PredictionAgentToolName[]> = {
    yes: ["prediction_market_read", "prediction_rules_read"],
    basis: ["prediction_rules_read", "prediction_market_read"],
    news: ["prediction_move_read", "prediction_news_read", "prediction_market_read"],
    risks: ["prediction_market_read", "prediction_depth_read", "prediction_move_read", "prediction_news_read", "prediction_rules_read"],
    plan: ["prediction_market_read", "prediction_depth_read", "prediction_plan_prepare"],
    overview: ["prediction_market_read", "prediction_rules_read", "prediction_move_read", "prediction_news_read"],
  };
  return names[topic].map((name) => ({ name, input: name === "prediction_plan_prepare" ? { ...s, amountUsd } : s }));
}

/** The sections a topic's answer keeps: a question about the rules is not answered with the order book. */
const KEEP: Readonly<Record<AskTopic, Readonly<Record<string, readonly ToolNote["section"][]>>>> = {
  yes: { prediction_market_read: ["observation", "meaning", "risks", "checks"] },
  basis: { prediction_market_read: ["risks", "checks"] },
  news: { prediction_market_read: ["meaning", "risks", "checks"] },
  risks: { prediction_market_read: ["risks", "checks"], prediction_news_read: ["observation", "checks"], prediction_rules_read: ["risks", "counter"], prediction_move_read: ["observation", "risks"] },
  plan: { prediction_market_read: ["observation", "meaning", "risks", "checks"], prediction_depth_read: ["observation", "risks"] },
  overview: {},
};

function trimmed(run: ToolRun, topic: AskTopic): ToolRun {
  const keep = KEEP[topic][run.tool];
  if (!keep) return run;
  return { ...run, notes: run.notes.filter((note) => keep.includes(note.section)) };
}

/** A move of five points or more in a day with no news in it: said once, on the two reads that met. */
function crossNotes(runs: readonly ToolRun[], locale: Locale): ToolNote[] {
  const move = runs.find((run) => run.tool === "prediction_move_read" && run.outcome === "ok");
  const news = runs.find((run) => run.tool === "prediction_news_read" && (run.outcome === "ok" || run.outcome === "empty"));
  const change = move?.facts.find((f) => f.key === "move.change");
  const day = news?.facts.find((f) => f.key === "news.day");
  if (!change || change.number == null || !day || day.number == null) return [];
  if (Math.abs(change.number) < 5 || day.number > 0) return [];
  return [{ section: "risks", cites: [change.cite, day.cite], text: w(locale, "The price moved five points or more in a day with no news found: the move may be one large trader, or news the search did not catch.", "Ціна зрушила на п'ять пунктів і більше за добу, а новин не знайдено: це може бути один великий учасник або новина, якої пошук не побачив.") }];
}

function headlineOf(topic: AskTopic, locale: Locale, outcome: string | null): string {
  const label = outcome ? outcomeQuoted(outcome, locale) : w(locale, "the outcome", "результат");
  switch (topic) {
    case "yes":
      return w(locale, `What makes ${label} win`, `Що потрібно, щоб виграло ${label}`);
    case "basis":
      return w(locale, "Where the catch is", "Де підстава");
    case "news":
      return w(locale, "The last 24 hours", "Останні 24 години");
    case "risks":
      return w(locale, "The risks here", "Ризики тут");
    case "plan":
      return w(locale, `A plan draft on ${label}`, `Чернетка плану на ${label}`);
    default:
      return w(locale, "This market at a glance", "Цей ринок коротко");
  }
}

export function disclaimerText(locale: Locale): string {
  return w(locale, "Not advice. Ryntra reads and drafts; you decide and confirm.", "Це не порада. Ryntra читає й готує чернетку — вирішуєш і підтверджуєш ти.");
}

/** One question on a market into one answer. Nothing here quotes, places or signs. */
export async function askRyntraOnMarket(deps: AskDeps, input: AskInput): Promise<AskResponse> {
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  const locale = input.locale;
  const typed = input.text.trim().slice(0, 600);
  const intent: Intent = parseIntent(typed, null);
  const refusal = intent.class === "secret" ? ("secret" as const) : intent.class === "execute" || intent.class === "prepare_trade" ? ("execute" as const) : null;
  /* A request to trade is answered with a plan draft; a key is answered with nothing but the refusal. */
  const topic: AskTopic = refusal === "execute" ? "plan" : (input.topic ?? topicOf(typed));
  const citations = new CitationBook();
  const sink = newToolSink();
  const tools = createPredictionAgentTools(deps.provider, sink);
  /* The assistant's tool context: the prediction tools read through their provider, never through the token readers. */
  const ctx: ToolContext = { owner: input.asker.kind === "wallet" ? input.asker.wallet : "guest", locale, nowMs, readers: NO_READERS, citations, newDraftId: () => "" };

  const runs: ToolRun[] = [];
  if (refusal !== "secret") {
    for (const call of planPredictionCalls(topic, input, input.amountUsd)) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) continue;
      const parsed = tool.input.safeParse(call.input);
      if (!parsed.success) {
        runs.push(emptyRun(call.name, tool.kind, "refused"));
        continue;
      }
      try {
        runs.push(trimmed(await tool.run(parsed.data as never, ctx), topic));
      } catch {
        runs.push(emptyRun(call.name, tool.kind, "unavailable", "unavailable"));
      }
    }
  }
  const extra: ToolNote[] = [...crossNotes(runs, locale)];
  if (refusal === "secret") extra.push({ section: "observation", cites: [], text: w(locale, "Ryntra does not share keys, secrets, sessions or another wallet's data, and never asks for them.", "Ryntra не розкриває ключі, секрети, сесії чи дані іншого гаманця й ніколи їх не просить.") });
  if (refusal === "execute") extra.push({ section: "observation", cites: [], text: w(locale, "Ryntra does not place orders: you place one yourself, in the ticket's Review. Below is a plan draft to start from.", "Ryntra не ставить ордерів: ордер ставиш ти сам, у Review тікета. Нижче — чернетка плану, від якої можна почати.") });
  /* The next step on a market is the person's: a draft to start from, the order in their own Review. */
  if (refusal === null && topic !== "plan") extra.push({ section: "actions", cites: [], text: w(locale, "Next: ask for a plan draft to start from numbers; an order is placed only by you, in the ticket's Review.", "Далі: попроси чернетку плану, щоб почати з цифр; ордер ставиш лише ти, у Review тікета.") });
  if (extra.length > 0) runs.unshift({ tool: "service", kind: "research", outcome: "ok", state: null, facts: [], notes: extra, cards: [], handoffs: [], draft: null });

  /* The provider keeps its reads a while, so naming the outcome here reads nothing twice. */
  const scope = refusal === "secret" ? null : await scopeOf(deps.provider, input);
  const outcomeLabel = scope?.outcome.label ?? null;
  const question = typed || topicQuestion(topic, locale, outcomeLabel);
  const packet: AnswerPacket = { intent: { ...intent, class: refusal ?? "market", symbols: [], mints: [] }, personText: question, runs, citations, locale, reader: null };
  let answer = composeDeterministic(packet);
  let composedBy: "model" | "deterministic" = "deterministic";
  let words: AskWords = "reads";

  const modelWorthy = refusal === null && deps.model !== null && deps.budget.modelEnabled && runs.some((run) => run.facts.length > 0);
  if (modelWorthy && deps.model) {
    const payer = input.asker.kind === "wallet" ? input.asker.wallet : input.asker.key;
    const turnId = newTurnId();
    const sessionId = `predict_${input.eventId}`.slice(0, 64);
    let taken: Readonly<{ refund: () => Promise<void>; release: () => Promise<void>; charge: () => Promise<void>; forgive: () => Promise<void> }> | null = null;
    if (input.asker.kind === "wallet") {
      /* A credits store that did not answer is no free pass: the reads answer, the model is not called. */
      const credits = await creditsContextFor({ store: deps.store, credits: deps.credits ?? null }, input.asker.wallet, nowMs).then(
        (context) => ({ ok: true as const, context }),
        () => ({ ok: false as const }),
      );
      if (!credits.ok) words = "reads-busy";
      else {
        /* Only the day's free credits: no price was shown in this panel, so none is taken from a balance. */
        const reserved = await reserveCall(deps.store, input.asker.wallet, deps.budget, nowMs, credits.context ? { context: credits.context, action: "question", acceptCredits: null, idem: `q:${turnId}` } : null);
        if (reserved.ok) taken = reserved;
        else words = reserved.code === "AGENT_BUSY" ? "reads-busy" : "reads-free-spent";
      }
    } else if (payer) {
      const reserved = await reserveGuestCall(deps.store, payer, deps.budget, nowMs);
      if (reserved.ok) taken = { refund: reserved.refund, release: async () => undefined, charge: async () => undefined, forgive: async () => undefined };
      else words = "reads-free-spent";
    }
    if (taken && payer) {
      let reached = false;
      let charged = false;
      try {
        const composed = await deps.model.compose(packet, safetyIdentifier(payer));
        reached = composed.ok || composed.reached;
        await receipt(deps.store, payer, sessionId, turnId, "answer", composed, composed.ok ? "ok" : composed.outcome, at);
        if (composed.ok) {
          const verified = verifyAnswer(composed.answer, packet);
          answer = verified.answer;
          composedBy = "model";
          words = "model";
          /* Kept only when a sentence of the model's stood: an answer the verifier rebuilt from the reads costs nothing. */
          charged = verified.kept > 0;
        }
      } finally {
        if (!reached) await taken.refund();
        else if (charged) await taken.charge();
        else await taken.forgive();
        await taken.release();
      }
    }
  }

  const market = runs.find((run) => run.tool === "prediction_market_read" && run.outcome === "ok");
  const price = market?.facts.find((f) => f.key === "probability")?.number ?? null;
  let journal = false;
  /* Only a market still trading is a forecast to score: a price read after the close or the result would flatter the market's score. */
  const phase = scope ? settlementPhase(scope.market, scope.event.endDate, nowMs).phase : null;
  if (market && scope && scope.market.status === "open" && (phase === "open" || phase === "closing")) {
    journal = await writeJournalLine(deps.store, { eventId: input.eventId, venueMarketId: scope.market.id, outcomeId: scope.outcome.id, outcomeLabel: scope.outcome.label, question: scope.market.question, topic, market: price != null ? price / 100 : null, nowMs }).catch(() => false);
  }

  const list = citations.list();
  const sources: AskSource[] = list.map((c) => ({ id: c.id, label: c.source, at: c.observedAt, kind: sink.kinds.get(c.id) ?? "market", href: sink.links.get(c.id) ?? null }));
  return {
    topic,
    question,
    headline: refusal === "secret" ? w(locale, "Ryntra does not share that", "Ryntra цього не розкриває") : headlineOf(topic, locale, outcomeLabel),
    answer,
    composedBy,
    words,
    citations: list,
    sources,
    draft: refusal === "secret" ? null : sink.draft,
    refusal: refusal === "secret" ? { code: "secret", reason: w(locale, "Ryntra does not share keys or secrets.", "Ryntra не розкриває ключів і секретів.") } : refusal === "execute" ? { code: "execute", reason: w(locale, "Ryntra does not place orders; your Review does.", "Ryntra не ставить ордерів — це робить твій Review.") } : null,
    disclaimer: disclaimerText(locale),
    readAt: at,
    journal,
  };
}

async function scopeOf(provider: PredictionProvider, input: AskInput) {
  const read = await provider.event(input.eventId).catch(() => null);
  return read && read.ok ? scopeIn(read.value, input) : null;
}

async function receipt(store: GuardStore, payer: string, sessionId: string, turnId: string, task: ModelTask, call: Readonly<{ model: string; usage: ModelUsage; latencyMs: number }>, outcome: ModelOutcome, at: string): Promise<void> {
  await writeReceipt(store, { owner: payer, sessionId, turnId, model: call.model, promptVersion: promptVersionOf(task), task, tokens: call.usage, latencyMs: call.latencyMs, outcome, at }).catch(() => null);
}

/* The prediction tools never touch the token readers; a call that did would be a bug, and it says so. */
const NO_READERS = new Proxy({} as ToolContext["readers"], {
  get(_target, prop) {
    if (prop === "then") return undefined;
    return () => {
      throw new Error(`the prediction tools read no ${String(prop)}`);
    };
  },
});
