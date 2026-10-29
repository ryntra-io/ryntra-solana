/**
 * The market-data tools (AI-03) — read-only, from the market's public sources.
 *
 * Six reads a person's «why is it moving?», «is it a scam?» and «what is
 * moving today?» need and the catalogue alone does not answer: DexScreener's
 * pairs (volume, depth, buys and sells over four windows), RugCheck's risk
 * report, GeckoTerminal's candles (the day's range and the week's move),
 * Pulse's movers, Meteora's pools, and Market Health of a market launched
 * on Ryntra. Each reads through the reader seam (`readers.ts`), never a
 * provider from here; each figure carries its source and the time it was
 * read; a source that did not answer is said as missing, never as zero; a
 * figure a source did not state is left out of the sentence and out of the
 * facts, never printed as «unavailable»; and no sentence here tells a person
 * to buy or to sell.
 *
 * The few figures a tool works out — a day's range from its candles, the
 * last hour's volume against the day's hourly average — are arithmetic on
 * one source's figures at one moment, said with the figures they stand on so
 * the verifier can hold a model to them.
 */

import { z } from "zod";

import type { AgentFigure, AgentState } from "../../api/v1/contract.ts";
import { FRESHNESS_MS, countText, figure, pctText, stateOf, usdCompactText, whenText, type Locale } from "../provenance.ts";
import { label, summariseDexPairs } from "../../assistant/data/dexscreener.ts";
import { resolveAsset, type CandleBar, type MoverRow } from "./readers.ts";
import { w } from "./research.ts";
import { emptyRun, type AgentTool, type ToolContext, type ToolFact, type ToolNote, type ToolRun } from "./types.ts";

const Query = z.string().min(1).max(44);
const QueryInput = z.object({ query: Query }).strict();

const fact = (f: AgentFigure, key: string): ToolFact => ({ key, label: f.label, value: f.value, number: f.number, unit: f.unit, state: f.state, cite: f.cite });
const note = (section: ToolNote["section"], text: string, cites: readonly string[]): ToolNote => ({ section, text: text.slice(0, 400), cites });
/**
 * The figures a source stated, as facts. A figure with no number is no fact —
 * the model is never handed «unavailable» or «stale» to repeat as if it were a
 * value — except the few that are words by nature (`words`).
 */
const factsOf = (prefix: string, figures: Readonly<Record<string, AgentFigure>>, words: readonly string[] = []): ToolFact[] =>
  Object.entries(figures)
    .filter(([key, value]) => value.number !== null || words.includes(key))
    .map(([key, value]) => fact(value, `${prefix}.${key}`));
/** The read's state after «— read …,»: an adverb clause. */
const stateText = (state: AgentState, locale: Locale): string => (state === "current" ? w(locale, "current", "актуально") : state === "stale" ? w(locale, "stale", "застаріло") : w(locale, "unknown", "невідомо"));
/** The state of plural figures as a predicate: «Цифри … застарілі». */
const statePlural = (state: AgentState, locale: Locale): string => (state === "current" ? w(locale, "current", "актуальні") : state === "stale" ? w(locale, "stale", "застарілі") : w(locale, "unknown", "невідомі"));
const pct = (value: number | null, locale: Locale) => pctText(value, locale);
const bare = (value: number | null, locale: Locale) => pctText(value, locale).replace(/^\+/, "");
/** A Ukrainian count noun: one, few (2–4), many — by the last digits. */
export const ukPlural = (n: number, one: string, few: string, many: string): string => {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
};
/** The clauses that stand on a figure the source stated, joined; a missing one is not said. */
const clauses = (parts: readonly (string | null)[], glue = ", "): string => parts.filter((part): part is string => part !== null).join(glue);

/** The asset a query names, as a mint and a symbol; the run to return when it names none. */
async function subject(tool: string, query: string, ctx: ToolContext): Promise<Readonly<{ mint: string; symbol: string }> | ToolRun> {
  const resolved = await resolveAsset(ctx.readers, query);
  if (resolved.kind === "none") return emptyRun(tool, "research", resolved.reason === "not-listed" || resolved.reason === "retired" ? "empty" : "unavailable");
  return { mint: resolved.mint, symbol: label(resolved.symbol, "token", 32) };
}

/** A source that did not answer, said as a gap — never the transport's words or code (AI-21: «HTTP 429» is the server's to read, not the person's). */
function missing(tool: string, source: string, symbol: string, ctx: ToolContext): ToolRun {
  const locale = ctx.locale;
  const cite = ctx.citations.add({ tool, source, observedAt: null, state: "unavailable", ref: null, href: null });
  return { ...emptyRun(tool, "research", "unavailable", "unavailable"), notes: [note("risks", w(locale, `${source} could not be read for ${symbol} right now; what it would show is missing here, not zero.`, `${source} зараз не прочитати для ${symbol}; те, що він показав би, тут відсутнє, а не нуль.`), [cite.id])] };
}

/* ------------------------------------------------------------ DexScreener: pairs */

