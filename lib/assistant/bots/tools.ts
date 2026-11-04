/**
 * Ryntra's tools for the bots hub (CITY-133, B3, bots spec «Помічник Ryntra»):
 *
 * - `bots.weather` — the market's weather for bots and how each bot fits it;
 * - `bots.suggest` — one bot and one alternative for a horizon and an amount, three reasons each, with the cost check;
 * - `bots.simulate` — the bot replayed over 7, 30 and 180 days: against holding, costs, worst drawdown, stress test;
 * - `bots.explain` — two lines on a kind of bot, on one of the wallet's bots («why is it in the red») or on all of them;
 * - `bots.draft` — a bot's settings for the window's review, never a transaction.
 *
 * Drafts only. No tool here signs, sends, holds a key or reaches a wallet:
 * the window's review and the person's own tap start a bot, and a test walks
 * every module these tools import to the end to prove none can sign. Every
 * figure is the engine's — its candles, its weather, its backtest with its
 * cost model, its Hangar — read through `BotsReaders`; a reader that did not
 * answer makes a tool say so, never guess. No tool takes free text: a
 * request is choices, numbers and addresses (`schema.ts`), so a post or a
 * message can never start one.
 *
 * No model is called: the answers are composed from the engine's figures.
 * Whether these tools spend assistant credits is open (AI-04, `credits.ts`).
 */

import type { Candle } from "../../bots/backtest/candles.ts";
import { DEFAULT_COSTS, type ExecutionCosts } from "../../bots/backtest/sim.ts";
import type { HangarAnswer, HangarBot } from "../../bots/hangar/hangar.ts";
import { marketWeather, type Fit, type Weather } from "../../bots/weather/weather.ts";
import { rankCandidates, readBot, runWindow, summarizeHangar, WINDOW_BARS, type BotCause, type WindowRun } from "./advice.ts";
import { BOT_CUSTODY, ENGINE_WEATHER_BOT, HORIZONS, SIM_DAYS, type AssistantBotKind, type AssistantGoal, type Horizon, type SimDays } from "./kinds.ts";
import { planFor, priceRound, weekSize, type Plan, type WeekSize } from "./plan.ts";
import { AssistantBotDraftSchema, type AssistantBotDraft, type BotsToolName, type BotsToolRequest } from "./schema.ts";
import { BOT_WORDS, pct, signedUsd, spanText, usd, type Locale } from "./words.ts";

/* ------------------------------------------------------------------ the engine's reads */

export type BotsTimeframe = "1h" | "4h" | "1d";

/** The engine's candles of a coin for one timeframe, oldest first, in dollars. */
export type BotsCandles = Readonly<{ candles: readonly Candle[]; observedAt: string; stale: boolean }>;

/** Whether a bot may stand on the coin's token (`lib/bots/backtest/mint-safety.ts`): read, and what keeps it out. */
export type BotsSafety = Readonly<{ read: boolean; ok: boolean; reasons: readonly string[] }>;

/**
 * The engine's reads the tools take. Each answers `null` when it was not read; the tool then says so. The Hangar's
 * reader is the chain's public read of a wallet's own bots — no reminder rule, nothing that needs the wallet's proof.
 */
export type BotsReaders = Readonly<{
  candles: (mint: string, timeframe: BotsTimeframe) => Promise<BotsCandles | null>;
  symbol?: (mint: string) => Promise<string | null>;
  safety?: (mint: string) => Promise<BotsSafety | null>;
  hangar?: (wallet: string) => Promise<HangarAnswer | null>;
  now?: () => number;
}>;

/* ------------------------------------------------------------------ answers */

type Common = Readonly<{ signs: false; source: "engine"; observedAt: string | null }>;

export type BotsRefusal = Common &
  Readonly<{ tool: BotsToolName; ok: false; reason: "no_history" | "no_weather" | "unsafe" | "not_read" | "not_found"; line: string }>;

export type WeatherAnswer = Common &
  Readonly<{
    tool: "weather";
    ok: true;
    line: string;
    weather: Readonly<{
      kind: Weather["kind"];
      direction: Weather["direction"];
      fit: Readonly<Record<AssistantBotKind, Fit>>;
      dayMovePct: number;
      low: number;
      high: number;
      price: number;
    }>;
  }>;

