/**
 * «What exactly you pay for» — before a person buys, the market's own rules
 * read down to four facts: when Yes wins (one sentence), who or what decides
 * the result, the deadline, and the exceptions that can change or cancel the
 * payout. Then where the market stands with its settlement, and when its
 * rules or dates changed since Ryntra first read them.
 *
 * The venue writes the rules (in English); Ryntra only picks the sentences
 * that answer each question and keeps them verbatim — nothing is paraphrased,
 * and the whole text stays a tap deeper. A question the rules do not answer
 * is said to be unanswered, never guessed.
 *
 * Pure: shared by the server and the pages.
 */

import { marketTradable, type PredictionMarket, type PredictionMarketStatus } from "./model.ts";

/* ------------------------------------------------------------- the brief */

export type RulesQuote = Readonly<{ text: string; url: string | null }>;

export type ResolutionBrief = Readonly<{
  /** The venue's sentence that says when Yes wins; null when its rules have none. */
  yesWhen: string | null;
  /** The venue's sentence that names the resolution source, with the first address in it. */
  source: RulesQuote | null;
  /** The sentences on cancellation, postponement, ties, voids, delays and fallbacks, at most four. */
  exceptions: readonly string[];
  /** Trading stops; the venue's own date. */
  closesAt: string | null;
  /** The venue's resolution date where it gives one. */
  resolvesBy: string | null;
}>;

