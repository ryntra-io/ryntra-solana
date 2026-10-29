/**
 * Ryntra's journal of assessments on prediction markets — kept so that its
 * accuracy can be judged in public once the markets settle.
 *
 * Each answer Ryntra gives on a market writes one line: when, on which
 * outcome, the market's price then, and Ryntra's own probability — none yet:
 * this version gives no chance of its own, and the line says so rather than
 * inventing one. After the market settles, the journal scores every line
 * with the Brier score (the squared gap between the probability and what
 * happened): the market's price beside Ryntra's, and a calibration table of
 * the market's prices by tenths. If the market is the better forecaster, the
 * journal shows it.
 *
 * One line an hour per market outcome is enough to follow its price; no
 * wallet is written — the journal is Ryntra's, not the person's. Settling is
 * lazy and bounded: each read of the journal checks a few of the oldest
 * unsettled markets. Open markets and settled ones are indexed apart: a run
 * of questions on new markets pushes out only the oldest open ones, never a
 * scored record.
 *
 * Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";
import type { PredictionProvider } from "../provider.ts";
import { settlementPhase } from "../resolution.ts";
import type { AskTopic } from "./topics.ts";

export type JournalLine = Readonly<{
  at: string;
  topic: AskTopic;
  /** The outcome's price (0–1) when Ryntra answered; null when the read gave none. */
  market: number | null;
  /** Ryntra's own probability (0–1); null — this version gives none. */
  ryntra: number | null;
}>;

export type JournalRecord = Readonly<{
  version: number;
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  outcomeLabel: string;
  question: string;
  lines: readonly JournalLine[];
  /** Once settled: whether this outcome won, and when Ryntra saw it. */
  settled: Readonly<{ won: boolean; at: string }> | null;
  checkedAt: string | null;
  updatedAt: string;
}>;

type JournalIndex = Readonly<{ version: number; keys: readonly string[]; updatedAt: string }>;

/* The line's own collection is the line's watchlist collection, keyed apart — the store's names are fixed. */
const COLLECTION = "predictionWatchlists" as const;
const PREFIX = "ryntra-journal:";
const INDEX_KEY = "ryntra-journal-index";
const SETTLED_KEY = "ryntra-journal-settled";
export const JOURNAL_LINES_KEPT = 200;
/** Open markets the journal follows; the oldest go first. */
export const JOURNAL_MARKETS_KEPT = 2_000;
/** Settled, scored markets the journal keeps. */
export const JOURNAL_SETTLED_KEPT = 20_000;
export const JOURNAL_LINE_GAP_MS = 60 * 60 * 1000;
/** How many unsettled markets a read checks, and how often one market is checked. */
export const JOURNAL_SETTLE_BATCH = 4;
export const JOURNAL_CHECK_GAP_MS = 6 * 60 * 60 * 1000;

const keyOf = (venueMarketId: string, outcomeId: string) => `${PREFIX}${venueMarketId}:${outcomeId}`;

function records(store: GuardStore) {
  return store.versioned<JournalRecord>(COLLECTION);
}
function index(store: GuardStore) {
  return store.versioned<JournalIndex>(COLLECTION);
}

/** A line written for an answer: at most one an hour per market outcome, none on a settled market. Returns whether a line was written. */
export async function writeJournalLine(
  store: GuardStore,
  input: Readonly<{ eventId: string; venueMarketId: string; outcomeId: string; outcomeLabel: string; question: string; topic: AskTopic; market: number | null; nowMs: number }>,
): Promise<boolean> {
  const key = keyOf(input.venueMarketId, input.outcomeId);
  const at = new Date(input.nowMs).toISOString();
  const line: JournalLine = { at, topic: input.topic, market: input.market != null && Number.isFinite(input.market) ? Math.round(input.market * 10_000) / 10_000 : null, ryntra: null };
  const wrote = await withBoundedCasRetry(async () => {
    const current = await records(store).get(key);
    if (current?.settled) return "skip" as const;
    const last = current?.lines[current.lines.length - 1];
    if (last && input.nowMs - Date.parse(last.at) < JOURNAL_LINE_GAP_MS) return "skip" as const;
    const next: JournalRecord = {
      version: (current?.version ?? 0) + 1,
      eventId: input.eventId,
      venueMarketId: input.venueMarketId,
      outcomeId: input.outcomeId,
      outcomeLabel: input.outcomeLabel.slice(0, 64),
      question: input.question.slice(0, 300),
      lines: [...(current?.lines ?? []), line].slice(-JOURNAL_LINES_KEPT),
      settled: null,
      checkedAt: current?.checkedAt ?? null,
      updatedAt: at,
    };
    const ok = current ? await records(store).compareAndSet(key, current.version, next) : await records(store).insertIfAbsent(key, next);
    return ok ? ("wrote" as const) : false;
  });
  if (wrote !== "wrote") return false;
  await addToIndex(store, INDEX_KEY, key, JOURNAL_MARKETS_KEPT, at);
  return true;
}

async function addToIndex(store: GuardStore, indexKey: string, key: string, kept: number, at: string): Promise<boolean> {
  return withBoundedCasRetry(async () => {
    const current = await index(store).get(indexKey);
    if (current?.keys.includes(key)) return true;
    const next: JournalIndex = { version: (current?.version ?? 0) + 1, keys: [...(current?.keys ?? []), key].slice(-kept), updatedAt: at };
    return current ? await index(store).compareAndSet(indexKey, current.version, next) : await index(store).insertIfAbsent(indexKey, next);
  }).catch(() => false);
}