export type Pick = Readonly<{ kind: AssistantBotKind; fit: Fit; plan: Plan; reasons: readonly string[]; run: WindowRun }>;

export type SuggestAnswer = Common &
  Readonly<
    | { tool: "suggest"; ok: true; ask: Readonly<{ key: "horizon" | "amount"; options: readonly (string | number)[] }>; line: string }
    | { tool: "suggest"; ok: true; ask: null; horizon: Horizon; amountUsd: number; pick: Pick | null; alternative: Pick | null; line: string; detail: string | null }
  >;

export type SimulateAnswer = Common &
  Readonly<{ tool: "simulate"; ok: true; kind: AssistantBotKind; amountUsd: number; horizon: Horizon; plan: Plan; windows: readonly WindowRun[]; line: string; lines: readonly string[]; stress: string | null }>;

export type ExplainAnswer = Common &
  Readonly<{ tool: "explain"; ok: true; lines: readonly [string, string] | readonly [string]; cause: BotCause | null; botId: string | null }>;

export type DraftAnswer = Common & Readonly<{ tool: "draft"; ok: true; draft: AssistantBotDraft; line: string }>;

export type BotsToolAnswer = BotsRefusal | WeatherAnswer | SuggestAnswer | SimulateAnswer | ExplainAnswer | DraftAnswer;

/* ------------------------------------------------------------------ shared reads */

/** Hourly bars a week holds; fewer than a day of them is no week to try a bot on (the window's `MIN_BARS`). */
const WEEK_BARS = 168;
const MIN_WEEK_BARS = 24;
/** Wrapped SOL: its own price pays the network's fees in a replay of SOL. */
const WSOL = "So11111111111111111111111111111111111111112";

const common = (observedAt: string | null): Common => ({ signs: false, source: "engine", observedAt });
const refuse = (tool: BotsToolName, reason: BotsRefusal["reason"], line: string, observedAt: string | null = null): BotsRefusal => ({ ...common(observedAt), tool, ok: false, reason, line });

type Week = Readonly<{ bars: readonly Candle[]; weather: Weather | null; size: WeekSize; observedAt: string }>;

async function readWeek(readers: BotsReaders, mint: string): Promise<Week | "not_read" | "no_history"> {
  const read = await readers.candles(mint, "1h").catch(() => null);
  if (!read) return "not_read";
  const bars = read.candles.slice(-WEEK_BARS);
  const size = bars.length >= MIN_WEEK_BARS ? weekSize(bars) : null;
  if (!size) return "no_history";
  return { bars, weather: marketWeather(bars), size, observedAt: read.observedAt };
}

async function symbolOf(readers: BotsReaders, mint: string, locale: Locale): Promise<string> {
  const symbol = await readers.symbol?.(mint).catch(() => null);
  return symbol && /^[\p{L}\p{N}$._\-]{1,16}$/u.test(symbol) ? symbol : BOT_WORDS[locale].coin;
}

/** A coin whose token the engine read and found unsafe for a bot; not read is said behind «Details», never passed as safe. */
async function unsafe(readers: BotsReaders, mint: string): Promise<boolean> {
  const safety = await readers.safety?.(mint).catch(() => null);
  return Boolean(safety && safety.read && !safety.ok);
}

function costsFor(mint: string, price: number): ExecutionCosts {
  return mint === WSOL && price > 0 ? { ...DEFAULT_COSTS, solUsd: price } : DEFAULT_COSTS;
}

const weatherWord = (weather: Weather, locale: Locale) => {
  const w = BOT_WORDS[locale].weather;
  return weather.kind === "trend" && weather.direction ? w[weather.direction === "up" ? "trend_up" : "trend_down"] : w[weather.kind];
};

async function windowCandles(readers: BotsReaders, mint: string, days: SimDays, week: Week): Promise<readonly Candle[] | null> {
  const timeframe = WINDOW_BARS[days].timeframe;
  if (timeframe === "1h") {
    const read = await readers.candles(mint, "1h").catch(() => null);
    return read ? read.candles : week.bars;
  }
  const read = await readers.candles(mint, timeframe).catch(() => null);
  return read ? read.candles : null;
}