export const dexPairsRead: AgentTool<typeof QueryInput> = {
  name: "dex_pairs_read",
  kind: "research",
  description: "DexScreener's Solana pairs for one token: volume over 5 min, 1 h, 6 h and 24 h, depth, price change over the same windows, buys and sells — with the time read.",
  input: QueryInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const found = await subject("dex_pairs_read", input.query, ctx);
    if ("tool" in found) return found;
    const read = await ctx.readers.dexPairs(found.mint);
    if (!read.ok) return missing("dex_pairs_read", "DexScreener", found.symbol, ctx);
    const state: AgentState = read.stale ? "stale" : stateOf(read.observedAt, FRESHNESS_MS.market, ctx.nowMs);
    const summary = summariseDexPairs(read.pairs);
    const top = summary.top;
    if (top === null) {
      const cite = ctx.citations.add({ tool: "dex_pairs_read", source: "DexScreener", observedAt: read.observedAt, state, ref: found.mint, href: null });
      const words =
        read.pairs.length === 0
          ? w(locale, `DexScreener lists no Solana pair trading ${found.symbol}.`, `DexScreener не має жодної пари на Solana, де торгується ${found.symbol}.`)
          : summary.majors.length > 0
            ? w(locale, `DexScreener lists ${found.symbol} only as the second token of its pairs against USDC, USDT or SOL; their price is the other token's, so none is said here.`, `DexScreener має ${found.symbol} лише другим токеном у парах проти USDC, USDT чи SOL; їхня ціна — іншого токена, тож тут її не наведено.`)
            : w(locale, `DexScreener lists pairs of ${found.symbol}, none of them against USDC, USDT or SOL — their figures are not said here.`, `DexScreener має пари з ${found.symbol}, але жодної проти USDC, USDT чи SOL — їхні цифри тут не наводяться.`);
      return { ...emptyRun("dex_pairs_read", "research", "empty", state), notes: [note("observation", words, [cite.id])] };
    }
    const venue = `${top.baseSymbol}/${top.quoteSymbol} · ${top.dex}`;
    const cite = ctx.citations.add({ tool: "dex_pairs_read", source: `DexScreener · ${venue}`, observedAt: read.observedAt, state, ref: top.pairAddress, href: null });
    const f = (label: [string, string], number: number | null, kind: "usd" | "usdCompact" | "pct" | "count") => figure({ label: w(locale, label[0], label[1]), number, kind, unit: kind === "pct" ? "%" : kind === "count" ? null : "USD", state, cite: cite.id }, locale);
    const figures = {
      pairs: f(["Pairs against USDC, USDT or SOL", "Пари проти USDC, USDT чи SOL"], summary.majors.length, "count"),
      volume24h: f(["24h volume in those pairs", "Обсяг за 24 год у цих парах"], summary.volume24hUsd, "usdCompact"),
      liquidity: f(["Deepest pair's liquidity", "Ліквідність найглибшої пари"], top.liquidityUsd, "usdCompact"),
      volume1h: f(["1h volume, deepest pair", "Обсяг за 1 год, найглибша пара"], top.volumeUsd.h1, "usdCompact"),
      change5m: f(["5 min change", "Зміна за 5 хв"], top.changePct.m5, "pct"),
      change1h: f(["1h change", "Зміна за 1 год"], top.changePct.h1, "pct"),
      change6h: f(["6h change", "Зміна за 6 год"], top.changePct.h6, "pct"),
      change24h: f(["24h change", "Зміна за 24 год"], top.changePct.h24, "pct"),
      buys24h: f(["Buys, 24h", "Купівлі, 24 год"], top.txns.h24.buys, "count"),
      sells24h: f(["Sells, 24h", "Продажі, 24 год"], top.txns.h24.sells, "count"),
    };
    const facts = factsOf("dex", figures);
    const when = whenText(read.observedAt, locale);
    const others = read.pairs.length - summary.majors.length;
    const n = summary.majors.length;
    const depth = top.liquidityUsd === null ? null : w(locale, `the deepest, ${venue}, holds ${figures.liquidity.value}`, `найглибша, ${venue}, тримає ${figures.liquidity.value}`);
    const volume = summary.volume24hUsd === null ? null : w(locale, `24h volume in them ${figures.volume24h.value}`, `обсяг за 24 год у них — ${figures.volume24h.value}`);
    const notes: ToolNote[] = [
      note("observation", w(locale, `On DexScreener ${found.symbol} trades in ${n} pair${n === 1 ? "" : "s"} against USDC, USDT or SOL; ${clauses([depth ?? `the deepest is ${venue}`, volume], "; ")} — read ${when}, ${stateText(state, locale)}.`, `На DexScreener ${found.symbol} має ${n} ${ukPlural(n, "пару", "пари", "пар")} проти USDC, USDT чи SOL; ${clauses([depth ?? `найглибша — ${venue}`, volume], "; ")} — прочитано ${when}, ${stateText(state, locale)}.`), [cite.id]),
    ];
    /* The windows the pair states, and only those. */
    const spans = ([["m5", "5 min", "5 хв"], ["h1", "1 h", "1 год"], ["h6", "6 h", "6 год"], ["h24", "24 h", "24 год"]] as const).filter(([key]) => top.changePct[key] !== null);
    if (spans.length > 0) notes.push(note("observation", w(locale, `On that pair the price moved ${spans.map(([key, en]) => `${pct(top.changePct[key], locale)} in ${en}`).join(", ")}.`, `На цій парі ціна змінилась: ${spans.map(([key, , uk]) => `${pct(top.changePct[key], locale)} за ${uk}`).join(", ")}.`), [cite.id]));
    if (others > 0) notes.push(note("counter", w(locale, `DexScreener also lists ${others} pair${others === 1 ? "" : "s"} of ${found.symbol} against other tokens; anyone can open such a pool and print any depth in it, so their figures are left out.`, `DexScreener має ще ${others} ${ukPlural(others, "пару", "пари", "пар")} з ${found.symbol} проти інших токенів; такий пул може відкрити будь-хто й показати в ньому будь-яку глибину, тож їхні цифри не враховано.`), [cite.id]));
    const buys = top.txns.h24.buys;
    const sells = top.txns.h24.sells;
    if (buys !== null && sells !== null && buys + sells > 0) {
      const side = buys > sells * 1.1 ? w(locale, "buys ahead", "купівель більше") : sells > buys * 1.1 ? w(locale, "sells ahead", "продажів більше") : w(locale, "about even", "приблизно порівну");
      notes.push(note("meaning", w(locale, `Over 24 h that pair saw ${countText(buys, locale)} buys and ${countText(sells, locale)} sells — ${side} by count of trades, which is not the same as by dollars.`, `За 24 год на цій парі купівель — ${countText(buys, locale)}, продажів — ${countText(sells, locale)}: ${side} за кількістю угод, що не те саме, що за доларами.`), [cite.id]));
    }
    const h1 = top.volumeUsd.h1;
    const h24 = top.volumeUsd.h24;
    if (h1 !== null && h24 !== null && h24 > 0) {
      const average = h24 / 24;
      const ratio = Math.round((h1 / average) * 10) / 10;
      const pace = ratio >= 1.3 ? w(locale, "busier than the day's pace", "активніше за денний темп") : ratio <= 0.7 ? w(locale, "quieter than the day's pace", "тихіше за денний темп") : w(locale, "close to the day's pace", "близько до денного темпу");
      const times = ratio.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 });
      notes.push(note("meaning", w(locale, `The last hour traded ${usdCompactText(h1, locale)} on that pair against an hourly average of ${usdCompactText(average, locale)} over the day (${times}×) — ${pace}.`, `За останню годину на цій парі проторгували ${usdCompactText(h1, locale)} проти середніх ${usdCompactText(average, locale)} на годину за добу (${times}×) — ${pace}.`), [cite.id]));
    }
    if (top.liquidityUsd !== null && top.liquidityUsd < 100_000) notes.push(note("risks", w(locale, `The deepest pair holds ${figures.liquidity.value}: a sum of a few thousand dollars can move this price.`, `Найглибша пара тримає ${figures.liquidity.value}: сума в кілька тисяч доларів може зрушити цю ціну.`), [cite.id]));
    if (state !== "current") notes.push(note("risks", w(locale, `DexScreener's figures are ${statePlural(state, locale)}; a decision needs a fresh read.`, `Цифри DexScreener ${statePlural(state, locale)}; рішенню потрібне свіже читання.`), [cite.id]));
    notes.push(note("counter", w(locale, `Volume and trade counts say how much changed hands, not why; one large wallet can make a busy hour.`, `Обсяг і кількість угод кажуть, скільки перейшло з рук у руки, а не чому; один великий гаманець може зробити годину жвавою.`), [cite.id]));
    return { tool: "dex_pairs_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [], draft: null };
  },
};

