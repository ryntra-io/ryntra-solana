/**
 * The prediction-market reads in the one assistant's own tool shape.
 *
 * The same contract as every tool Ryntra has (`lib/agent/tools/types.ts`):
 * two kinds only — five `research` tools that read through the provider and
 * one `prepare` tool that drafts a plan — snake-case names free of every word
 * of an execution, each input checked by its own schema, every figure with a
 * citation, every sentence the composer may print written here with the
 * citations it stands on. Nothing here quotes a route, places an order or
 * reads a wallet: the plan draft opens in the plan builder, where the person
 * decides.
 *
 * A venue's words — its rules, a headline — are someone else's text: such a
 * sentence is marked `quote`, so the composer screens it and a model sees it
 * apart from the reads. Links never enter a sentence; they wait in the sink
 * for the sources list.
 *
 * `createPredictionAgentTools` is what the assistant's registry takes once
 * it registers the prediction reads (request in the assistant line's
 * handoff); until then the Predictions service runs them through the same
 * composer, verifier, model and allowance.
 *
 * Server only.
 */

import { z } from "zod";

import type { AgentState } from "../../api/v1/contract.ts";
import type { Locale } from "../../agent/provenance.ts";
import { emptyRun, type RegisteredTool, type ToolContext, type ToolFact, type ToolNote, type ToolRun } from "../../agent/tools/types.ts";
import { dayChange } from "../market-map.ts";
import type { PredictionBook, PredictionEvent, PredictionMarket, PredictionNews, PredictionOutcome } from "../model.ts";
import type { PredictionProvider, Result } from "../provider.ts";
import { resolutionBrief, settlementPhase } from "../resolution.ts";
import { planDraftFrom, type PredictionPlanDraft } from "./draft.ts";

export type PredictionSourceKind = "market" | "rules" | "news" | "move" | "depth";

/** What the tools leave beside their runs: the external address of a source and the plan draft. */
export type PredictionToolSink = {
  links: Map<string, string>;
  kinds: Map<string, PredictionSourceKind>;
  draft: PredictionPlanDraft | null;
};

export function newToolSink(): PredictionToolSink {
  return { links: new Map(), kinds: new Map(), draft: null };
}

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ScopeSchema = z.object({ eventId: ID, venueMarketId: ID, outcomeId: ID.nullable().optional() }).strict();
const DraftSchema = ScopeSchema.extend({ amountUsd: z.number().finite().positive().max(100_000).nullable().optional() }).strict();
type Scope = z.output<typeof ScopeSchema>;

/** The words Ryntra's sources are named by in a person's language; the provider is named in the details, never as the face. */
const VENUES: Readonly<Record<string, string>> = { polymarket: "Polymarket", kalshi: "Kalshi", limitless: "Limitless", predict: "Predict", hyperliquid: "Hyperliquid", myriad: "Myriad", novig: "Novig", prophetx: "ProphetX", pred: "Pred" };
export function venueTitle(venue: string): string {
  return VENUES[venue] ?? (venue ? venue.charAt(0).toUpperCase() + venue.slice(1) : "—");
}

/* ------------------------------------------------------------ figures */

/** A probability as a person reads it: `62%` / `62 %`, at most one decimal. */
export function pctWords(p: number, locale: Locale): string {
  const value = Math.round(p * 1000) / 10;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return locale === "uk" ? `${text.replace(".", ",")} %` : `${text}%`;
}

/** A price as cents of a dollar: `62¢`. */
function centsWords(p: number, locale: Locale): string {
  const value = Math.round(p * 1000) / 10;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return locale === "uk" ? `${text.replace(".", ",")} ¢` : `${text}¢`;
}