function resultLine(run: WindowRun, amountUsd: number, locale: Locale): string | null {
  const w = BOT_WORDS[locale];
  if (!run.ok) return null;
  if (!run.costs.worth) return w.notWorth(pct(run.costs.sharePct, locale), usd(amountUsd, locale), run.costs.fromUsd ? usd(run.costs.fromUsd, locale) : null);
  return run.vsHoldUsd >= 0 ? w.beat(w.lastSpan(run.days), usd(run.vsHoldUsd, locale)) : w.trailed(w.lastSpan(run.days), usd(-run.vsHoldUsd, locale));
}

/* ------------------------------------------------------------------ bots.weather */

export async function botsWeather(request: Extract<BotsToolRequest, { tool: "weather" }>, readers: BotsReaders): Promise<WeatherAnswer | BotsRefusal> {
  const { locale, mint } = request;
  const w = BOT_WORDS[locale];
  const [week, symbol] = await Promise.all([readWeek(readers, mint), symbolOf(readers, mint, locale)]);
  if (week === "not_read") return refuse("weather", "not_read", w.notRead(symbol));
  if (week === "no_history") return refuse("weather", "no_history", w.noHistory(symbol));
  if (!week.weather) return refuse("weather", "no_weather", w.noWeather(symbol), week.observedAt);
  const weather = week.weather;
  const fit = Object.fromEntries((Object.keys(ENGINE_WEATHER_BOT) as AssistantBotKind[]).map((kind) => [kind, weather.fit[ENGINE_WEATHER_BOT[kind]].fit])) as Record<AssistantBotKind, Fit>;
  const best = (Object.keys(fit) as AssistantBotKind[]).find((kind) => fit[kind] === "good") ?? null;
  const line = best ? `${weather.line[locale]}. ${w.botIn[best]} — ${w.fit.good}.` : `${weather.line[locale]}.`;
  return {
    ...common(week.observedAt),
    tool: "weather",
    ok: true,
    line,
    weather: { kind: weather.kind, direction: weather.direction, fit, dayMovePct: week.size.dayMovePct, low: week.size.low, high: week.size.high, price: week.size.price },
  };
}

/* ------------------------------------------------------------------ bots.suggest */

/** How many of the engine's best bots are replayed before one is named. */
const SUGGEST_TRIES = 3;

export async function botsSuggest(request: Extract<BotsToolRequest, { tool: "suggest" }>, readers: BotsReaders): Promise<SuggestAnswer | BotsRefusal> {
  const { locale, mint } = request;
  const w = BOT_WORDS[locale];
  // The horizon first, then the amount: a bot is sized to both.
  if (!request.horizon) return { ...common(null), tool: "suggest", ok: true, ask: { key: "horizon", options: ["week", "month", "half_year"] }, line: w.askHorizon };
  if (request.amountUsd === undefined) return { ...common(null), tool: "suggest", ok: true, ask: { key: "amount", options: [50, 100, 250, 500] }, line: w.askAmount };
  const horizon = request.horizon;
  const amountUsd = request.amountUsd;
  const goal: AssistantGoal | null = request.goal ?? null;
  const [week, symbol, isUnsafe] = await Promise.all([readWeek(readers, mint), symbolOf(readers, mint, locale), unsafe(readers, mint)]);
  if (isUnsafe) return refuse("suggest", "unsafe", w.unsafe(symbol));
  if (week === "not_read" || week === "no_history") return refuse("suggest", week, week === "not_read" ? w.notRead(symbol) : w.noHistory(symbol));
  if (!week.weather) return refuse("suggest", "no_weather", w.noWeather(symbol), week.observedAt);
  const weather = week.weather;
  const ranked = rankCandidates(weather, horizon, goal);
  const sky = weatherWord(weather, locale);
  if (ranked.length === 0) return { ...common(week.observedAt), tool: "suggest", ok: true, ask: null, horizon, amountUsd, pick: null, alternative: null, line: w.nothingFits(sky), detail: null };

  const days = HORIZONS[horizon] as SimDays;
  const candles = await windowCandles(readers, mint, days, week);
  const costs = costsFor(mint, week.size.price);
  const picks: Pick[] = ranked.slice(0, SUGGEST_TRIES).map((candidate) => {
    const plan = planFor(candidate.kind, amountUsd, horizon, week.size.dayMovePct);
    return {
      kind: candidate.kind,
      fit: candidate.fit,
      plan,
      reasons: [w.reasonFit(sky, w.bot[candidate.kind], w.fit[candidate.fit]), w.forHorizon[horizon], w.reasonCustody[BOT_CUSTODY[candidate.kind]]],
      run: runWindow(days, candles, plan, amountUsd, symbol, costs),
    };
  });
  // The engine's best fit whose costs do not eat the amount; when every one's do, the best fit, and the line says so.
  const pick = picks.find((p) => p.run.ok && p.run.costs.worth) ?? picks[0]!;
  const alternative = picks.find((p) => p !== pick) ?? null;
  return {
    ...common(week.observedAt),
    tool: "suggest",
    ok: true,
    ask: null,
    horizon,
    amountUsd,
    pick,
    alternative,
    line: w.pick(sky, w.bot[pick.kind], symbol),
    detail: resultLine(pick.run, amountUsd, locale),
  };
}