/* ------------------------------------------------------------ RugCheck: the report */

const levelWord = (level: "danger" | "warn" | "info", locale: Locale) => (level === "danger" ? w(locale, "danger", "небезпека") : level === "warn" ? w(locale, "warning", "увага") : w(locale, "note", "довідка"));

export const tokenReportRead: AgentTool<typeof QueryInput> = {
  name: "token_report_read",
  kind: "research",
  description: "RugCheck's report for one token: the risks it lists with their level, its normalised score and the share of pool liquidity it sees locked — an opinion of structure, never a verdict of safety.",
  input: QueryInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const found = await subject("token_report_read", input.query, ctx);
    if ("tool" in found) return found;
    const read = await ctx.readers.tokenReport(found.mint);
    if (!read.ok) return missing("token_report_read", "RugCheck", found.symbol, ctx);
    const state: AgentState = read.stale ? "stale" : "current";
    const cite = ctx.citations.add({ tool: "token_report_read", source: "RugCheck", observedAt: read.observedAt, state, ref: found.mint, href: null });
    if (read.report === null) return { ...emptyRun("token_report_read", "research", "empty", state), notes: [note("observation", w(locale, `RugCheck has no report for ${found.symbol}.`, `RugCheck не має звіту про ${found.symbol}.`), [cite.id])] };
    const report = read.report;
    const danger = report.risks.filter((risk) => risk.level === "danger");
    const count = report.risks.length;
    const figures = {
      flags: figure({ label: w(locale, "RugCheck flags", "Позначки RugCheck"), number: count, kind: "count", state, cite: cite.id }, locale),
      danger: figure({ label: w(locale, "Danger flags", "Позначки «небезпека»"), number: danger.length, kind: "count", state, cite: cite.id }, locale),
      score: figure({ label: w(locale, "RugCheck score (lower is fewer flags)", "Оцінка RugCheck (менше — менше позначок)"), number: report.score, kind: "count", state, cite: cite.id }, locale),
      lpLocked: figure({ label: w(locale, "Pool liquidity locked", "Заблокована ліквідність пулів"), number: null, kind: "text", text: report.lpLockedPct === null ? undefined : bare(report.lpLockedPct, locale), state, cite: cite.id }, locale),
    };
    const facts = factsOf("rugcheck", figures, report.lpLockedPct === null ? [] : ["lpLocked"]);
    /* Three names at most, set apart by semicolons, so a long list still breaks into blocks of two lines. */
    const listed = report.risks.slice(0, 3).map((risk) => `«${risk.name}» (${levelWord(risk.level, locale)})`).join("; ");
    const more = count > 3 ? w(locale, `; ${count - 3} more`, `; ще ${count - 3}`) : "";
    const notes: ToolNote[] = [
      count === 0
        ? note("observation", w(locale, `RugCheck lists no risk flags for ${found.symbol}; that is what it checked, not a guarantee.`, `RugCheck не має позначок ризику для ${found.symbol}; це те, що він перевірив, а не гарантія.`), [cite.id])
        : note("observation", w(locale, `RugCheck lists ${count} flag${count === 1 ? "" : "s"} for ${found.symbol}: ${listed}${more}.`, `RugCheck має ${count} ${ukPlural(count, "позначку", "позначки", "позначок")} для ${found.symbol}: ${listed}${more}.`), [cite.id]),
    ];
    const said = clauses([report.score === null ? null : w(locale, `its score is ${figures.score.value} (lower is fewer flags)`, `його оцінка — ${figures.score.value} (менше — менше позначок)`), report.lpLockedPct === null ? null : w(locale, `locked pool liquidity ${bare(report.lpLockedPct, locale)}`, `заблокована ліквідність пулів — ${bare(report.lpLockedPct, locale)}`)], "; ");
    if (said.length > 0) notes.push(note("observation", `${said[0].toUpperCase()}${said.slice(1)}.`, [cite.id]));
    for (const risk of danger.slice(0, 3)) notes.push(note("risks", w(locale, `RugCheck marks «${risk.name}» as a danger for ${found.symbol}.`, `RugCheck позначає «${risk.name}» як небезпеку для ${found.symbol}.`), [cite.id]));
    notes.push(note("counter", w(locale, `A report reads the token's structure at one moment by the service's own rules; it does not see intent, and no report makes a token safe.`, `Звіт читає структуру токена в один момент за власними правилами сервісу; намірів він не бачить, і жоден звіт не робить токен безпечним.`), [cite.id]));
    return { tool: "token_report_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [], draft: null };
  },
};

