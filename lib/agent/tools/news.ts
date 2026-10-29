/**
 * The news tools (AI-09) — read-only, from the digest the collector built.
 *
 * `news_read` says what Ryntra's allow-listed feeds published about a token,
 * or about the market as a whole, in the last two days: each story with its
 * publisher and its time, the publisher's own link on the card. A question
 * reads the digest and nothing else — it never starts a collection (PLAN §5).
 *
 * `price_move_read` answers «What moved the price?» line by line, and marks
 * every line: a **fact** is a figure a source stated (the move on
 * DexScreener, the market's own move beside it); **unverified** is what a
 * publication reports; an **inference** is Ryntra's reading of the two — a
 * coincidence in time, a move with the market or against it — said as a
 * reading, never as a cause; **unknown** is what no source says, and the cause
 * of a move is always among it. The server writes and marks the lines; a
 * model may only reword the answer around them, held to the reads.
 *
 * A headline is someone else's words: every sentence that carries one is a
 * `quote` note (`types.ts`), passed to a model as untrusted text, and never
 * a fact.
 */

import { z } from "zod";

import type { AgentCard, AgentFigure, AgentMoveMark, AgentState } from "../../api/v1/contract.ts";
import { label, summariseDexPairs } from "../../assistant/data/dexscreener.ts";
import { DIGEST_DAY_MS, DIGEST_STORIES_MAX, type DigestStory } from "../../assistant/news/store.ts";
import { BLOCK_MAX_CHARS } from "../answer.ts";
import { screenText } from "../../assistant/news/text.ts";
import { CBBTC_MINT, SOL_MINT } from "../../assistant/news/tagging.ts";
import { FRESHNESS_MS, figure, pctText, stateOf, usdCompactText, whenText, type Locale } from "../provenance.ts";
import { ukPlural } from "./market-data.ts";
import { resolveAsset } from "./readers.ts";
import { w } from "./research.ts";
import { emptyRun, type AgentTool, type ToolContext, type ToolFact, type ToolNote, type ToolRun } from "./types.ts";

const NewsInput = z.object({ query: z.string().min(1).max(44).optional() }).strict();
const MoveInput = z.object({ query: z.string().min(1).max(44), window: z.enum(["1h", "24h"]).default("24h") }).strict();

const note = (section: ToolNote["section"], text: string, cites: readonly string[], quote = false): ToolNote => (quote ? { section, text: text.slice(0, 400), cites, quote: true } : { section, text: text.slice(0, 400), cites });

/** The topic as a person reads it. */
const TOPIC_WORDS: Readonly<Record<DigestStory["topic"], readonly [string, string]>> = {
  security: ["security", "безпека"],
  etf: ["ETF", "ETF"],
  regulation: ["regulation", "регулювання"],
  listing: ["listings", "лістинги"],
  funding: ["funding", "фінансування"],
  partnership: ["partnerships", "партнерства"],
  upgrade: ["upgrades", "оновлення"],
  launch: ["launches", "запуски"],
  macro: ["the economy", "економіка"],
  market: ["the market", "ринок"],
  other: ["other", "інше"],
};

/** A story whose headline passes the feeds' screen today, on a publisher's https link. */
function fitStory(story: DigestStory): boolean {
  return screenText(story.title).ok && story.url.startsWith("https://");
}

/** «CoinDesk, 17 Oct, 14:05 UTC: «…»», with the others who told it. */
function storyLine(story: DigestStory, locale: Locale, lead = ""): string {
  const also = story.also > 0 ? w(locale, ` (also ${story.also} more source${story.also === 1 ? "" : "s"})`, ` (ще ${story.also} ${ukPlural(story.also, "джерело", "джерела", "джерел")})`) : "";
  const head = `${lead}${story.source}, ${whenText(story.publishedAt, locale)}: «`;
  /* One block, never cut: a headline split at its own full stop would leave a fragment with no source or time. */
  const room = Math.max(24, BLOCK_MAX_CHARS - head.length - also.length - 1);
  const title = story.title.length <= room ? story.title : `${story.title.slice(0, room - 1).replace(/\s+\S*$/, "")}…`;
  return `${head}${title.replace(/([.!?])(\s)/g, "$1\u00a0")}»${also}`;
}

