/**
 * The lines of «Ранковий огляд» (AI-10) — what the server read, written by
 * the server in both languages, each with its mark, its source, its time and
 * the figures it states. Pure: the reads come in, the lines go out.
 *
 * Two parts. «Сьогодні на ринку» is one for everyone: SOL and BTC (cbBTC)
 * over the day, the day's biggest verified movers and the market's top
 * stories. «Твоє» is the person's own: their tokens (the watchlist and what
 * the wallet holds) that moved by `MOVE_PCT` or more over the day, the
 * stories about them, and the notes their plans and positions received —
 * only what changed. A wallet's sums are never printed (PLAN §4): a token is
 * «у гаманці», never an amount.
 *
 * A line is a claim (`en`, `uk`) — what a person reads first, short enough
 * for two lines on a phone — and its source and time beside it; the
 * sentence that carries both (`lineSentence`) is what Telegram and the model
 * read. A figure is a fact with its source and time; a story is what a
 * publication reports (`unverified`), never the cause of a move.
 */

import type { DigestRead, DigestStory } from "../news/store.ts";
import { CBBTC_MINT, SOL_MINT } from "../news/tagging.ts";
import { pctText, usdText, whenText } from "../../agent/provenance.ts";
import type { MoversRead, SpotMarketRead } from "../../agent/tools/readers.ts";
import type { InboxRecord } from "../../monitoring/store.ts";

export type BriefLocale = "en" | "uk";
export type BriefMark = "fact" | "unverified";
export const BRIEF_LINE_KINDS = ["sol", "btc", "mover", "market-news", "token", "token-news", "plan"] as const;
export type BriefLineKind = (typeof BRIEF_LINE_KINDS)[number];

/** The figures a line states, by unit, and the moves it names — which way each asset went over the day. */
export type BriefFigures = { pct: number[]; usd: number[]; moves: { symbol: string; pct: number }[] };

export type BriefLine = Readonly<{
  id: string;
  kind: BriefLineKind;
  mark: BriefMark;
  /** The claim, without its source and time. */
  en: string;
  uk: string;
  source: string;
  observedAt: string | null;
  /** Where the line opens in Ryntra, when it opens anywhere. */
  href: string | null;
  figures: BriefFigures;
}>;

/** A token moved enough to be a change worth a person's morning. */
export const MOVE_PCT = 5;
/** A story is the day's when it was published in the last day. */
export const DAY_MS = 24 * 3_600_000;
/** The person's part reads at most this many tokens; the rest are said as not read. */
export const TOKENS_MAX = 12;
export const MARKET_STORIES = 3;
export const PERSONAL_LINES_MAX = 10;
/** A headline is cut here so its line stays two lines on a phone; the whole of it is on the publication's page. */
export const TITLE_MAX = 110;

/** The coins a person holds that do not move by design: never a change. */
export const STABLE_MINTS: ReadonlySet<string> = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
]);

const pct = (value: number, locale: BriefLocale) => pctText(value, locale, 1);

/**
 * A symbol as a brief may print it: the catalogue's symbol is anyone's own
 * metadata, so only letters, digits and `$._-`, at most twelve, and nothing
 * shaped like an address («claim-sol.xyz») — else the mint's short form.
 */