/* ------------------------------------------------------------------ bots.simulate */

export async function botsSimulate(request: Extract<BotsToolRequest, { tool: "simulate" }>, readers: BotsReaders): Promise<SimulateAnswer | BotsRefusal> {
  const { locale, mint, kind, amountUsd, horizon } = request;
  const w = BOT_WORDS[locale];
  const [week, symbol, isUnsafe] = await Promise.all([readWeek(readers, mint), symbolOf(readers, mint, locale), unsafe(readers, mint)]);
  if (isUnsafe) return refuse("simulate", "unsafe", w.unsafe(symbol));
  if (week === "not_read" || week === "no_history") return refuse("simulate", week, week === "not_read" ? w.notRead(symbol) : w.noHistory(symbol));
  const plan = planFor(kind, amountUsd, horizon, week.size.dayMovePct);
  const costs = costsFor(mint, week.size.price);
  const windows = await Promise.all(SIM_DAYS.map(async (days) => runWindow(days, await windowCandles(readers, mint, days, week), plan, amountUsd, symbol, costs)));
  const main = windows.find((run) => run.days === HORIZONS[horizon]) ?? windows[0]!;
  const said = resultLine(main, amountUsd, locale);
  const stress = main.ok ? w.stress(symbol, main.stress.shockPct, usd(-main.stress.lossUsd, locale)) : null;
  return {
    ...common(week.observedAt),
    tool: "simulate",
    ok: true,
    kind,
    amountUsd,
    horizon,
    plan,
    windows,
    line: said ?? w.simulated(w.botIn[kind], symbol),
    lines: [w.simulated(w.botIn[kind], symbol), w.past],
    stress,
  };
}

/* ------------------------------------------------------------------ bots.explain */

const STATE_LINE = (bot: HangarBot, cause: BotCause, locale: Locale): string => {
  const c = BOT_WORDS[locale].cause;
  if (cause === "range_above" || cause === "range_below" || cause === "needs_you" || cause === "done") return c[cause];
  return bot.status === "working" ? c.working : c.waiting;
};

function resultOf(cause: BotCause, vsHoldUsd: number | null, days: number | null, feesUsd: number | null, locale: Locale): string {
  const c = BOT_WORDS[locale].cause;
  if (vsHoldUsd === null || days === null) return c.unpriced;
  const span = spanText(days, locale);
  if (vsHoldUsd < 0) return feesUsd && feesUsd > 0 ? c.behindFees(usd(-vsHoldUsd, locale), span, usd(feesUsd, locale)) : c.behind(usd(-vsHoldUsd, locale), span);
  return cause === "done" ? c.ahead(usd(vsHoldUsd, locale), span) : c.ahead(usd(vsHoldUsd, locale), span);
}