/* ------------------------------------------------------------ GeckoTerminal: candles */

const CandlesInput = z.object({ query: Query, timeframe: z.enum(["1h", "4h"]).default("1h") }).strict();

const NO_CHART: Readonly<Record<string, readonly [string, string]>> = {
  NO_POOL: ["no pool deep or active enough for a chart", "немає пулу, достатньо глибокого чи активного для графіка"],
  NO_MAJOR_QUOTE: ["no pool deep or active enough for a chart", "немає пулу, достатньо глибокого чи активного для графіка"],
  THIN: ["no pool deep or active enough for a chart", "немає пулу, достатньо глибокого чи активного для графіка"],
  QUIET: ["no pool deep or active enough for a chart", "немає пулу, достатньо глибокого чи активного для графіка"],
  STALE: ["the newest candle is too old", "найновіша свічка надто стара"],
  PRICE_MISMATCH: ["the chart disagreed with the catalogue price and was not used", "графік розійшовся з ціною каталогу, тож не використаний"],
};

const BAR_SECONDS = { "1h": 3600, "4h": 4 * 3600 } as const;

export const candlesRead: AgentTool<typeof CandlesInput> = {
  name: "candles_read",
  kind: "research",
  description: "GeckoTerminal's candles for one token on the pool the chart uses: the last close, the day's high, low and range, the move over 24 hours and over 7 days — by the clock, not by the last bar.",
  input: CandlesInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const found = await subject("candles_read", input.query, ctx);
    if ("tool" in found) return found;
    const read = await ctx.readers.candles(found.mint, input.timeframe);
    const noCandles = (en: string, uk: string) => {
      const cite = ctx.citations.add({ tool: "candles_read", source: "GeckoTerminal", observedAt: null, state: "unavailable", ref: found.mint, href: null });
      return { ...emptyRun("candles_read", "research", "empty", "unavailable"), notes: [note("risks", w(locale, `No candles for ${found.symbol}: ${en}.`, `Свічок для ${found.symbol} немає: ${uk}.`), [cite.id])] };
    };
    if (!read.ok) {
      const words = NO_CHART[read.code];
      return words ? noCandles(words[0], words[1]) : missing("candles_read", "GeckoTerminal", found.symbol, ctx);
    }
    /* The windows run back from now, not from the last bar: a chart whose newest bar is old is said as old, never as today's. */
    const now = Math.floor(ctx.nowMs / 1000);
    const bar = BAR_SECONDS[input.timeframe];
    const bars = read.candles.filter((entry) => entry.time <= now);
    const last = bars.length > 0 ? bars[bars.length - 1] : null;
    if (last === null || now - last.time > 24 * 3600) return noCandles("the newest candle is too old", "найновіша свічка надто стара");
    const day = bars.filter((entry) => entry.time >= now - 24 * 3600);
    if (day.length < 2) return noCandles("too few candles in the last day", "замало свічок за останню добу");
    /* An interval with no trade has no bar: the span the bars truly cover is said, never called «24 h» when it is less. */
    const fullDay = day[0].time <= now - 24 * 3600 + bar;
    const hours = Math.max(1, Math.round((now - day[0].time) / 3600));
    const spanEn = fullDay ? "24 h" : `the last ${hours} h`;
    const spanUk = fullDay ? "24 год" : `останні ${hours} год`;
    const closedAt = Math.min(last.time * 1000 + bar * 1000, Number.isFinite(Date.parse(read.observedAt)) ? Date.parse(read.observedAt) : ctx.nowMs, ctx.nowMs);
    const lagging = now - last.time > 2 * bar;
    const state: AgentState = read.stale || lagging ? "stale" : stateOf(read.observedAt, 15 * 60_000, ctx.nowMs);
    const cite = ctx.citations.add({ tool: "candles_read", source: `GeckoTerminal · ${read.pool.name} · ${read.pool.dex}`, observedAt: new Date(closedAt).toISOString(), state, ref: found.mint, href: null });
    const close = last.close;
    const high = Math.max(...day.map((entry: CandleBar) => entry.high));
    const low = Math.min(...day.map((entry: CandleBar) => entry.low));
    const change = (from: number) => (from > 0 ? Math.round(((close - from) / from) * 10_000) / 100 : null);
    const change24h = change(day[0].open);
    /* A week's move only when the bars reach back a week. */
    const weekStart = bars.find((entry) => entry.time >= now - 7 * 24 * 3600) ?? null;
    const change7d = weekStart !== null && weekStart.time <= now - 7 * 24 * 3600 + bar ? change(weekStart.open) : null;
    const range = low > 0 ? Math.round(((high - low) / low) * 10_000) / 100 : null;
    const f = (label: [string, string], number: number | null, kind: "usd" | "pct") => figure({ label: w(locale, label[0], label[1]), number, kind, unit: kind === "pct" ? "%" : "USD", state, cite: cite.id }, locale);
    const figures = {
      close: f(["Last close", "Останнє закриття"], close, "usd"),
      high: f([`High over ${spanEn}`, `Максимум за ${spanUk}`], high, "usd"),
      low: f([`Low over ${spanEn}`, `Мінімум за ${spanUk}`], low, "usd"),
      range: figure({ label: w(locale, `Range over ${spanEn}`, `Діапазон за ${spanUk}`), number: null, kind: "text", text: range === null ? undefined : bare(range, locale), state, cite: cite.id }, locale),
      change: f([`Move over ${spanEn} by candles`, `Рух за ${spanUk} за свічками`], change24h, "pct"),
      change7d: f(["7-day move by candles", "Рух за 7 днів за свічками"], change7d, "pct"),
    };
    const facts = factsOf("candles", figures, range === null ? [] : ["range"]);
    const frame = input.timeframe === "1h" ? w(locale, "hourly", "годинних") : w(locale, "4-hour", "4-годинних");
    const moves = clauses([change24h === null ? null : w(locale, `moved ${pct(change24h, locale)}`, `рух ${pct(change24h, locale)}`), change7d === null ? null : w(locale, `over 7 days ${pct(change7d, locale)}`, `за 7 днів ${pct(change7d, locale)}`)], "; ");
    const said = (moved: string) => w(locale, `On GeckoTerminal's ${frame} candles (${read.pool.name}, ${read.pool.dex}) ${found.symbol} last closed at ${figures.close.value}; over ${spanEn} it ranged ${figures.low.value}–${figures.high.value}${range === null ? "" : ` (${bare(range, locale)})`}${moved ? ` and ${moved}` : ""}.`, `На ${frame} свічках GeckoTerminal (${read.pool.name}, ${read.pool.dex}) ${found.symbol} востаннє закрився на ${figures.close.value}; за ${spanUk} діапазон ${figures.low.value}–${figures.high.value}${range === null ? "" : ` (${bare(range, locale)})`}${moved ? `, ${moved}` : ""}.`);
    /* Beside «what moved the price?» the day's move is the move's own line (AI-21): the candles keep the range and the week. */
    const week = change7d === null ? "" : w(locale, `over 7 days ${pct(change7d, locale)}`, `за 7 днів ${pct(change7d, locale)}`);
    const notes: ToolNote[] = [{ ...note("observation", said(moves), [cite.id]), withoutMove: said(week).slice(0, 400) }];
    if (high > low) {
      const position = (close - low) / (high - low);
      const where = position >= 0.8 ? w(locale, `near the top of the range over ${spanEn}`, `біля верху діапазону за ${spanUk}`) : position <= 0.2 ? w(locale, `near the bottom of the range over ${spanEn}`, `біля низу діапазону за ${spanUk}`) : w(locale, `inside the range over ${spanEn}`, `всередині діапазону за ${spanUk}`);
      notes.push(note("meaning", w(locale, `The last close sits ${where}.`, `Останнє закриття — ${where}.`), [cite.id]));
    }
    if (lagging) notes.push(note("risks", w(locale, `The newest candle closed ${whenText(new Date(closedAt).toISOString(), locale)}; the move since then is missing.`, `Найновіша свічка закрилась ${whenText(new Date(closedAt).toISOString(), locale)}; рух відтоді відсутній.`), [cite.id]));
    else if (state !== "current") notes.push(note("risks", w(locale, `The candles are ${statePlural(state, locale)}; the newest move may be missing.`, `Свічки ${statePlural(state, locale)}; найновіший рух може бути відсутній.`), [cite.id]));
    return { tool: "candles_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [], draft: null };
  },
};