export function safeSymbol(symbol: string | null | undefined, mint: string): string {
  const text = (symbol ?? "").trim();
  if (/^[A-Za-z0-9$._-]{1,12}$/.test(text) && !/\.[A-Za-z]{2,}/.test(text) && !/^\.|\.$/.test(text)) return text;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
const round1 = (value: number) => Math.round(value * 10) / 10;
const none = (): BriefFigures => ({ pct: [], usd: [], moves: [] });

/** A line's time on the brief's own clock — «18 жовт., 13:24 за Києвом» — the same the page shows. */
export function zonedWhen(iso: string | null, locale: BriefLocale, zone: string): string {
  if (!iso || zone === "UTC") return whenText(iso, locale);
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return whenText(iso, locale);
  const text = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
  const label = zone === "Europe/Kyiv" ? (locale === "uk" ? "за Києвом" : "Kyiv time") : zone;
  return `${text} ${label}`;
}

/** The source a person reads beside a line, in their language. */
export function lineSource(line: BriefLine, locale: BriefLocale): string {
  return line.kind === "plan" ? (locale === "uk" ? "Нагляд" : "Monitoring") : line.source;
}

/** The sentence a line is as one piece of text — the claim with its source and time; what Telegram and the model read. */
export function lineSentence(line: BriefLine, locale: BriefLocale, zone = "UTC"): string {
  const claim = locale === "uk" ? line.uk : line.en;
  const when = zonedWhen(line.observedAt, locale, zone);
  if (line.mark === "unverified") return locale === "uk" ? `${line.source} пише, ${when}: ${claim}.` : `${line.source} reports, ${when}: ${claim}.`;
  return `${claim} — ${lineSource(line, locale)}, ${when}.`;
}

function shortTitle(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  return `${title.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/u, "")}…`;
}

function spotLine(kind: "sol" | "btc", label: string, read: SpotMarketRead): BriefLine | null {
  if (!read.ok || !read.market) return null;
  const market = read.market;
  const price = market.price;
  if (price === null) return null;
  const change = market.change24hPct;
  return {
    id: kind,
    kind,
    mark: "fact",
    en: `${label} ${usdText(price, "en")}, ${change === null ? "the day's change unavailable" : `${pct(change, "en")} over the day`}`,
    uk: `${label} ${usdText(price, "uk")}, ${change === null ? "зміна за добу недоступна" : `${pct(change, "uk")} за добу`}`,
    source: "Jupiter",
    observedAt: read.observedAt,
    href: `/app/spot?view=${market.category ?? "all"}&mint=${market.mint}`,
    figures: { pct: change === null ? [] : [round1(change)], usd: [price], moves: change === null ? [] : (kind === "btc" ? ["BTC", "cbBTC"] : ["SOL"]).map((symbol) => ({ symbol, pct: change })) },
  };
}

function storyLine(id: string, kind: "market-news" | "token-news", story: DigestStory, about: string | null): BriefLine {
  const also = story.also > 0 ? story.also : 0;
  const enAlso = also > 0 ? ` (and ${also} more ${also === 1 ? "source" : "sources"})` : "";
  const ukAlso = also > 0 ? ` (і ще ${also} ${also === 1 ? "джерело" : also < 5 ? "джерела" : "джерел"})` : "";
  const title = `«${shortTitle(story.title)}»`;
  return {
    id,
    kind,
    mark: "unverified",
    en: `${about ? `${about}: ` : ""}${title}${enAlso}`,
    uk: `${about ? `${about}: ` : ""}${title}${ukAlso}`,
    source: story.source,
    observedAt: story.publishedAt,
    href: story.url,
    figures: none(),
  };
}

const dayStories = (read: DigestRead, nowMs: number): readonly DigestStory[] => (read.ok && read.digest ? read.digest.stories.filter((story) => nowMs - Date.parse(story.publishedAt) <= DAY_MS) : []);

export type MarketReads = Readonly<{ sol: SpotMarketRead; btc: SpotMarketRead; movers: MoversRead; news: DigestRead }>;

/** «Сьогодні на ринку»: the same lines for everyone. */
export function marketLines(reads: MarketReads, nowMs: number): BriefLine[] {
  const lines: BriefLine[] = [];
  const sol = spotLine("sol", "SOL", reads.sol);
  if (sol) lines.push(sol);
  const btc = spotLine("btc", "BTC (cbBTC)", reads.btc);
  if (btc) lines.push(btc);
  if (reads.movers.ok) {
    const verified = (rows: typeof reads.movers.up) => rows.filter((row) => row.verified && row.changePct !== null && row.mint !== SOL_MINT && row.mint !== CBBTC_MINT && !STABLE_MINTS.has(row.mint));
    const up = verified(reads.movers.up).slice(0, 2);
    const down = verified(reads.movers.down).slice(0, 2);
    const list = (rows: typeof up, locale: BriefLocale) => rows.map((row) => `${safeSymbol(row.symbol, row.mint)} ${pct(row.changePct as number, locale)}`).join(", ");
    if (up.length > 0 || down.length > 0) {
      const en = [up.length > 0 ? `up most ${list(up, "en")}` : null, down.length > 0 ? `down most ${list(down, "en")}` : null].filter(Boolean).join("; ");
      const uk = [up.length > 0 ? `найбільше зросли ${list(up, "uk")}` : null, down.length > 0 ? `найбільше впали ${list(down, "uk")}` : null].filter(Boolean).join("; ");
      lines.push({ id: "movers", kind: "mover", mark: "fact", en: `Verified tokens over the day: ${en}`, uk: `Перевірені токени за добу: ${uk}`, source: "Jupiter", observedAt: reads.movers.observedAt, href: "/app/markets", figures: { pct: [...up, ...down].map((row) => round1(row.changePct as number)), usd: [], moves: [...up, ...down].map((row) => ({ symbol: safeSymbol(row.symbol, row.mint), pct: row.changePct as number })) } });
    }
  }
  dayStories(reads.news, nowMs)
    .slice(0, MARKET_STORIES)
    .forEach((story, index) => lines.push(storyLine(`market-news-${index + 1}`, "market-news", story, null)));
  return lines;
}

export type PersonalToken = Readonly<{ mint: string; held: boolean; watched: boolean; market: SpotMarketRead; news: DigestRead }>;

/**
 * «Твоє»: only what changed in the person's tokens, positions and plans over
 * the day. A token Jupiter does not verify gets no line of its own — an
 * airdropped token's name is someone else's words, never Ryntra's — and is
 * counted in `hidden` so the brief says so.
 */
/** The person's lines — at most `PERSONAL_LINES_MAX`; `more` counts the changes past them, so the brief says there are more. */
export function personalLines(reads: Readonly<{ tokens: readonly PersonalToken[]; notes: readonly InboxRecord[] }>, nowMs: number): BriefLine[] & { more?: number; hidden?: number } {
  const lines: BriefLine[] = [];
  let hidden = 0;
  for (const token of reads.tokens) {
    if (STABLE_MINTS.has(token.mint)) continue;
    const market = token.market.ok ? token.market.market : null;
    if (market && !market.verified) {
      /* Its move is a change all the same: counted, never named. */
      if (market.change24hPct !== null && Math.abs(market.change24hPct) >= MOVE_PCT) hidden += 1;
      continue;
    }
    const symbol = safeSymbol(market?.symbol, token.mint);
    const where = token.held ? ["in your wallet", "у гаманці"] : ["on your watchlist", "у списку"];
    const change = market?.change24hPct ?? null;
    if (token.market.ok && market && change !== null && Math.abs(change) >= MOVE_PCT) {
      lines.push({
        id: `token-${token.mint}`,
        kind: "token",
        mark: "fact",
        en: `${symbol} (${where[0]}) ${pct(change, "en")} over the day, now ${usdText(market.price, "en")}`,
        uk: `${symbol} (${where[1]}) ${pct(change, "uk")} за добу, зараз ${usdText(market.price, "uk")}`,
        source: "Jupiter",
        observedAt: token.market.observedAt,
        href: `/app/spot?view=${market.category ?? "all"}&mint=${token.mint}`,
        figures: { pct: [round1(change)], usd: market.price === null ? [] : [market.price], moves: [{ symbol, pct: change }] },
      });
    }
    const story = dayStories(token.news, nowMs)[0];
    if (story) lines.push(storyLine(`token-news-${token.mint}`, "token-news", story, symbol));
  }
  const day = reads.notes.filter((note) => nowMs - Date.parse(note.createdAt) <= DAY_MS && Date.parse(note.createdAt) <= nowMs);
  /* One line per plan or position: its latest note of the day. */
  const seen = new Set<string>();
  for (const note of [...day].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
    const key = note.subject ? `${note.subject.kind}:${note.subject.id}` : note.monitorId;
    if (seen.has(key)) continue;
    seen.add(key);
    const en = note.text?.en ?? (note.locale === "en" ? { title: note.title, reason: note.reason } : null);
    const uk = note.text?.uk ?? (note.locale === "uk" ? { title: note.title, reason: note.reason } : null);
    const label = note.context || (note.subject?.kind === "position" ? "Position" : "Plan");
    /* A note's title usually names its plan already («SOL: …»): the label is not said twice. */
    const said = (title: string) => shortTitle(title.startsWith(label) ? title : `${label}: ${title}`);
    lines.push({
      id: `plan-${note.id}`,
      kind: "plan",
      mark: "fact",
      en: said((en ?? uk)?.title ?? note.title),
      uk: said((uk ?? en)?.title ?? note.title),
      source: "Ryntra",
      observedAt: note.createdAt,
      href: note.href,
      figures: none(),
    });
  }
  const shown: BriefLine[] & { more?: number; hidden?: number } = lines.slice(0, PERSONAL_LINES_MAX);
  shown.more = Math.max(0, lines.length - PERSONAL_LINES_MAX);
  shown.hidden = hidden;
  return shown;
}

/** The headlines a brief's words must not repeat as their own. */
export function headlinesOf(lines: readonly BriefLine[]): string[] {
  return lines.filter((line) => line.mark === "unverified").flatMap((line) => [line.en, line.uk]);
}