async function dropFromIndex(store: GuardStore, indexKey: string, key: string, at: string): Promise<boolean> {
  return withBoundedCasRetry(async () => {
    const current = await index(store).get(indexKey);
    if (!current || !current.keys.includes(key)) return true;
    return index(store).compareAndSet(indexKey, current.version, { version: current.version + 1, keys: current.keys.filter((k) => k !== key), updatedAt: at });
  }).catch(() => false);
}

/** Check a few of the oldest unsettled markets against the provider; a settled one keeps whether its outcome won. */
export async function settleJournal(store: GuardStore, provider: PredictionProvider, nowMs: number, batch = JOURNAL_SETTLE_BATCH): Promise<number> {
  const keys = (await index(store).get(INDEX_KEY))?.keys ?? [];
  const open: JournalRecord[] = [];
  for (const key of keys) {
    const record = await records(store).get(key);
    if (!record) continue;
    if (record.settled) {
      /* Settled but its move to the settled index did not land: moved now, so it never falls out of the score. */
      const at = new Date(nowMs).toISOString();
      if (await addToIndex(store, SETTLED_KEY, key, JOURNAL_SETTLED_KEPT, at)) await dropFromIndex(store, INDEX_KEY, key, at);
      continue;
    }
    if (record.checkedAt && nowMs - Date.parse(record.checkedAt) < JOURNAL_CHECK_GAP_MS) continue;
    open.push(record);
  }
  open.sort((a, b) => (Date.parse(a.checkedAt ?? "") || 0) - (Date.parse(b.checkedAt ?? "") || 0));
  let settled = 0;
  for (const record of open.slice(0, batch)) {
    const read = await provider.event(record.eventId);
    const market = read.ok ? (read.value.markets.find((m) => m.id === record.venueMarketId) ?? null) : null;
    const phase = market && read.ok ? settlementPhase(market, read.value.endDate, nowMs) : null;
    const outcome = market?.outcomes.find((o) => o.id === record.outcomeId) ?? null;
    /* Settled only when the venue names the winner: a result without one is no score. */
    const result = phase?.phase === "resolved" && market && market.outcomes.some((o) => o.winner === true) && outcome ? { won: outcome.winner === true, at: new Date(nowMs).toISOString() } : null;
    const key = keyOf(record.venueMarketId, record.outcomeId);
    const ok = await withBoundedCasRetry(async () => {
      const current = await records(store).get(key);
      if (!current || current.settled) return true;
      return records(store).compareAndSet(key, current.version, { ...current, version: current.version + 1, settled: result, checkedAt: new Date(nowMs).toISOString(), updatedAt: new Date(nowMs).toISOString() });
    }).catch(() => false);
    if (ok && result) {
      settled += 1;
      /* Scored: moved to the settled index, where new questions never push it out. */
      const at = new Date(nowMs).toISOString();
      if (await addToIndex(store, SETTLED_KEY, key, JOURNAL_SETTLED_KEPT, at)) await dropFromIndex(store, INDEX_KEY, key, at);
    }
  }
  return settled;
}

/** The Brier score of probabilities against what happened: 0 is perfect, 0.25 is a coin's 50 % every time. */
export function brier(pairs: readonly Readonly<{ p: number; won: boolean }>[]): number | null {
  if (pairs.length === 0) return null;
  const sum = pairs.reduce((acc, pair) => acc + (pair.p - (pair.won ? 1 : 0)) ** 2, 0);
  return Math.round((sum / pairs.length) * 10_000) / 10_000;
}

export type JournalScore = Readonly<{
  markets: number;
  lines: number;
  settledMarkets: number;
  settledLines: number;
  /** The market's price at each settled line, scored. */
  brierMarket: number | null;
  /** Ryntra's own probability at each settled line, scored; null while it gives none. */
  brierRyntra: number | null;
  /** Lines carrying a probability of Ryntra's own. */
  ryntraLines: number;
  /** The market's prices by tenths: how often the outcome won where the market priced it so. */
  calibration: readonly Readonly<{ from: number; to: number; lines: number; won: number }>[];
}>;

/** The score of the journal's records: the market's Brier and Ryntra's side by side, and the market's calibration. */
export function scoreJournal(list: readonly JournalRecord[]): JournalScore {
  const settled = list.filter((r) => r.settled);
  const marketPairs = settled.flatMap((r) => r.lines.filter((l) => l.market != null).map((l) => ({ p: l.market as number, won: r.settled!.won })));
  const ryntraPairs = settled.flatMap((r) => r.lines.filter((l) => l.ryntra != null).map((l) => ({ p: l.ryntra as number, won: r.settled!.won })));
  const calibration = Array.from({ length: 10 }, (_, i) => {
    const from = i / 10;
    const to = (i + 1) / 10;
    const inside = marketPairs.filter((pair) => pair.p >= from && (i === 9 ? pair.p <= to : pair.p < to));
    return { from, to, lines: inside.length, won: inside.filter((pair) => pair.won).length };
  });
  return {
    markets: list.length,
    lines: list.reduce((n, r) => n + r.lines.length, 0),
    settledMarkets: settled.length,
    settledLines: settled.reduce((n, r) => n + r.lines.length, 0),
    brierMarket: brier(marketPairs),
    brierRyntra: brier(ryntraPairs),
    ryntraLines: list.reduce((n, r) => n + r.lines.filter((l) => l.ryntra != null).length, 0),
    calibration,
  };
}

/** Every record the journal keeps, the settled ones first. */
export async function readJournal(store: GuardStore): Promise<readonly JournalRecord[]> {
  const settled = (await index(store).get(SETTLED_KEY))?.keys ?? [];
  const open = (await index(store).get(INDEX_KEY))?.keys ?? [];
  const keys = [...new Set([...settled, ...open])];
  const out: JournalRecord[] = [];
  for (const key of keys) {
    const record = await records(store).get(key);
    if (record) out.push(record);
  }
  return out;
}