/** A move in percentage points: `+4 pp` / `+4 п.п.`. */
function pointsWords(delta: number, locale: Locale): string {
  const value = Math.round(delta * 1000) / 10;
  const text = `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
  return locale === "uk" ? `${text.replace(".", ",")} п.п.` : `${text} pp`;
}

function usdWords(value: number, _locale: Locale): string {
  /* Dollars as the product prints them everywhere: `$1,250`, cents only where there are some. */
  const digits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function dateWords(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  /* Without the «р.» a Ukrainian date ends in: the sentence's own full stop follows it. */
  return new Date(t).toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/\s?р\.$/u, "");
}

function fact(key: string, label: string, value: string, number: number | null, unit: string | null, cite: string, state: AgentState = "current"): ToolFact {
  return { key, label, value: value.slice(0, 80), number: number !== null && Number.isFinite(number) ? number : null, unit, state, cite };
}

/** The probability's figure in points (0–100), the number a sentence about it prints. */
const points = (p: number): number => Math.round(p * 1000) / 10;

/* ------------------------------------------------------------ the scope */

type Read = Readonly<{
  event: (eventId: string) => Promise<Result<PredictionEvent>>;
  news: (venueMarketId: string) => Promise<Result<PredictionNews>>;
  book: (venueMarketId: string) => Promise<Result<PredictionBook>>;
  bars: (outcomeId: string) => ReturnType<PredictionProvider["chart"]>;
}>;

/** One read of each thing per request, however many tools ask for it. */
function memoRead(provider: PredictionProvider): Read {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let hit = cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      cache.set(key, hit);
    }
    return hit;
  };
  return {
    event: (id) => once(`event:${id}`, () => provider.event(id)),
    news: (id) => once(`news:${id}`, () => provider.news(id, 6)),
    book: (id) => once(`book:${id}`, () => provider.book(id, 10)),
    bars: (id) => once(`bars:${id}`, () => provider.chart(id, "1h", 48)),
  };
}

type Scoped = Readonly<{ event: PredictionEvent; market: PredictionMarket; outcome: PredictionOutcome }>;

/** The event, the market (by its own id or a matched venue's) and the outcome — the named one, else «Yes», else the first. */
export function scopeIn(event: PredictionEvent, scope: Scope): Scoped | null {
  const market = event.markets.find((m) => m.id === scope.venueMarketId) ?? event.markets.find((m) => m.matched.some((v) => v.id === scope.venueMarketId)) ?? null;
  if (!market) return null;
  const outcome = market.outcomes.find((o) => o.id === scope.outcomeId) ?? market.outcomes.find((o) => /^yes$/i.test(o.label)) ?? market.outcomes[0] ?? null;
  return outcome ? { event, market, outcome } : null;
}

/** «Так» / “Yes” for a yes-no outcome, the venue's own word in quotes otherwise. */
export function outcomeQuoted(label: string, locale: Locale): string {
  if (/^yes$/i.test(label)) return locale === "uk" ? "«Так»" : "“Yes”";
  if (/^no$/i.test(label)) return locale === "uk" ? "«Ні»" : "“No”";
  return locale === "uk" ? `«${label.slice(0, 60)}»` : `“${label.slice(0, 60)}”`;
}

const URL = /https?:\/\/[^\s)"'<>\]]+/gi;
/** An address as the site's name alone — `federalreserve.gov` — so a sentence that pointed at it still reads whole; the link itself waits in the sources. */
function siteOf(address: string): string {
  try {
    return new globalThis.URL(address).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
/** A venue's sentence with its addresses as site names and cut to a block a person reads in two lines. */
function venueWords(text: string, max = 220): string {
  const clean = text.replace(URL, (address) => siteOf(address.replace(/[.,;:]+$/, ""))).replace(/\(\s*\)/g, "").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/u, "")}…`;
}

async function scoped(read: Read, input: Scope, name: string, kind: "research" | "prepare", locale: Locale): Promise<Scoped | ToolRun> {
  const loaded = await read.event(input.eventId);
  if (!loaded.ok) {
    return {
      ...emptyRun(name, kind, "unavailable", "unavailable"),
      notes: [{ section: "risks", cites: [], text: w(locale, "The market itself could not be read just now; nothing here stands on its price.", "Сам ринок зараз не прочитався; ніщо тут не спирається на його ціну.") }],
    };
  }
  const found = scopeIn(loaded.value, input);
  return found ?? emptyRun(name, kind, "empty");
}

const isRun = (value: Scoped | ToolRun): value is ToolRun => "tool" in value;

/* ------------------------------------------------------------ the tools */

type Tool = Readonly<{ name: string; kind: "research" | "prepare"; description: string; input: z.ZodTypeAny; run: (input: never, ctx: ToolContext) => Promise<ToolRun> }>;