function storyCite(story: DigestStory, state: AgentState, tool: string, ctx: ToolContext): string {
  return ctx.citations.add({ tool, source: story.source, observedAt: story.publishedAt, state, ref: story.id, href: null }).id;
}

/** The feeds as one citation: the collector's last read, for counts and for «nothing was published». */
function feedsCite(collectedAt: string, state: AgentState, tool: string, ctx: ToolContext): string {
  return ctx.citations.add({ tool, source: w(ctx.locale, "Ryntra's news feeds", "Стрічки новин Ryntra"), observedAt: collectedAt, state, ref: null, href: null }).id;
}

function unreadable(tool: string, ctx: ToolContext): ToolRun {
  const cite = ctx.citations.add({ tool, source: w(ctx.locale, "Ryntra's news feeds", "Стрічки новин Ryntra"), observedAt: null, state: "unavailable", ref: null, href: null });
  return { ...emptyRun(tool, "research", "unavailable", "unavailable"), notes: [note("risks", w(ctx.locale, `The news could not be read right now; what it would show is missing here, not «no news».`, `Новини зараз не прочитати; те, що вони показали б, тут відсутнє, а не «новин немає».`), [cite.id])] };
}

/* ------------------------------------------------------------ news_read */

export const newsRead: AgentTool<typeof NewsInput> = {
  name: "news_read",
  kind: "research",
  description: "The news Ryntra's allow-listed feeds published about one token, or about the market as a whole, in the last 48 hours — each story with its publisher and time; a headline is a report, never a verified fact.",
  input: NewsInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    let subject: Readonly<{ mint: string; symbol: string }> | null = null;
    if (input.query) {
      const resolved = await resolveAsset(ctx.readers, input.query);
      if (resolved.kind === "none") return emptyRun("news_read", "research", resolved.reason === "not-listed" || resolved.reason === "retired" ? "empty" : "unavailable");
      subject = { mint: resolved.mint, symbol: label(resolved.symbol, "token", 32) };
    }
    const read = await ctx.readers.news(subject?.mint ?? null);
    if (!read.ok) return unreadable("news_read", ctx);
    const state: AgentState = read.stale ? "stale" : "current";
    const about = subject?.symbol ?? w(locale, "the market", "ринок");
    const feeds = feedsCite(read.collectedAt, state, "news_read", ctx);
    /* A token the collector does not look for: no news is no finding — said as unknown, never as «nothing was published». */
    if (!read.tracked && subject) {
      return { ...emptyRun("news_read", "research", "empty", "unknown"), notes: [note("observation", w(locale, `Ryntra does not follow news about ${about}: it is not among the tokens its news feeds are read for, so whether anything was published is unknown here.`, `Ryntra не стежить за новинами про ${about}: його немає серед токенів, для яких читаються стрічки, тож чи щось виходило — тут невідомо.`), [feeds])] };
    }
    /* The screen again at the read: a story kept before a rule existed is not said if it fails one now. */
    const stories = (read.digest?.stories ?? []).filter(fitStory);
    /* The day counted from the stories said, so the counts and the list never disagree. */
    /* The day as the collector counted it over every story — the digest keeps only the newest — less the kept ones the screen now hides. */
    const hidden = (read.digest?.stories ?? []).filter((story) => !fitStory(story) && Date.parse(story.publishedAt) >= ctx.nowMs - DIGEST_DAY_MS).length;
    const counted = read.digest?.day ?? { stories: 0, sources: 0, topics: [] };
    const day = { stories: Math.max(stories.filter((story) => Date.parse(story.publishedAt) >= ctx.nowMs - DIGEST_DAY_MS).length, counted.stories - hidden), sources: counted.sources, topics: counted.topics };
    const facts: ToolFact[] = [
      { key: "news.stories24h", label: w(locale, "Stories in 24 h", "Історій за 24 год"), value: String(day.stories), number: day.stories, unit: null, state, cite: feeds },
      { key: "news.sources24h", label: w(locale, "Sources in 24 h", "Джерел за 24 год"), value: String(day.sources), number: day.sources, unit: null, state, cite: feeds },
    ];
    const notes: ToolNote[] = [];
    if (stories.length === 0) {
      notes.push(note("observation", subject ? w(locale, `In the last 48 h Ryntra's news feeds published nothing about ${about} — read ${whenText(read.collectedAt, locale)}.`, `За 48 год стрічки новин Ryntra нічого не писали про ${about} — прочитано ${whenText(read.collectedAt, locale)}.`) : w(locale, `In the last 48 h Ryntra's news feeds carried no market-wide story — read ${whenText(read.collectedAt, locale)}.`, `За 48 год у стрічках новин Ryntra не було історії про ринок загалом — прочитано ${whenText(read.collectedAt, locale)}.`), [feeds]));
      notes.push(note("counter", w(locale, "These are the feeds Ryntra reads — eight publishers and project blogs; news elsewhere, on X or in chats, is not among them.", "Це стрічки, які читає Ryntra — вісім видань і блогів проєктів; новини деінде, в X чи чатах, сюди не входять."), [feeds]));
    } else {
      const latest = stories[0];
      notes.push(note("observation", w(locale, `In the last 24 h the feeds carried ${day.stories} stor${day.stories === 1 ? "y" : "ies"} about ${about} from ${day.sources} source${day.sources === 1 ? "" : "s"}; the latest came ${whenText(latest.publishedAt, locale)}.`, `За 24 год у стрічках ${day.stories} ${ukPlural(day.stories, "історія", "історії", "історій")} про ${about} з ${day.sources} ${ukPlural(day.sources, "джерела", "джерел", "джерел")}; найсвіжіша — ${whenText(latest.publishedAt, locale)}.`), [feeds]));
      for (const story of stories.slice(0, 3)) notes.push(note("observation", storyLine(story, locale), [storyCite(story, state, "news_read", ctx)], true));
      if (day.topics.length > 0) notes.push(note("meaning", w(locale, `By topic over the day: ${day.topics.slice(0, 3).map((entry) => `${TOPIC_WORDS[entry.topic][0]} — ${entry.stories}`).join(", ")}.`, `За темами за добу: ${day.topics.slice(0, 3).map((entry) => `${TOPIC_WORDS[entry.topic][1]} — ${entry.stories}`).join(", ")}.`), [feeds]));
      notes.push(note("counter", w(locale, "A headline is what a publication reports, not a verified fact; the details are behind the source's own link.", "Заголовок — це те, що пише видання, а не перевірений факт; подробиці — за посиланням на джерело."), [feeds]));
    }
    if (state === "stale") notes.push(note("risks", w(locale, `The feeds were last read ${whenText(read.collectedAt, locale)}: newer stories may be missing here.`, `Стрічки востаннє прочитано ${whenText(read.collectedAt, locale)}: новіших історій тут може не бути.`), [feeds]));
    if (read.feeds.ok < read.feeds.total) notes.push(note("risks", w(locale, `On the last read ${read.feeds.ok} of ${read.feeds.total} feeds answered; stories from the others may be missing here.`, `Під час останнього читання відповіли ${read.feeds.ok} з ${read.feeds.total} стрічок; історій з інших тут може не бути.`), [feeds]));
    const card: AgentCard = {
      kind: "news",
      mint: subject?.mint ?? null,
      symbol: subject?.symbol ?? null,
      items: stories.slice(0, 5).map((story) => ({ id: story.id, title: story.title, source: story.source, publishedAt: story.publishedAt, url: story.url, topic: story.topic, also: story.also, cite: findCite(ctx, story.id) ?? storyCite(story, state, "news_read", ctx) })),
      day: { stories: day.stories, sources: day.sources },
      collectedAt: read.collectedAt,
      state,
    };
    return { tool: "news_read", kind: "research", outcome: "ok", state, facts, notes, cards: [card], handoffs: [], draft: null };
  },
};