/* ------------------------------------------------------------ Pulse: movers */

const MoversInput = z.object({ window: z.enum(["h1", "h24"]).default("h24") }).strict();

export const moversRead: AgentTool<typeof MoversInput> = {
  name: "movers_read",
  kind: "research",
  description: "Pulse's movers: the tokens on Jupiter's lists that rose and fell most over an hour or a day, with each one's move, volume and liquidity.",
  input: MoversInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const read = await ctx.readers.movers(input.window);
    if (!read.ok) return missing("movers_read", "Pulse", w(locale, "the market", "ринку"), ctx);
    const state: AgentState = read.stale ? "stale" : stateOf(read.observedAt, FRESHNESS_MS.market, ctx.nowMs);
    const cite = ctx.citations.add({ tool: "movers_read", source: w(locale, "Pulse (Jupiter's lists)", "Pulse (списки Jupiter)"), observedAt: read.observedAt, state, ref: null, href: "/app/home" });
    const span = input.window === "h1" ? w(locale, "the hour", "годину") : w(locale, "24 h", "24 год");
    const up = read.up.filter((row) => row.changePct !== null).slice(0, 5);
    const down = read.down.filter((row) => row.changePct !== null).slice(0, 5);
    if (up.length === 0 && down.length === 0) return { ...emptyRun("movers_read", "research", "empty", state), notes: [note("observation", w(locale, `Pulse lists no movers over ${span} right now.`, `Pulse зараз не має рухів за ${span}.`), [cite.id])] };
    const line = (row: MoverRow) => `${row.symbol} ${pct(row.changePct, locale)}${row.volumeUsd === null ? "" : ` (${w(locale, "vol.", "обсяг")} ${usdCompactText(row.volumeUsd, locale)})`}`;
    const facts: ToolFact[] = [...up.map((row, i) => ({ row, key: `movers.up.${i}` })), ...down.map((row, i) => ({ row, key: `movers.down.${i}` }))].map(({ row, key }) => fact(figure({ label: `${row.symbol} · ${w(locale, "move", "рух")}`, number: row.changePct, kind: "pct", unit: "%", state, cite: cite.id }, locale), key));
    const notes: ToolNote[] = [];
    if (up.length > 0) notes.push(note("observation", w(locale, `Rose most over ${span}: ${up.map(line).join("; ")}.`, `Найбільше зросли за ${span}: ${up.map(line).join("; ")}.`), [cite.id]));
    if (down.length > 0) notes.push(note("observation", w(locale, `Fell most over ${span}: ${down.map(line).join("; ")}.`, `Найбільше впали за ${span}: ${down.map(line).join("; ")}.`), [cite.id]));
    const unverified = [...up, ...down].filter((row) => !row.verified).map((row) => row.symbol);
    if (unverified.length > 0) notes.push(note("risks", w(locale, `Not on Jupiter's verified list: ${unverified.join(", ")} — a copy can borrow a name.`, `Не у верифікованому списку Jupiter: ${unverified.join(", ")} — копія може позичити назву.`), [cite.id]));
    const thin = [...up, ...down].filter((row) => row.liquidityUsd !== null && row.liquidityUsd < 100_000).map((row) => row.symbol);
    if (thin.length > 0) notes.push(note("risks", w(locale, `Thin liquidity under $100K: ${thin.join(", ")} — big moves come easily there.`, `Тонка ліквідність до $100K: ${thin.join(", ")} — великі рухи там даються легко.`), [cite.id]));
    notes.push(note("counter", w(locale, `A list of movers is what moved most, often in thin markets; it is not a list of what to buy.`, `Список рухів — це те, що рухалось найбільше, часто на тонких ринках; це не список того, що купувати.`), [cite.id]));
    return { tool: "movers_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [{ kind: "market", href: "/app/home", label: w(locale, "Open Pulse", "Відкрити Pulse"), primary: false }], draft: null };
  },
};