/** The market's price, volume, dates and stage — what the price says, and that it is the market's and not Ryntra's. */
function marketTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_market_read";
  return {
    name,
    kind: "research",
    description: "One prediction market as it stands: the outcome's price (the market's implied chance), the volume, the close and the settlement stage.",
    input: ScopeSchema,
    run: async (input: Scope, ctx: ToolContext): Promise<ToolRun> => {
      const s = await scoped(read, input, name, "research", ctx.locale);
      if (isRun(s)) return s;
      const { event, market, outcome } = s;
      const locale = ctx.locale;
      const at = new Date(ctx.nowMs).toISOString();
      const cite = ctx.citations.add({ tool: name, source: `${venueTitle(market.venue)} · ${w(locale, "market price", "ціна ринку")}`, observedAt: at, state: "current", ref: market.id });
      sink.kinds.set(cite.id, "market");
      const label = outcomeQuoted(outcome.label, locale);
      const facts: ToolFact[] = [];
      const notes: ToolNote[] = [];
      const phase = settlementPhase(market, event.endDate, ctx.nowMs);
      if (outcome.probability != null) facts.push(fact("probability", w(locale, `${outcome.label} price`, `Ціна ${label}`), pctWords(outcome.probability, locale), points(outcome.probability), "%", cite.id));
      if (market.volume != null) facts.push(fact("volume", w(locale, "Volume", "Обсяг"), usdWords(market.volume, locale), Math.round(market.volume), "USD", cite.id));
      const closes = dateWords(market.endDate ?? event.endDate, locale);
      if (closes) facts.push(fact("closes", w(locale, "Trading closes", "Торги закриваються"), closes, null, null, cite.id));
      facts.push(fact("venues", w(locale, "Venues", "Майданчики"), String(market.matched.length + 1), market.matched.length + 1, null, cite.id));

      if (phase.phase === "resolved") {
        notes.push({ section: "observation", cites: [cite.id], text: phase.winner ? w(locale, `The market has settled: ${outcomeQuoted(phase.winner, locale)} won.`, `Ринок уже розраховано: виграло ${outcomeQuoted(phase.winner, locale)}.`) : w(locale, "The market has settled; the venue names no winner in this read.", "Ринок уже розраховано; у цьому читанні майданчик не називає переможця.") });
      } else if (outcome.probability != null) {
        notes.push({ section: "observation", cites: [cite.id], text: w(locale, `${label} costs ${centsWords(outcome.probability, locale)} now: the market's traders put its chance at ${pctWords(outcome.probability, locale)}.`, `${label} зараз коштує ${centsWords(outcome.probability, locale)}: учасники ринку оцінюють шанс у ${pctWords(outcome.probability, locale)}.`) });
        notes.push({ section: "meaning", cites: [cite.id], text: w(locale, "That is the price traders pay, not Ryntra's estimate: Ryntra gives no chance of its own.", "Це ціна, яку платять учасники ринку, а не оцінка Ryntra: власного шансу Ryntra не дає.") });
      } else {
        notes.push({ section: "observation", cites: [cite.id], text: w(locale, `The venue gives no price for ${label} in this read.`, `У цьому читанні майданчик не дає ціни для ${label}.`) });
      }
      if (phase.phase === "closing") notes.push({ section: "risks", cites: [cite.id], text: w(locale, "Less than a day to the close: the price can jump, and getting out gets harder.", "До закриття менше доби: ціна може різко стрибати, а вийти з позиції стає важче.") });
      if (phase.phase === "awaiting" || phase.phase === "past") notes.push({ section: "risks", cites: [cite.id], text: w(locale, "Trading has reached its date and the result is not in yet: a new position now waits on the settlement.", "Торги дійшли своєї дати, а результату ще немає: нова позиція зараз чекає на розрахунок.") });
      if (phase.phase === "delayed") notes.push({ section: "risks", cites: [cite.id], text: w(locale, "The result is late against the venue's own date: the payout may wait on a dispute or a clarification.", "Результат запізнюється проти дати майданчика: виплата може чекати на спір чи уточнення.") });
      if (market.status !== "open" && phase.phase !== "resolved") notes.push({ section: "checks", cites: [cite.id], text: w(locale, "The market takes no new orders now.", "Ринок зараз не приймає нових ордерів.") });
      return { tool: name, kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

/** What makes the outcome win in the venue's own words, the source of the result, the dates, the exceptions and how the venues differ. */
function rulesTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_rules_read";
  return {
    name,
    kind: "research",
    description: "The market's resolution rules: the venue's sentence on when the outcome wins, the resolution source, the close and result dates, the exceptions, and how the venues of the event settle it differently.",
    input: ScopeSchema,
    run: async (input: Scope, ctx: ToolContext): Promise<ToolRun> => {
      const s = await scoped(read, input, name, "research", ctx.locale);
      if (isRun(s)) return s;
      const { event, market, outcome } = s;
      const locale = ctx.locale;
      const at = new Date(ctx.nowMs).toISOString();
      const brief = resolutionBrief(market, event.endDate);
      const cite = ctx.citations.add({ tool: name, source: `${venueTitle(market.venue)} · ${w(locale, "resolution rules", "правила розрахунку")}`, observedAt: at, state: "current", ref: market.id });
      sink.kinds.set(cite.id, "rules");
      if (brief.source?.url && /^https:\/\//i.test(brief.source.url)) sink.links.set(cite.id, brief.source.url);
      const label = outcomeQuoted(outcome.label, locale);
      const yesNo = /^(yes|no)$/i.test(outcome.label);
      const facts: ToolFact[] = [];
      const notes: ToolNote[] = [];
      const closes = dateWords(brief.closesAt ?? event.endDate, locale);
      const resolves = dateWords(brief.resolvesBy, locale);
      if (closes) facts.push(fact("rules.closes", w(locale, "Trading closes", "Торги закриваються"), closes, null, null, cite.id));
      if (resolves) facts.push(fact("rules.resolves", w(locale, "Result by", "Результат до"), resolves, null, null, cite.id));
      facts.push(fact("rules.exceptions", w(locale, "Exceptions in the rules", "Застереження в правилах"), String(brief.exceptions.length), brief.exceptions.length, null, cite.id));
      const differences = event.settlement?.differences ?? [];
      facts.push(fact("rules.differences", w(locale, "Rule differences between venues", "Відмінності правил між майданчиками"), String(differences.length), differences.length, null, cite.id));

      if (brief.yesWhen && (yesNo || /^yes$/i.test(outcome.label))) {
        notes.push({ section: "observation", cites: [cite.id], quote: true, text: `${w(locale, "When “Yes” wins, in the venue's words:", "Коли виграє «Так», словами майданчика:")} “${venueWords(brief.yesWhen)}”` });
        if (/^no$/i.test(outcome.label)) notes.push({ section: "meaning", cites: [cite.id], text: w(locale, "“No” wins when that condition is not met by the deadline, unless an exception below applies.", "«Ні» виграє, коли ця умова не виконалась до дедлайну, якщо не спрацювало застереження нижче.") });
      } else {
        notes.push({ section: "observation", cites: [cite.id], text: w(locale, `The venue's rules give no separate sentence on when ${label} wins: the full text is in Details.`, `Правила майданчика не мають окремого речення про те, коли виграє ${label}: повний текст — у «Деталях».`) });
      }
      if (brief.source) {
        const words = venueWords(brief.source.text);
        if (words.length > 0) notes.push({ section: "observation", cites: [cite.id], quote: true, text: `${w(locale, "What decides the result:", "Що вирішує результат:")} “${words}”` });
      } else {
        notes.push({ section: "risks", cites: [cite.id], text: w(locale, "The rules name no resolution source in a sentence of their own: check them before a deal.", "Правила не називають джерела результату окремим реченням: перевір їх до угоди.") });
      }
      if (closes) notes.push({ section: "observation", cites: [cite.id], text: resolves ? w(locale, `Trading closes on ${closes}; the result is due by ${resolves}.`, `Торги закриваються ${closes}; результат — до ${resolves}.`) : w(locale, `Trading closes on ${closes}; the venue gives no separate result date.`, `Торги закриваються ${closes}; окремої дати результату майданчик не дає.`) });
      if (brief.exceptions.length > 0) notes.push({ section: "risks", cites: [cite.id], text: w(locale, `The rules carry ${brief.exceptions.length} exception${brief.exceptions.length === 1 ? "" : "s"} — a cancellation, a delay, a tie or a fallback settles its own way; read them before a deal.`, `У правилах є застереження (${brief.exceptions.length}): скасування, перенесення, нічия чи запасний варіант розраховуються окремо — прочитай їх до угоди.`) });
      if (differences.length > 0) {
        const titles = differences.slice(0, 3).map((d) => venueWords(d.title, 60)).filter(Boolean);
        notes.push({ section: "counter", cites: [cite.id], text: w(locale, `The venues settle this market differently in ${differences.length} way${differences.length === 1 ? "" : "s"}: the same outcome can pay on one venue and not on another.`, `Майданчики розраховують цей ринок по-різному (${differences.length}): той самий результат може виграти на одному майданчику й не виграти на іншому.`) });
        if (titles.length > 0) notes.push({ section: "counter", cites: [cite.id], quote: true, text: `${w(locale, "Where they differ:", "Де саме:")} ${titles.join("; ")}.` });
        notes.push({ section: "checks", cites: [cite.id], text: w(locale, "Before a deal, see which venue fills it: its rules, not another's, decide the payout.", "Перед угодою подивись, який майданчик її виконує: виплату вирішують його правила, а не іншого.") });
      } else if (market.matched.length > 0) {
        notes.push({ section: "observation", cites: [cite.id], text: w(locale, "No rule differences between the venues were found for this market.", "Відмінностей у правилах між майданчиками для цього ринку не знайдено.") });
      }
      notes.push({ section: "checks", cites: [cite.id], text: w(locale, "Check the condition against the resolution source: it decides the win, not the news.", "Звір умову з джерелом результату: виграш вирішує воно, а не новини.") });
      return { tool: name, kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

/** The outcome's move over the last day from its hourly bars. */
function moveTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_move_read";
  return {
    name,
    kind: "research",
    description: "The outcome's price over the last 24 hours from its hourly bars: where it was, where it is and the change in points.",
    input: ScopeSchema,
    run: async (input: Scope, ctx: ToolContext): Promise<ToolRun> => {
      const s = await scoped(read, input, name, "research", ctx.locale);
      if (isRun(s)) return s;
      const { market, outcome } = s;
      const locale = ctx.locale;
      const bars = await read.bars(outcome.id);
      if (!bars.ok) {
        return { ...emptyRun(name, "research", "unavailable", "unavailable"), notes: [{ section: "risks", cites: [], text: w(locale, "The price history did not answer: the day's move is not known here.", "Історія ціни не відповіла: рух за добу тут невідомий.") }] };
      }
      const list = bars.value.bars;
      const change = dayChange(list, ctx.nowMs);
      if (change == null || list.length === 0) return emptyRun(name, "research", "empty");
      const last = list[list.length - 1]!;
      const start = last.c - change;
      const observedAt = new Date(last.t).toISOString();
      const cite = ctx.citations.add({ tool: name, source: `${venueTitle(bars.value.venue || market.venue)} · ${w(locale, "price over 24 hours", "ціна за 24 години")}`, observedAt, state: "current", ref: outcome.id });
      sink.kinds.set(cite.id, "move");
      const label = outcomeQuoted(outcome.label, locale);
      const facts = [
        fact("move.change", w(locale, "Change over 24h", "Зміна за 24 год"), pointsWords(change, locale), points(change), "pp", cite.id),
        fact("move.from", w(locale, "A day ago", "Добу тому"), pctWords(start, locale), points(start), "%", cite.id),
        fact("move.to", w(locale, "Now", "Зараз"), pctWords(last.c, locale), points(last.c), "%", cite.id),
      ];
      const flat = Math.abs(change) < 0.005;
      const notes: ToolNote[] = [
        {
          section: "observation",
          cites: [cite.id],
          text: flat ? w(locale, `Over 24 hours ${label} has barely moved: ${pctWords(last.c, locale)}.`, `За 24 години ${label} майже не змінився: ${pctWords(last.c, locale)}.`) : w(locale, `Over 24 hours ${label} went from ${pctWords(start, locale)} to ${pctWords(last.c, locale)} (${pointsWords(change, locale)}).`, `За 24 години ${label} змінився з ${pctWords(start, locale)} до ${pctWords(last.c, locale)} (${pointsWords(change, locale)}).`),
        },
      ];
      if (Math.abs(change) >= 0.1) notes.push({ section: "risks", cites: [cite.id], text: w(locale, "A move of ten points or more in a day: the price is still finding its level.", "Рух на десять пунктів і більше за добу: ціна ще шукає свій рівень.") });
      return { tool: name, kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

const DAY_MS = 24 * 3_600_000;

/** The news the provider found for the market, the last day's apart — each headline its own source, with its time. */
function newsTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_news_read";
  return {
    name,
    kind: "research",
    description: "News the provider found for the market, newest first, each with its publication time; the last 24 hours counted apart. Headlines are the publishers' words.",
    input: ScopeSchema,
    run: async (input: Scope, ctx: ToolContext): Promise<ToolRun> => {
      const locale = ctx.locale;
      const news = await read.news(input.venueMarketId);
      if (!news.ok) {
        return { ...emptyRun(name, "research", "unavailable", "unavailable"), notes: [{ section: "risks", cites: [], text: w(locale, "The news search did not answer: what was published about this market is not known here.", "Пошук новин не відповів: що писали про цей ринок, тут невідомо.") }] };
      }
      const at = new Date(ctx.nowMs).toISOString();
      const articles = [...news.value.articles].sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
      const recent = articles.filter((a) => {
        const t = Date.parse(a.publishedAt ?? "");
        return Number.isFinite(t) && ctx.nowMs - t <= DAY_MS && t <= ctx.nowMs + 60_000;
      });
      const search = ctx.citations.add({ tool: name, source: w(locale, "News search for this market", "Пошук новин для цього ринку"), observedAt: at, state: "current", ref: input.venueMarketId });
      sink.kinds.set(search.id, "news");
      const facts: ToolFact[] = [fact("news.day", w(locale, "News in 24h", "Новин за 24 год"), String(recent.length), recent.length, null, search.id), fact("news.all", w(locale, "News found", "Знайдено новин"), String(articles.length), articles.length, null, search.id)];
      const notes: ToolNote[] = [];
      notes.push({
        section: "observation",
        cites: [search.id],
        text: recent.length > 0 ? w(locale, `In the last 24 hours the search found ${recent.length} news item${recent.length === 1 ? "" : "s"} on this market.`, `За останні 24 години пошук знайшов новин про цей ринок: ${recent.length}.`) : articles.length > 0 ? w(locale, "Nothing new in the last 24 hours; the latest news is older.", "За останні 24 години нового немає; останні новини старші.") : w(locale, "The search found no news on this market.", "Пошук не знайшов новин про цей ринок."),
      });
      for (const article of articles.slice(0, 4)) {
        const title = venueWords(article.title, 160);
        if (!title) continue;
        const cite = ctx.citations.add({ tool: name, source: article.source.slice(0, 80) || w(locale, "A publication", "Видання"), observedAt: article.publishedAt, state: "current" });
        sink.kinds.set(cite.id, "news");
        if (article.url && /^https:\/\//i.test(article.url)) sink.links.set(cite.id, article.url);
        notes.push({ section: "observation", cites: [cite.id], quote: true, text: `${article.source.slice(0, 60) || w(locale, "A publication", "Видання")}: “${title}”` });
      }
      if (articles.length > 0) notes.push({ section: "checks", cites: [search.id], text: w(locale, "A headline is someone's report, not the result: what counts is what the resolution source says.", "Заголовок — це чиєсь повідомлення, а не результат: рахується те, що скаже джерело розрахунку.") });
      return { tool: name, kind: "research", outcome: articles.length > 0 ? "ok" : "empty", state: "current", facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

/** Money resting at the best prices: how much a buyer of the outcome meets within five points of the best ask, and the spread. */
function depthTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_depth_read";
  return {
    name,
    kind: "research",
    description: "The order books of the market's venues: the spread of the outcome and the dollars offered within five points of the best ask.",
    input: ScopeSchema,
    run: async (input: Scope, ctx: ToolContext): Promise<ToolRun> => {
      const s = await scoped(read, input, name, "research", ctx.locale);
      if (isRun(s)) return s;
      const { market, outcome } = s;
      const locale = ctx.locale;
      const loaded = await read.book(market.id);
      if (!loaded.ok) {
        return { ...emptyRun(name, "research", "unavailable", "unavailable"), notes: [{ section: "risks", cites: [], text: w(locale, "The order book did not answer: how much a deal would move the price is not known here.", "Книга ордерів не відповіла: наскільки угода зрушить ціну, тут невідомо.") }] };
      }
      const book = loaded.value;
      /* The books are the market's first outcome's; a buyer of the other side of a yes-no market meets its bids mirrored. A third outcome has no book here. */
      const mirrored = market.outcomes[0]?.id !== outcome.id;
      if (mirrored && market.outcomes.length !== 2) {
        return { ...emptyRun(name, "research", "empty"), notes: [{ section: "risks", cites: [], text: w(locale, "This outcome's own order book is not read here: how much a deal would move its price is not known.", "Власна книга ордерів цього результату тут не читається: наскільки угода зрушить його ціну, невідомо.") }] };
      }
      const asks = mirrored ? book.aggregated.bids.map((l) => ({ price: 1 - l.price, size: l.size })).sort((a, b) => a.price - b.price) : [...book.aggregated.asks].sort((a, b) => a.price - b.price);
      const bids = mirrored ? book.aggregated.asks.map((l) => ({ price: 1 - l.price, size: l.size })).sort((a, b) => b.price - a.price) : [...book.aggregated.bids].sort((a, b) => b.price - a.price);
      const bestAsk = asks[0]?.price ?? null;
      const bestBid = bids[0]?.price ?? null;
      if (bestAsk == null) return emptyRun(name, "research", "empty");
      const near = asks.filter((l) => l.price <= bestAsk + 0.05).reduce((sum, l) => sum + l.price * l.size, 0);
      const cite = ctx.citations.add({ tool: name, source: `${book.venues.map((v) => venueTitle(v.venue)).join(", ") || venueTitle(market.venue)} · ${w(locale, "order books", "книги ордерів")}`, observedAt: book.readAt, state: "current", ref: market.id });
      sink.kinds.set(cite.id, "depth");
      const label = outcomeQuoted(outcome.label, locale);
      const facts: ToolFact[] = [fact("depth.ask", w(locale, "Best ask", "Найкраща ціна купівлі"), centsWords(bestAsk, locale), points(bestAsk), "¢", cite.id), fact("depth.near", w(locale, "Offered within 5 points", "Пропозиція в межах 5 пунктів"), usdWords(Math.round(near), locale), Math.round(near), "USD", cite.id)];
      const notes: ToolNote[] = [];
      if (bestBid != null) {
        const spread = bestAsk - bestBid;
        facts.push(fact("depth.spread", w(locale, "Spread", "Спред"), pointsWords(spread, locale).replace(/^\+/, ""), points(spread), "pp", cite.id));
        notes.push({ section: "observation", cites: [cite.id], text: w(locale, `${label} is offered from ${centsWords(bestAsk, locale)} and bid at ${centsWords(bestBid, locale)}; within five points of the best ask about ${usdWords(Math.round(near), locale)} is offered.`, `${label} продають від ${centsWords(bestAsk, locale)}, купують за ${centsWords(bestBid, locale)}; у межах п'яти пунктів від найкращої ціни пропонують близько ${usdWords(Math.round(near), locale)}.`) });
        if (spread >= 0.05) notes.push({ section: "risks", cites: [cite.id], text: w(locale, "A wide spread: buying and selling at once costs five points or more.", "Широкий спред: купити й одразу продати коштує п'ять пунктів і більше.") });
      }
      if (near < 500) notes.push({ section: "risks", cites: [cite.id], text: w(locale, "Thin liquidity: a larger order walks the book and fills at worse prices than the one shown.", "Мала ліквідність: більший ордер пройде книгою й виконається гіршою ціною, ніж показана.") });
      return { tool: name, kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

/** A plan draft — the entry, the most one can lose, the exit — for the plan builder, where the person decides. */
function planTool(read: Read, sink: PredictionToolSink): Tool {
  const name = "prediction_plan_prepare";
  return {
    name,
    kind: "prepare",
    description: "A plan draft on the outcome: the entry price to start from, the most the person can lose (the whole stake), and the exit — a price that says the thesis is wrong, and the close. A draft only: it opens in the plan builder for the person to change and save.",
    input: DraftSchema,
    run: async (input: z.output<typeof DraftSchema>, ctx: ToolContext): Promise<ToolRun> => {
      const s = await scoped(read, input, name, "prepare", ctx.locale);
      if (isRun(s)) return s;
      const { event, market, outcome } = s;
      const locale = ctx.locale;
      if (market.status !== "open") return { ...emptyRun(name, "prepare", "refused"), notes: [{ section: "actions", cites: [], text: w(locale, "No plan draft: the market takes no new orders.", "Чернетки плану немає: ринок не приймає нових ордерів.") }] };
      const book = await read.book(market.id);
      const mirrored = market.outcomes[0]?.id !== outcome.id;
      /* Only a yes-no market mirrors its book; a third outcome starts from its own last price. */
      const ask = book.ok && (!mirrored || market.outcomes.length === 2) ? (mirrored ? book.value.aggregated.bids.map((l) => 1 - l.price) : book.value.aggregated.asks.map((l) => l.price)).sort((a, b) => a - b)[0] : undefined;
      const at = new Date(ctx.nowMs).toISOString();
      const draft = planDraftFrom({ eventId: event.id, venueMarketId: market.id, outcomeId: outcome.id, outcomeLabel: outcome.label, question: market.question, price: ask ?? outcome.probability, amountUsd: input.amountUsd ?? null, deadline: market.endDate ?? event.endDate, readAt: at });
      if (!draft) return { ...emptyRun(name, "prepare", "empty"), notes: [{ section: "actions", cites: [], text: w(locale, "No plan draft: there is no price to start from in this read.", "Чернетки плану немає: у цьому читанні немає ціни, від якої почати.") }] };
      sink.draft = draft;
      const cite = ctx.citations.add({ tool: name, source: w(locale, "Plan draft from the price now", "Чернетка плану з поточної ціни"), observedAt: at, state: "current", ref: market.id });
      sink.kinds.set(cite.id, "market");
      const label = outcomeQuoted(outcome.label, locale);
      const deadline = dateWords(draft.deadline, locale);
      const facts: ToolFact[] = [
        fact("draft.entry", w(locale, "Entry from", "Вхід від"), centsWords(draft.entryProbability, locale), points(draft.entryProbability), "¢", cite.id),
        fact("draft.max", w(locale, "Entry not above", "Вхід не дорожче"), centsWords(draft.maxProbability, locale), points(draft.maxProbability), "¢", cite.id),
        fact("draft.loss", w(locale, "Most you can lose", "Максимум втрат"), usdWords(draft.amountUsd, locale), draft.amountUsd, "USD", cite.id),
      ];
      if (draft.invalidationBelow != null) facts.push(fact("draft.exit", w(locale, "Exit if below", "Вихід, якщо нижче"), pctWords(draft.invalidationBelow, locale), points(draft.invalidationBelow), "%", cite.id));
      if (deadline) facts.push(fact("draft.deadline", w(locale, "Until", "До"), deadline, null, null, cite.id));
      const notes: ToolNote[] = [
        { section: "actions", cites: [cite.id], text: w(locale, `Plan draft on ${label}: entry not above ${centsWords(draft.maxProbability, locale)}; the most you can lose is ${usdWords(draft.amountUsd, locale)}, the whole stake.`, `Чернетка плану на ${label}: вхід не дорожче ${centsWords(draft.maxProbability, locale)}; максимум втрат — ${usdWords(draft.amountUsd, locale)}, уся сума.`) },
        {
          section: "actions",
          cites: [cite.id],
          text:
            draft.invalidationBelow != null
              ? w(locale, `Exit: if ${label} falls below ${pctWords(draft.invalidationBelow, locale)}, or at the close${deadline ? ` on ${deadline}` : ""}.`, `Вихід: якщо ${label} опуститься нижче ${pctWords(draft.invalidationBelow, locale)}, або на закритті${deadline ? ` ${deadline}` : ""}.`)
              : w(locale, `Exit: at the close${deadline ? ` on ${deadline}` : ""}, or when your reason no longer holds.`, `Вихід: на закритті${deadline ? ` ${deadline}` : ""} або коли твоя причина перестала діяти.`),
        },
        { section: "actions", cites: [], text: w(locale, "It is a draft: open it in the plan, write your own reason, change any number and save it yourself. Nothing is placed without your Review.", "Це чернетка: відкрий її в плані, напиши свою причину, зміни будь-яке число й збережи сам. Без твого Review нічого не ставиться.") },
      ];
      return { tool: name, kind: "prepare", outcome: "ok", state: null, facts, notes, cards: [], handoffs: [], draft: null };
    },
  };
}

/**
 * The prediction tools for one request: the reads shared between them (one
 * event read however many ask), the sink for the sources' addresses and the
 * draft. The registry's boundary holds them like every other tool.
 */
export function createPredictionAgentTools(provider: PredictionProvider, sink: PredictionToolSink = newToolSink()): readonly RegisteredTool[] {
  const read = memoRead(provider);
  return [marketTool(read, sink), rulesTool(read, sink), moveTool(read, sink), newsTool(read, sink), depthTool(read, sink), planTool(read, sink)] as readonly RegisteredTool[];
}

export const PREDICTION_AGENT_TOOL_NAMES = ["prediction_market_read", "prediction_rules_read", "prediction_move_read", "prediction_news_read", "prediction_depth_read", "prediction_plan_prepare"] as const;
export type PredictionAgentToolName = (typeof PREDICTION_AGENT_TOOL_NAMES)[number];