const YES_WHEN = /\bresol\w*\s+(?:to\s+)?["'“‘]?yes\b|\bthen the market resolves to yes\b|\bwill (?:settle|pay out)\s+(?:to\s+|as\s+)?["'“‘]?yes\b/i;
const SOURCE = /\bresolution source\b|\bsource agenc|\bsettlement source\b|\bprimary source\b|\baccording to\b|\bas reported by\b|\bbased on (?:the )?(?:official|data|figures|results|information)\b|\bwill be (?:determined|resolved|settled) (?:by|using|based)\b|\bresolved (?:using|by|based on)\b|\bdata from\b|\bper the\b/i;
const EXCEPTION = /\bcancel|\bpostpon|\bvoid|\bannul|\bdelay|\breschedul|\btie\b|\bdraw\b|50[-–]50|\bfifty\b|\brefund|\binvalid|\bambigu|\bdisput|\bclarif|\bdoes not (?:occur|happen|take place)|\bnot (?:held|completed|played)|\bextend|\bunavailable\b|\bfallback\b|\bin the event\b|^if no\b|\bnot (?:released|published|announced|available|reported)\b|\bno (?:statement|data|result|winner|announcement)\b/i;
const URL = /https?:\/\/[^\s)"'<>\]]+/i;
/* The fallback sentence ("Otherwise … Yes") names the outcome without a condition of its own. */
const FALLBACK = /^(?:otherwise|else|in all other cases|in any other case)\b/i;

/* Words a period follows without ending the sentence: «the U.S. Senate», «11:59 p.m. ET», «by Dec. 31». */
const ABBREVIATION = /^(?:U\.S|U\.K|U\.N|E\.U|a\.m|p\.m|e\.g|i\.e|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|st|vs|inc|jr|sr|mr|mrs|ms|dr|etc|approx|corp|ltd|co|gov|sen|rep)$/i;
/* An initial is one capital letter («John F. Kennedy»); «Group B.» before «The …» still ends a sentence, as any of these does before a word that opens one. */
const INITIAL = /^[A-Z]$/;
const OPENER = /^["“‘'(]?(?:The|This|That|These|If|Otherwise|In|It|Any|All|Each|When|Should|Trading|Resolution|Yes|No|For|A|An)\b/;

/**
 * The venue's text cut into sentences. A period ends one only before a space
 * and a capital, a digit or an opening quote; an address, a decimal, an
 * abbreviation or a period inside closing quotes ("Yes.") does not end one
 * early, and the closing quote stays with its sentence.
 */
export function sentences(text: string | null | undefined): readonly string[] {
  if (!text) return [];
  const flat = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0;
  const end = /[.!?]["”’')]?\s+(?=["“‘'(]?[A-Z0-9])/g;
  for (let m = end.exec(flat); m; m = end.exec(flat)) {
    const word = flat.slice(start, m.index).match(/(\S+)$/)?.[1] ?? "";
    const bare = word.replace(/^["“‘'(]+/, "");
    const next = flat.slice(m.index + m[0].length);
    /* A letter is an initial only inside a name: the word before it is capitalised too («John F. Kennedy», not «Plan B.»). */
    const before = flat.slice(start, m.index - word.length).trim().match(/(\S+)$/)?.[1] ?? "";
    const initial = INITIAL.test(bare) && /^[A-Z][a-z]/.test(before);
    if (flat[m.index] === "." && (ABBREVIATION.test(bare) || initial) && !OPENER.test(next)) continue;
    out.push(flat.slice(start, m.index + m[0].trimEnd().length).trim());
    start = m.index + m[0].length;
  }
  out.push(flat.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

export function resolutionBrief(market: Pick<PredictionMarket, "description" | "rules" | "endDate" | "resolutionDate">, eventEndDate: string | null = null): ResolutionBrief {
  /* The rules first, the description after: a venue that writes both puts the binding words in its rules. */
  const all = [...new Set([...sentences(market.rules.primary), ...sentences(market.description), ...sentences(market.rules.secondary)])];
  /* The condition itself, not the fallback, and not an exception that also ends in Yes; an exception-only Yes is still a condition when nothing else is. */
  const yesCandidates = [...all.filter((s) => YES_WHEN.test(s)), ...all.filter((s) => /^if\b/i.test(s) && /\byes\b/i.test(s))].filter((s) => !FALLBACK.test(s));
  const yesWhen = yesCandidates.find((s) => !EXCEPTION.test(s)) ?? yesCandidates[0] ?? null;
  /* The win sentence names the source itself when no other sentence does («… per the BLS release»). */
  const sourceText = all.find((s) => s !== yesWhen && SOURCE.test(s)) ?? (yesWhen && (SOURCE.test(yesWhen) || URL.test(yesWhen)) ? yesWhen : null);
  const url = sourceText?.match(URL)?.[0]?.replace(/[.,;:!?)\]]+$/, "") ?? null;
  const exceptions = all.filter((s) => s !== yesWhen && s !== sourceText && EXCEPTION.test(s)).slice(0, 4);
  return {
    yesWhen,
    source: sourceText ? { text: sourceText, url } : null,
    exceptions,
    closesAt: market.endDate ?? eventEndDate ?? null,
    resolvesBy: market.resolutionDate ?? null,
  };
}

/* ------------------------------------------------------------- the clock */

/** Within this of the close the page and the Review warn that the deadline is near. */
export const DEADLINE_WARN_MS = 24 * 60 * 60 * 1000;
/** A market closed this long without a result, and no resolution date given, reads as delayed. */
export const SETTLEMENT_LATE_MS = 7 * 24 * 60 * 60 * 1000;
/** A venue's result date is often its close; a result this long past it is late, not merely being settled. */
export const RESULT_GRACE_MS = 48 * 60 * 60 * 1000;

export type SettlementPhase =
  /** Trading; the close is more than a day away, or the venue gives no date. */
  | Readonly<{ phase: "open"; closesInMs: number | null }>
  /** Trading; the close is within a day. */
  | Readonly<{ phase: "closing"; closesInMs: number }>
  /** Trading has stopped; the result is not in yet and not late. */
  | Readonly<{ phase: "awaiting"; closedAgoMs: number | null }>
  /** The venue's close has passed, but it still lists the market as open; no result yet and not late. */
  | Readonly<{ phase: "past"; pastByMs: number }>
  /** The result is two days later than the venue's own date (`lateByMs` past that date), or a week past the close without one (`lateByMs` since the close — `date` when the venue still lists the market as open). */
  | Readonly<{ phase: "delayed"; lateByMs: number; since: "resolution" | "close" | "date" }>
  /** The result is in; `winner` is the winning outcome's label where the venue names one. */
  | Readonly<{ phase: "resolved"; winner: string | null }>;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Where the market stands with its settlement, from its status, its outcomes
 * and its two dates. A disputed result is not a status the provider reports;
 * it shows here as a delay past the venue's own date.
 */
export function settlementPhase(
  market: Readonly<{ status: PredictionMarketStatus; outcomes: readonly Readonly<{ label: string; winner: boolean | null }>[]; endDate: string | null; resolutionDate: string | null }>,
  eventEndDate: string | null,
  nowMs: number,
): SettlementPhase {
  const winner = market.outcomes.find((o) => o.winner === true);
  if (market.status === "resolved" || winner) return { phase: "resolved", winner: winner?.label ?? null };
  const close = ms(market.endDate ?? eventEndDate);
  const stated = ms(market.resolutionDate);
  /* A resolution date earlier than the close is a venue's placeholder, not a promise. */
  const resolution = stated != null && (close == null || stated >= close) ? stated : null;
  const passed = close != null && close <= nowMs;
  if (market.status !== "closed" && !passed) {
    const left = close == null ? null : close - nowMs;
    return left != null && left <= DEADLINE_WARN_MS ? { phase: "closing", closesInMs: left } : { phase: "open", closesInMs: left };
  }
  if (resolution != null && nowMs - resolution > RESULT_GRACE_MS) return { phase: "delayed", lateByMs: nowMs - resolution, since: "resolution" };
  if (resolution == null && close != null && nowMs - close > SETTLEMENT_LATE_MS) return { phase: "delayed", lateByMs: nowMs - close, since: market.status === "closed" ? "close" : "date" };
  /* Some venues keep trading past the date they state; that is not «trading has stopped». */
  if (market.status !== "closed" && close != null) return { phase: "past", pastByMs: nowMs - close };
  return { phase: "awaiting", closedAgoMs: close == null ? null : Math.max(0, nowMs - close) };
}

/**
 * Whether a market page offers the market at all: the venue lists it open,
 * names no winner, and its close is still ahead — the same rule the hub's
 * lists keep. Past its date it is awaiting a result, whatever the venue
 * still lists; the page then says so instead of quoting a payout.
 */
export function marketLive(
  market: Readonly<{ status: PredictionMarketStatus; outcomes: readonly Readonly<{ label: string; winner: boolean | null }>[]; endDate: string | null; resolutionDate: string | null }>,
  eventEndDate: string | null,
  nowMs: number,
  /** The event is a game under way: a venue still listing the market open past its date is trading through play. */
  inPlay = false,
): boolean {
  if (!marketTradable(market)) return false;
  const { phase } = settlementPhase(market, eventEndDate, nowMs);
  return phase === "open" || phase === "closing" || (inPlay && (phase === "past" || phase === "delayed"));
}

/* ------------------------------------------------------------- the rules over time */

/** What Ryntra keeps of a venue market's rules to notice a change: the texts and the two dates. */
export type RulesSnapshot = Readonly<{
  description: string | null;
  primary: string | null;
  secondary: string | null;
  endDate: string | null;
  resolutionDate: string | null;
}>;

export type RulesChange = Readonly<{
  /** When Ryntra first read the new version. */
  at: string;
  venue: string;
  venueMarketId: string;
  diff: RulesDiff;
}>;

/** The longest rules text kept per field; the venue's full text is always read live. */
export const RULES_TEXT_LIMIT = 6000;

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  return t ? t.slice(0, RULES_TEXT_LIMIT) : null;
}

export function rulesSnapshot(market: Readonly<{ description: string | null; rules: Readonly<{ primary: string | null; secondary: string | null }>; endDate?: string | null; resolutionDate?: string | null }>): RulesSnapshot {
  return {
    description: clip(market.description),
    primary: clip(market.rules.primary),
    secondary: clip(market.rules.secondary),
    endDate: market.endDate ?? null,
    resolutionDate: market.resolutionDate ?? null,
  };
}

/** A stable short fingerprint of a snapshot (FNV-1a, 32 bits, hex): whitespace alone is no change. */
export function rulesFingerprint(snapshot: RulesSnapshot): string {
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  const key = [norm(snapshot.description), norm(snapshot.primary), norm(snapshot.secondary), ms(snapshot.endDate) ?? "", ms(snapshot.resolutionDate) ?? ""].join("␞");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type RulesDiff = Readonly<{
  closes: Readonly<{ before: string | null; after: string | null }> | null;
  resolves: Readonly<{ before: string | null; after: string | null }> | null;
  /** Sentences the new version no longer has, and sentences it adds, verbatim. */
  removed: readonly string[];
  added: readonly string[];
}>;

/** The sentences a change keeps, and their length: enough to read the change, never the whole text twice. */
export const RULES_DIFF_SENTENCES = 12;
export const RULES_DIFF_SENTENCE_LIMIT = 600;

/** A snapshot with no rules text at all — a read that came back empty, not a venue that deleted its rules. */
export function rulesEmpty(snapshot: RulesSnapshot): boolean {
  return !snapshot.description && !snapshot.primary && !snapshot.secondary;
}

/** What changed between two versions, sentence by sentence, and which date moved. */
export function rulesDiff(before: RulesSnapshot, after: RulesSnapshot): RulesDiff {
  const text = (s: RulesSnapshot) => [...sentences(s.primary), ...sentences(s.description), ...sentences(s.secondary)];
  const was = text(before);
  const now = text(after);
  const wasSet = new Set(was);
  const nowSet = new Set(now);
  const moved = (a: string | null, b: string | null) => (ms(a) === ms(b) ? null : { before: a, after: b });
  return {
    closes: moved(before.endDate, after.endDate),
    resolves: moved(before.resolutionDate, after.resolutionDate),
    removed: [...new Set(was.filter((s) => !nowSet.has(s)))].slice(0, RULES_DIFF_SENTENCES).map((s) => s.slice(0, RULES_DIFF_SENTENCE_LIMIT)),
    added: [...new Set(now.filter((s) => !wasSet.has(s)))].slice(0, RULES_DIFF_SENTENCES).map((s) => s.slice(0, RULES_DIFF_SENTENCE_LIMIT)),
  };
}