/* ------------------------------------------------------------ Meteora: pools */

export const meteoraPoolsRead: AgentTool<typeof QueryInput> = {
  name: "meteora_pools_read",
  kind: "research",
  description: "Meteora's pools for one token (DLMM and DAMM v2): how many hold meaningful liquidity, the value locked, 24h volume and fees, the deepest pool.",
  input: QueryInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const found = await subject("meteora_pools_read", input.query, ctx);
    if ("tool" in found) return found;
    const read = await ctx.readers.pools(found.mint);
    if (!read.ok) return missing("meteora_pools_read", "Meteora", found.symbol, ctx);
    /* A partial read is current in what it holds; the missing list is said apart. */
    const state: AgentState = read.state === "stale" ? "stale" : read.state === "unavailable" ? "unavailable" : "current";
    const cite = ctx.citations.add({ tool: "meteora_pools_read", source: "Meteora (DLMM · DAMM v2)", observedAt: read.observedAt, state, ref: found.mint, href: null });
    const top = read.pools[0] ?? null;
    if (top === null) return { ...emptyRun("meteora_pools_read", "research", "empty", state), notes: [note("observation", w(locale, `Meteora lists no pool of ${found.symbol}.`, `Meteora не має пулу з ${found.symbol}.`), [cite.id])] };
    const f = (label: [string, string], number: number | null, kind: "usdCompact" | "count") => figure({ label: w(locale, label[0], label[1]), number, kind, unit: kind === "count" ? null : "USD", state, cite: cite.id }, locale);
    const figures = {
      meaningful: f(["Pools over $1K", "Пули понад $1K"], read.meaningful, "count"),
      tvl: f(["Value locked", "Заблоковано в пулах"], read.totals.tvlUsd, "usdCompact"),
      volume24h: f(["24h volume in pools", "Обсяг у пулах за 24 год"], read.totals.volume24hUsd, "usdCompact"),
      fees24h: f(["24h fees in pools", "Комісії пулів за 24 год"], read.totals.fees24hUsd, "usdCompact"),
      topTvl: f(["Deepest pool", "Найглибший пул"], top.tvlUsd, "usdCompact"),
    };
    const facts = factsOf("meteora", figures);
    const kind = top.kind === "dlmm" ? "DLMM" : "DAMM v2";
    const n = read.meaningful;
    const enParts = clauses([read.totals.tvlUsd === null ? null : `${figures.tvl.value} locked`, read.totals.volume24hUsd === null ? null : `${figures.volume24h.value} traded`, read.totals.fees24hUsd === null ? null : `${figures.fees24h.value} in fees`]);
    const ukParts = clauses([read.totals.tvlUsd === null ? null : `заблоковано ${figures.tvl.value}`, read.totals.volume24hUsd === null ? null : `проторговано ${figures.volume24h.value}`, read.totals.fees24hUsd === null ? null : `комісій ${figures.fees24h.value}`]);
    const deepest = top.tvlUsd === null ? `${top.name} (${kind})` : `${top.name} (${kind}, ${figures.topTvl.value})`;
    const notes: ToolNote[] = [
      note("observation", w(locale, `Meteora holds ${n} pool${n === 1 ? "" : "s"} of ${found.symbol} over $1K${enParts ? `: ${enParts} over 24 h` : ""}; the deepest is ${deepest} — read ${whenText(read.observedAt, locale)}.`, `Meteora має ${n} ${ukPlural(n, "пул", "пули", "пулів")} з ${found.symbol} понад $1K${ukParts ? `: ${ukParts} за 24 год` : ""}; найглибший — ${deepest} — прочитано ${whenText(read.observedAt, locale)}.`), [cite.id]),
    ];
    if (read.state === "partial") notes.push(note("risks", w(locale, `One of Meteora's two pool lists did not answer: the totals may be short.`, `Один із двох списків пулів Meteora не відповів: суми можуть бути неповними.`), [cite.id]));
    if (state === "stale") notes.push(note("risks", w(locale, `Meteora's figures are stale; a decision needs a fresh read.`, `Цифри Meteora застарілі; рішенню потрібне свіже читання.`), [cite.id]));
    return { tool: "meteora_pools_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [], draft: null };
  },
};