export async function botsExplain(request: Extract<BotsToolRequest, { tool: "explain" }>, readers: BotsReaders): Promise<ExplainAnswer | BotsRefusal> {
  const { locale, subject } = request;
  const w = BOT_WORDS[locale];
  if (subject.about === "kind") return { ...common(null), tool: "explain", ok: true, lines: w.explainKind[subject.kind], cause: null, botId: null };
  const answer = readers.hangar ? await readers.hangar(subject.wallet).catch(() => null) : null;
  if (!answer || answer.wallet !== subject.wallet) return refuse("explain", "not_read", w.cause.unpriced);
  const at = Number.isFinite(answer.at) && answer.at > 0 ? new Date(answer.at).toISOString() : null;
  if (subject.about === "hangar") {
    const summary = summarizeHangar(answer.bots);
    if (summary.live === 0) return { ...common(at), tool: "explain", ok: true, lines: [w.summaryNone], cause: null, botId: null };
    const first = w.summary(summary.live, summary.vsHoldUsd === null ? null : signedUsd(summary.vsHoldUsd, locale));
    const second = summary.attention ? w.attention(summary.attention.name) : summary.best && summary.worst ? w.bestWorst(summary.best.name, summary.worst.name) : null;
    return { ...common(at), tool: "explain", ok: true, lines: second ? [first, second] : [first], cause: null, botId: null };
  }
  const bot = answer.bots.find((b) => b.id === subject.botId);
  if (!bot) return refuse("explain", "not_found", w.notFound, at);
  const reading = readBot(bot);
  return {
    ...common(at),
    tool: "explain",
    ok: true,
    lines: [STATE_LINE(bot, reading.cause, locale), resultOf(reading.cause, reading.vsHoldUsd, reading.days, reading.feesUsd, locale)],
    cause: reading.cause,
    botId: bot.id,
  };
}

/* ------------------------------------------------------------------ bots.draft */

export async function botsDraft(request: Extract<BotsToolRequest, { tool: "draft" }>, readers: BotsReaders): Promise<DraftAnswer | BotsRefusal> {
  const { locale, mint, kind, amountUsd, horizon } = request;
  const w = BOT_WORDS[locale];
  const [week, symbol, isUnsafe] = await Promise.all([readWeek(readers, mint), symbolOf(readers, mint, locale), unsafe(readers, mint)]);
  if (isUnsafe) return refuse("draft", "unsafe", w.unsafe(symbol));
  if (week === "not_read" || week === "no_history") return refuse("draft", week, week === "not_read" ? w.notRead(symbol) : w.noHistory(symbol));
  const price = week.size.price;
  const plan = planFor(kind, amountUsd, horizon, week.size.dayMovePct);
  const now = readers.now?.() ?? Date.now();
  const draft = AssistantBotDraftSchema.parse({
    schema: "ryntra.bot-draft",
    schemaVersion: "1.0.0",
    status: "draft",
    signs: false,
    kind,
    mint,
    symbol: symbol.slice(0, 32),
    amountUsd,
    horizon,
    price,
    exit: kind === "recurring" ? "stop" : "wait",
    grid: plan.kind === "grid" ? { lower: priceRound(price * (1 - plan.lowerPct / 100)), upper: priceRound(price * (1 + plan.upperPct / 100)), levels: plan.levels } : null,
    ladder: plan.kind === "buyLadder" || plan.kind === "exitLadder" ? { steps: plan.steps, firstPct: plan.firstPct, lastPct: plan.lastPct } : null,
    recurring: plan.kind === "recurring" ? { everyHours: plan.everyHours, buys: plan.buys } : null,
    createdAt: new Date(now).toISOString(),
  } satisfies AssistantBotDraft);
  return { ...common(week.observedAt), tool: "draft", ok: true, draft, line: w.draftReady(w.botIn[kind], symbol, usd(amountUsd, locale)) };
}

/* ------------------------------------------------------------------ the registry */

/** Each tool by its registry name and what it is: every one a read or a draft, none an action. */
export const BOTS_TOOLS = [
  { name: "bots.weather", kind: "read", run: botsWeather },
  { name: "bots.suggest", kind: "read", run: botsSuggest },
  { name: "bots.simulate", kind: "read", run: botsSimulate },
  { name: "bots.explain", kind: "read", run: botsExplain },
  { name: "bots.draft", kind: "draft", run: botsDraft },
] as const;

/** One request to the tool it names. */
export function runBotsTool(request: BotsToolRequest, readers: BotsReaders): Promise<BotsToolAnswer> {
  switch (request.tool) {
    case "weather":
      return botsWeather(request, readers);
    case "suggest":
      return botsSuggest(request, readers);
    case "simulate":
      return botsSimulate(request, readers);
    case "explain":
      return botsExplain(request, readers);
    case "draft":
      return botsDraft(request, readers);
  }
}