/** The citation a story already has in this exchange, so a card and a sentence point at the same one. */
function findCite(ctx: ToolContext, ref: string): string | null {
  return ctx.citations.list().find((cite) => cite.ref === ref)?.id ?? null;
}

/* ------------------------------------------------------------ price_move_read */

/** `card` — a line the card shows but the answer already says through DexScreener's own sentences: no note of it. */
type Row = Readonly<{ mark: AgentMoveMark; text: string; cites: readonly string[]; quote?: boolean; card?: boolean }>;

/** The move card's rows at most (contract 1.44.0). */
const MOVE_ROWS_MAX = 10;

const SECTION: Readonly<Record<AgentMoveMark, ToolNote["section"]>> = { fact: "observation", unverified: "observation", inference: "meaning", unknown: "risks" };

/** The windows' words. */
const SPAN: Readonly<Record<"1h" | "24h", readonly [string, string]>> = { "1h": ["over the last hour", "за останню годину"], "24h": ["over 24 h", "за 24 год"] };

export const priceMoveRead: AgentTool<typeof MoveInput> = {
  name: "price_move_read",
  kind: "research",
  description: "What moved a token's price: the move as DexScreener states it, the market's own move beside it, the news published in that window and the hour the price moved most — each line marked fact, unverified, inference or unknown; the cause itself is never stated as known.",
  input: MoveInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const resolved = await resolveAsset(ctx.readers, input.query);
    if (resolved.kind === "none") return emptyRun("price_move_read", "research", resolved.reason === "not-listed" || resolved.reason === "retired" ? "empty" : "unavailable");
    const mint = resolved.mint;
    const symbol = label(resolved.symbol, "token", 32);
    const span = SPAN[input.window];
    const key = input.window === "1h" ? "h1" : "h24";
    const refMint = mint === SOL_MINT ? CBBTC_MINT : SOL_MINT;
    const refSymbol = mint === SOL_MINT ? "cbBTC" : "SOL";
    const [dex, ref, news, market, candles] = await Promise.all([
      ctx.readers.dexPairs(mint),
      ctx.readers.dexPairs(refMint),
      ctx.readers.news(mint),
      ctx.readers.news(null),
      input.window === "24h" ? ctx.readers.candles(mint, "1h") : Promise.resolve(null),
    ]);
    const rows: Row[] = [];
    const facts: ToolFact[] = [];

    /* The move: a fact, from the deepest pair against USDC, USDT or SOL. */
    let change: AgentFigure | null = null;
    let moved: number | null = null;
    if (dex.ok) {
      const top = summariseDexPairs(dex.pairs).top;
      const state: AgentState = dex.stale ? "stale" : stateOf(dex.observedAt, FRESHNESS_MS.market, ctx.nowMs);
      if (top !== null && top.changePct[key] !== null) {
        moved = top.changePct[key];
        const cite = ctx.citations.add({ tool: "price_move_read", source: `DexScreener · ${top.baseSymbol}/${top.quoteSymbol} · ${top.dex}`, observedAt: dex.observedAt, state, ref: top.pairAddress, href: null }).id;
        change = figure({ label: w(locale, `Price change ${span[0]}`, `Зміна ціни ${span[1]}`), number: moved, kind: "pct", unit: "%", state, cite }, locale);
        facts.push({ key: "move.change", label: change.label, value: change.value, number: change.number, unit: change.unit, state, cite });
        rows.push({ mark: "fact", text: w(locale, `${symbol} moved ${pctText(moved, locale)} ${span[0]} on ${top.baseSymbol}/${top.quoteSymbol} · ${top.dex} — DexScreener, ${whenText(dex.observedAt, locale)}.`, `${symbol} змінився на ${pctText(moved, locale)} ${span[1]} на ${top.baseSymbol}/${top.quoteSymbol} · ${top.dex} — DexScreener, ${whenText(dex.observedAt, locale)}.`), cites: [cite], card: true });
        /* The hour against the day's pace: a fact of the same source — never «$0, 0×» for an hour the source counted nothing in. */
        const h1 = top.volumeUsd.h1;
        const h24 = top.volumeUsd.h24;
        if (h1 !== null && h1 > 0 && h24 !== null && h24 > 0) {
          const ratio = Math.round((h1 / (h24 / 24)) * 10) / 10;
          if (ratio >= 1.5 || ratio <= 0.5) rows.push({ mark: "fact", text: w(locale, `The last hour traded ${usdCompactText(h1, locale)} on that pair, ${ratio.toLocaleString("en-US")}× the day's hourly average.`, `За останню годину на цій парі проторгували ${usdCompactText(h1, locale)} — ${ratio.toLocaleString("uk-UA")}× від середнього за годину за добу.`), cites: [cite], card: true });
        }
      }
    }
    if (moved === null) rows.push({ mark: "unknown", text: w(locale, `No source Ryntra reads states ${symbol}'s move ${span[0]} right now.`, `Жодне джерело, яке читає Ryntra, зараз не показує рух ${symbol} ${span[1]}.`), cites: [] });

    /* The market beside it: a fact, and Ryntra's reading of the two — an inference. */
    if (ref.ok && moved !== null) {
      const top = summariseDexPairs(ref.pairs).top;
      const refMove = top?.changePct[key] ?? null;
      if (top !== null && refMove !== null) {
        const state: AgentState = ref.stale ? "stale" : stateOf(ref.observedAt, FRESHNESS_MS.market, ctx.nowMs);
        const cite = ctx.citations.add({ tool: "price_move_read", source: `DexScreener · ${top.baseSymbol}/${top.quoteSymbol} · ${top.dex}`, observedAt: ref.observedAt, state, ref: top.pairAddress, href: null }).id;
        facts.push({ key: "move.market", label: w(locale, `${refSymbol} change ${span[0]}`, `Зміна ${refSymbol} ${span[1]}`), value: pctText(refMove, locale), number: refMove, unit: "%", state, cite });
        rows.push({ mark: "fact", text: w(locale, `${refSymbol} over the same time: ${pctText(refMove, locale)} — DexScreener.`, `${refSymbol} за той самий час: ${pctText(refMove, locale)} — DexScreener.`), cites: [cite] });
        const cites = [change!.cite, cite];
        if (Math.abs(moved) < 1) rows.push({ mark: "inference", text: w(locale, `A move under 1 % is small; there is little here to explain.`, `Рух менший за 1 % — малий; пояснювати тут майже нічого.`), cites });
        else if (Math.abs(refMove) < 0.5) rows.push({ mark: "inference", text: w(locale, `${refSymbol} barely moved over the same time: the move is likely ${symbol}'s own, not the market's.`, `${refSymbol} за той самий час майже не рухався: рух, імовірно, власний у ${symbol}, а не ринковий.`), cites });
        else if (Math.sign(moved) !== Math.sign(refMove)) rows.push({ mark: "inference", text: w(locale, `${symbol} moved against ${refSymbol}: the reason is likely its own, not the market's.`, `${symbol} рухався проти ${refSymbol}: причина, імовірно, своя, а не ринкова.`), cites });
        else if (Math.abs(moved) <= Math.abs(refMove) * 1.5 + 1) rows.push({ mark: "inference", text: w(locale, `The move looks like ${refSymbol}'s own over the same time: ${symbol} likely went with the market rather than on news of its own.`, `Рух схожий на рух ${refSymbol} за той самий час: імовірно, ${symbol} ішов разом із ринком, а не через власну подію.`), cites });
        else rows.push({ mark: "inference", text: w(locale, `${symbol} moved well beyond ${refSymbol}: something of the token's own, or a large trader, is more likely than the market as a whole.`, `${symbol} рухався значно сильніше за ${refSymbol}: імовірніше щось своє в токена чи великий гравець, ніж ринок загалом.`), cites });
      }
    }

    /* The news of that window: what publications report — unverified. */
    const since = ctx.nowMs - (input.window === "1h" ? 3 * 3_600_000 : DIGEST_DAY_MS);
    const newsSpanWords = input.window === "1h" ? w(locale, "over the last 3 hours", "за останні 3 год") : span[locale === "uk" ? 1 : 0];
    const ownStories = news.ok ? (news.digest?.stories ?? []).filter((story) => Date.parse(story.publishedAt) >= since && fitStory(story)) : [];
    const newsState: AgentState = news.ok && news.stale ? "stale" : "current";
    /* A full digest may not reach back over the whole window: then every count of it is a floor, said as one. */
    const keptStories = news.ok ? (news.digest?.stories ?? []) : [];
    const floor = keptStories.length >= DIGEST_STORIES_MAX && Date.parse(keptStories[keptStories.length - 1].publishedAt) >= since;
    /* How many stories the window carried — a count from the feeds, so an answer of news stands on a figure even when the move itself was not read. */
    if (news.ok && news.tracked) {
      const cite = feedsCite(news.collectedAt, newsState, "price_move_read", ctx);
      facts.push({ key: "move.stories", label: w(locale, `Stories about it ${newsSpanWords}`, `Історій про нього ${newsSpanWords}`), value: floor ? w(locale, `at least ${ownStories.length}`, `щонайменше ${ownStories.length}`) : String(ownStories.length), number: ownStories.length, unit: null, state: floor ? "unknown" : newsState, cite });
    }
    const storyCites = new Map<string, string>();
    for (const story of ownStories.slice(0, 3)) {
      const cite = storyCite(story, newsState, "price_move_read", ctx);
      storyCites.set(story.id, cite);
      rows.push({ mark: "unverified", text: storyLine(story, locale), cites: [cite], quote: true });
    }
    if (ownStories.length > 3) rows.push({ mark: "unverified", text: w(locale, `${floor ? "At least " : ""}${ownStories.length - 3} more stor${ownStories.length - 3 === 1 ? "y" : "ies"} about ${symbol} in that window.`, `Ще ${floor ? "щонайменше " : ""}${ownStories.length - 3} ${ukPlural(ownStories.length - 3, "історія", "історії", "історій")} про ${symbol} за цей час.`), cites: [...storyCites.values()].slice(0, 1) });
    const marketStories = market.ok ? (market.digest?.stories ?? []).filter((story) => Date.parse(story.publishedAt) >= since && story.topic !== "other" && fitStory(story) && !ownStories.some((own) => own.story === story.story)) : [];
    for (const story of marketStories.slice(0, ownStories.length > 0 ? 1 : 2)) rows.push({ mark: "unverified", text: storyLine(story, locale, w(locale, "On the market as a whole — ", "На ринку загалом — ")), cites: [storyCite(story, newsState, "price_move_read", ctx)], quote: true });

    /* The hour the price moved most, and a story just before it: a coincidence in time — an inference, never a cause. */
    if (candles && candles.ok && ownStories.length > 0) {
      const now = Math.floor(ctx.nowMs / 1000);
      const bars = candles.candles.filter((bar) => bar.time >= now - 24 * 3600 && bar.time <= now && bar.open > 0);
      const biggest = bars.reduce<(typeof bars)[number] | null>((best, bar) => (best === null || Math.abs(bar.close - bar.open) / bar.open > Math.abs(best.close - best.open) / best.open ? bar : best), null);
      if (biggest !== null) {
        const startMs = biggest.time * 1000;
        const pct = ((biggest.close - biggest.open) / biggest.open) * 100;
        const before = ownStories.filter((story) => Date.parse(story.publishedAt) <= startMs + 3_600_000 && Date.parse(story.publishedAt) >= startMs - 3 * 3_600_000).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
        if (before && Math.abs(pct) >= 1) {
          const cite = ctx.citations.add({ tool: "price_move_read", source: `GeckoTerminal · ${candles.pool.name} · ${candles.pool.dex}`, observedAt: candles.observedAt, state: candles.stale ? "stale" : "current", ref: mint, href: null }).id;
          const minutes = Math.round((startMs - Date.parse(before.publishedAt)) / 60_000);
          const when = minutes > 0 ? w(locale, `${minutes} min before that hour began`, `за ${minutes} хв до початку тієї години`) : w(locale, "during that hour", "протягом тієї години");
          rows.push({ mark: "inference", text: w(locale, `The biggest hourly move was the hour from ${whenText(new Date(startMs).toISOString(), locale)} (${pctText(pct, locale)}); ${before.source}'s story came ${when}. A coincidence in time is no proof of cause.`, `Найбільший рух за годину — з ${whenText(new Date(startMs).toISOString(), locale)} (${pctText(pct, locale)}); історія ${before.source} вийшла ${when}. Збіг у часі — ще не доказ причини.`), cites: [cite, storyCites.get(before.id) ?? storyCite(before, newsState, "price_move_read", ctx)] });
        }
      }
    }

    /* What no source says: always the cause, and the news itself when nothing was published — or when nothing was looked for. */
    if (!news.ok) rows.push({ mark: "unknown", text: w(locale, `The news could not be read right now; whether something was published is unknown here.`, `Новини зараз не прочитати; чи щось виходило — тут невідомо.`), cites: [] });
    else if (!news.tracked) rows.push({ mark: "unknown", text: w(locale, `Ryntra does not follow news about ${symbol}, so whether something was published is unknown; the cause of the move is unknown.`, `Ryntra не стежить за новинами про ${symbol}, тож чи щось виходило — невідомо; причина руху невідома.`), cites: [] });
    else if (ownStories.length === 0) rows.push({ mark: "unknown", text: w(locale, `Ryntra's news feeds published nothing about ${symbol} ${newsSpanWords}; the cause of the move is unknown.`, `Стрічки новин Ryntra нічого не писали про ${symbol} ${newsSpanWords}; причина руху невідома.`), cites: [feedsCite(news.collectedAt, newsState, "price_move_read", ctx)] });
    else rows.push({ mark: "unknown", text: w(locale, `Whether that news moved the price is unknown: a publication reports an event, not its effect on the price.`, `Чи саме ця новина зрушила ціну, невідомо: видання повідомляє подію, а не її вплив на ціну.`), cites: [] });
    if (news.ok && news.stale) rows.push({ mark: "unknown", text: w(locale, `The feeds were last read ${whenText(news.collectedAt, locale)}; newer stories may be missing.`, `Стрічки востаннє прочитано ${whenText(news.collectedAt, locale)}; новіших історій тут може не бути.`), cites: [] });

    /* Read in the order of trust: what a source states, what is reported, Ryntra's reading, what nobody says. */
    const RANK: Readonly<Record<AgentMoveMark, number>> = { fact: 0, unverified: 1, inference: 2, unknown: 3 };
    /*
     * The cut never takes Ryntra's reading or what nobody knows: every fact
     * (three at most), two inferences, every unknown — and the reports fill
     * what is left, at least one.
     */
    const facts3 = rows.filter((row) => row.mark === "fact").slice(0, 3);
    const inferences = rows.filter((row) => row.mark === "inference").slice(0, 2);
    const unknowns = rows.filter((row) => row.mark === "unknown").slice(0, 2);
    const room = Math.max(1, MOVE_ROWS_MAX - facts3.length - inferences.length - unknowns.length);
    const reports = rows.filter((row) => row.mark === "unverified").slice(0, room);
    const chosen = new Set<Row>([...facts3, ...inferences, ...unknowns, ...reports]);
    const kept = rows.map((row, index) => ({ row, index })).filter((entry) => chosen.has(entry.row)).sort((a, b) => RANK[a.row.mark] - RANK[b.row.mark] || a.index - b.index).map((entry) => entry.row);
    const notes = kept.filter((row) => !row.card).map((row): ToolNote => ({ ...note(SECTION[row.mark], row.text, row.cites, row.quote === true), mark: row.mark }));
    const card: AgentCard = { kind: "move", mint, symbol, window: input.window, change, rows: kept.map((row) => ({ mark: row.mark, text: row.text.slice(0, 400), cites: [...row.cites].slice(0, 4) })) };
    const state: AgentState | null = change?.state ?? null;
    return { tool: "price_move_read", kind: "research", outcome: facts.length > 0 || ownStories.length > 0 ? "ok" : "empty", state, facts, notes, cards: [card], handoffs: [], draft: null };
  },
};

export const NEWS_TOOLS = [newsRead, priceMoveRead] as const;