/* ------------------------------------------------------------ Market Health: a Ryntra launch */

const CYCLE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  CREATED: ["just created", "щойно створено"],
  PRICE_DISCOVERY: ["finding its price on the curve", "шукає ціну на кривій"],
  GRADUATION_READY: ["ready to leave the curve", "готовий вийти з кривої"],
  MIGRATING: ["moving to a pool", "переходить у пул"],
  CORE_MARKET_LIVE: ["trading in its pool", "торгується в пулі"],
  ENDOWMENT_FUNDED: ["trading, its budget funded", "торгується, бюджет наповнено"],
  LADDER_ACTIVE: ["trading, Ryntra's steps placed", "торгується, кроки Ryntra виставлено"],
  MAINTAINING: ["trading, maintained", "торгується, підтримується"],
  PAUSED_RISK: ["paused by a risk limit", "призупинено лімітом ризику"],
  MATURE: ["mature", "зрілий"],
  MIGRATION_FAILED: ["its move to a pool failed", "перехід у пул не вдався"],
  ENDOWMENT_EXHAUSTED: ["its budget is spent", "бюджет вичерпано"],
};

export const launchHealthRead: AgentTool<typeof QueryInput> = {
  name: "launch_health_read",
  kind: "research",
  description: "Market Health of a token launched on Ryntra: its stage, holders, the top ten's share, whether it traded in the last day, its price against the pool's opening, whether the creator sold. Silent for any other token.",
  input: QueryInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const found = await subject("launch_health_read", input.query, ctx);
    if ("tool" in found) return found;
    const read = await ctx.readers.launchHealth(found.mint);
    /* Not a Ryntra launch, or not readable now: the market's other reads speak; this one says nothing. */
    if (!read.ok || read.health === null) return emptyRun("launch_health_read", "research", read.ok ? "empty" : "unavailable", null);
    const health = read.health;
    const state: AgentState = stateOf(health.observedAt, 10 * 60_000, ctx.nowMs);
    const cite = ctx.citations.add({ tool: "launch_health_read", source: w(locale, "Market Health (Ryntra launch)", "Здоров'я ринку (запуск Ryntra)"), observedAt: health.observedAt, state, ref: found.mint, href: `/app/launch/${found.mint}` });
    const stage = CYCLE_WORDS[health.state] ?? ["at a stage not named", "на неназваному етапі"];
    const traded = health.traded24h === null ? null : health.traded24h ? w(locale, "yes", "так") : w(locale, "no", "ні");
    const figures = {
      holders: figure({ label: w(locale, health.holdersAtLeast ? "Holders, at least" : "Holders", health.holdersAtLeast ? "Тримачі, щонайменше" : "Тримачі"), number: health.holders, kind: "count", state, cite: cite.id }, locale),
      top10: figure({ label: w(locale, "Top ten's share", "Частка десяти найбільших"), number: health.top10Pct, kind: "pct", unit: "%", state, cite: cite.id }, locale),
      priceVsDex: figure({ label: w(locale, "Price vs the pool's opening", "Ціна проти відкриття пулу"), number: health.priceVsDexPct, kind: "pct", unit: "%", state, cite: cite.id }, locale),
      traded24h: figure({ label: w(locale, "Traded in the last 24 h", "Торгувався за 24 год"), number: null, kind: "text", text: traded ?? undefined, state, cite: cite.id }, locale),
    };
    const facts = factsOf("launch", figures, traded === null ? [] : ["traded24h"]);
    const said = clauses([
      health.holders === null ? null : w(locale, `holders ${health.holdersAtLeast ? "at least " : ""}${figures.holders.value}`, `тримачів ${health.holdersAtLeast ? "щонайменше " : ""}${figures.holders.value}`),
      health.top10Pct === null ? null : w(locale, `the top ten hold ${bare(health.top10Pct, locale)}${health.top10AtLeast ? " or more" : ""}`, `десять найбільших тримають ${bare(health.top10Pct, locale)}${health.top10AtLeast ? " або більше" : ""}`),
      traded === null ? null : w(locale, `traded in the last 24 h — ${traded}`, `торгувався за 24 год — ${traded}`),
      health.priceVsDexPct === null ? null : w(locale, `price against the pool's opening ${figures.priceVsDex.value}`, `ціна проти відкриття пулу ${figures.priceVsDex.value}`),
    ], "; ");
    const notes: ToolNote[] = [note("observation", w(locale, `${found.symbol} is a market launched on Ryntra, ${stage[0]}${said ? `: ${said}` : ""}.`, `${found.symbol} — ринок, запущений на Ryntra, ${stage[1]}${said ? `: ${said}` : ""}.`), [cite.id])];
    if (health.top10Pct !== null && health.top10Pct >= 50) notes.push(note("risks", w(locale, `The top ten hold ${bare(health.top10Pct, locale)}: a few wallets can move this price.`, `Десять найбільших тримають ${bare(health.top10Pct, locale)}: кілька гаманців можуть зрушити цю ціну.`), [cite.id]));
    if (health.creatorSold === true) notes.push(note("risks", w(locale, `The creator has sold some of the token.`, `Творець продав частину токена.`), [cite.id]));
    if (health.traded24h === false) notes.push(note("risks", w(locale, `No trade in the last 24 h: the last price may not be one anyone would pay now.`, `За 24 год жодної угоди: остання ціна може бути не тією, яку хтось заплатив би зараз.`), [cite.id]));
    return { tool: "launch_health_read", kind: "research", outcome: "ok", state, facts, notes, cards: [], handoffs: [{ kind: "market", href: `/app/launch/${found.mint}`, label: w(locale, "Open the market's health", "Відкрити здоров'я ринку"), primary: false }], draft: null };
  },
};

export const MARKET_DATA_TOOLS = [dexPairsRead, tokenReportRead, candlesRead, moversRead, meteoraPoolsRead, launchHealthRead] as const;

/** The sources the tools read, as a person names them — for a sentence about a read that did not answer. */
export const TOOL_SOURCE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  market_read: ["the Spot catalogue", "каталог Spot"],
  stock_read: ["the stocks desk", "стіл акцій"],
  evidence_read: ["the evidence layer", "шар доказів"],
  holdings_read: ["your wallet's holdings", "активи гаманця"],
  plans_read: ["your plans", "твої плани"],
  plan_read: ["the plan", "план"],
  results_read: ["the results", "результати"],
  memory_read: ["strategy memory", "пам'ять стратегій"],
  activity_read: ["History", "Історія"],
  watchlist_read: ["the watchlist", "список спостереження"],
  monitoring_read: ["Monitoring", "Нагляд"],
  dex_pairs_read: ["DexScreener", "DexScreener"],
  token_report_read: ["RugCheck", "RugCheck"],
  candles_read: ["GeckoTerminal's candles", "свічки GeckoTerminal"],
  movers_read: ["Pulse", "Pulse"],
  meteora_pools_read: ["Meteora's pools", "пули Meteora"],
  launch_health_read: ["Market Health", "здоров'я ринку"],
  news_read: ["Ryntra's news feeds", "стрічки новин Ryntra"],
  price_move_read: ["the move's sources", "джерела руху"],
};
