/**
 * The pass that watches markets while nobody is looking.
 *
 * One pass for one wallet: read the rules that are on, group them by the
 * market they are about, read that market once for everything its rules
 * need, let the engine judge each rule, write what happened as a signal, and
 * hand the signal to the notification channel.
 *
 * The parts are deliberately apart, and each holds its own line:
 *
 * - **the engine decides.** Whether something happened is `engine.ts`, a
 *   deterministic read of figures against figures. Nothing in this file may
 *   overrule it, and no model is asked whether to send.
 * - **the model only explains.** A sentence of context is asked for after the
 *   fact, for a signal already raised, and is held to the engine's own
 *   figures before anybody reads it. A deployment with no model reads the
 *   same — the engine writes the sentence that matters.
 * - **the channel delivers.** The quiet hour, grouping the same thing,
 *   the ceiling per hour, one touch to stop and deciding a delivery once are
 *   the notification channel's, not this pass's. A watch note takes the same
 *   channel settlement does, so a person has one set of settings and one
 *   stop.
 * - **nothing is bought.** There is no path from here to a quote, an order, a
 *   signature or a payout — not with the person's agreement, and not with
 *   anybody's. A watch reports.
 *
 * Server only.
 */

import { fundingEnabled } from "../funding.ts";
import type { GuardStore } from "../../guard/store.ts";
import { liveWalletAllowed } from "../live.ts";
import type { PaperPosition } from "../model.ts";
import { deliverNotes, note, readPrefs, type NotifyPrefs, type NotifyTransports } from "../notify/channel.ts";
import { predictionNoteWords } from "../notify/words.ts";
import type { NoteLocale } from "../notify/words.ts";
import type { PredictionProvider, Result } from "../provider.ts";
import { withProviderSession } from "../session.ts";
import { judgeRule, reviewSignal, type WatchFacts, type WatchReads } from "./engine.ts";
import type { WatchExplainer } from "./explain.ts";
import { keepExplanation } from "./explain.ts";
import { needsOf, readSubject } from "./reads.ts";
import type { WatchRuleInput, WatchSubject } from "./rules.ts";
import {
  listWatchRules,
  listWatchSignals,
  pruneSignals,
  raiseSignal,
  recordVerdict,
  settleSignal,
  signalAged,
  signalOpen,
  type WatchRuleRecord,
  type WatchSignalRecord,
} from "./store.ts";
import { watchNoteKind, watchSentence, type WatchLocale } from "./words.ts";

/** How many markets one pass reads for one wallet, so a pass stays inside one request's budget. */
export const WATCH_SUBJECTS_PER_PASS = 12;
/** How many sentences a model may be asked for in one pass: the rest of the signals read on the engine's own words. */
export const WATCH_EXPLAIN_PER_PASS = 3;
/** How many wallets one operator pass sweeps. */
export const WATCH_WALLETS_LIMIT = 50;

/** Where every watch note points when its market is known. */
const marketHref = (subject: WatchSubject) => `/app/predictions/${encodeURIComponent(subject.eventId)}`;
const PORTFOLIO_HREF = "/app/predictions/portfolio";

export type WatchRuleView = Readonly<{
  id: string;
  rule: WatchRuleInput;
  on: boolean;
  lastOutcome: string | null;
  lastReason: string | null;
  lastCheckedAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
}>;

export type WatchSignalView = Readonly<{
  id: string;
  ruleId: string;
  ruleKind: string;
  state: WatchSignalRecord["state"];
  reason: string | null;
  subject: WatchSubject;
  facts: WatchFacts;
  /** What Ryntra states from the figures it compared. */
  said: string;
  /** The sentence a model added beside it, already held to those figures; null when there is none. */
  explanation: string | null;
  count: number;
  paper: boolean;
  /** True once the figures are too old to act on, whatever the state says. */
  aged: boolean;
  href: string;
  confirmedAt: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type WatchTally = Readonly<{ rules: number; watched: number; subjects: number; fired: number; confirmed: number; stale: number; unavailable: number; explained: number }>;

export type WatchSweep = Readonly<{
  wallet: string;
  mode: "paper" | "live";
  rules: readonly WatchRuleView[];
  signals: readonly WatchSignalView[];
  tally: WatchTally;
  /** Set when the provider could not be read at all; the rest is what the store holds. */
  providerFailure: Readonly<{ code: string; message: string }> | null;
  readAt: string;
}>;

export type WatchDeps = Readonly<{
  transports?: NotifyTransports;
  locale?: NoteLocale;
  /** A sentence of context for a signal already raised; absent, the engine's own words stand. */
  explain?: WatchExplainer;
  /** False for a read: the rules are not judged and nothing is sent — looking at the page never raises a signal. */
  judge?: boolean;
}>;

export function ruleView(record: WatchRuleRecord): WatchRuleView {
  return { id: record.id, rule: record.rule, on: record.on, lastOutcome: record.lastOutcome, lastReason: record.lastReason, lastCheckedAt: record.lastCheckedAt, lastFiredAt: record.lastFiredAt, createdAt: record.createdAt };
}

export function signalView(record: WatchSignalRecord, locale: WatchLocale, nowMs: number): WatchSignalView {
  return {
    id: record.id,
    ruleId: record.ruleId,
    ruleKind: record.ruleKind,
    state: record.state,
    reason: record.reason,
    subject: record.subject,
    facts: record.facts,
    said: watchSentence(watchNoteKind(record.ruleKind), { ...record.facts, question: record.subject.question, eventTitle: record.subject.eventTitle, outcomeLabel: record.subject.outcomeLabel }, locale),
    explanation: record.explanation,
    count: record.count,
    paper: record.paper,
    aged: signalAged(record, nowMs),
    href: record.ruleKind === "position_value" ? PORTFOLIO_HREF : marketHref(record.subject),
    confirmedAt: record.confirmedAt,
    readAt: record.readAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** When the least recently judged rule of a group was last read; never read comes first of all. */
function oldestCheck(records: readonly WatchRuleRecord[]): number {
  return Math.min(...records.map((record) => (record.lastCheckedAt === null ? 0 : Date.parse(record.lastCheckedAt) || 0)));
}

/** The facts a signal's words are made from: what the engine compared, with the market's own titles beside it. */
function factsWithSubject(subject: WatchSubject, facts: WatchFacts): WatchFacts {
  return { ...facts, question: subject.question, eventTitle: subject.eventTitle, outcomeLabel: subject.outcomeLabel, market: subject.venueMarketId };
}

/**
 * One wallet's pass. `judge: false` makes it a read — the rules and the
 * signals are returned as the store holds them, nothing is judged and
 * nothing is sent.
 */
export async function sweepWatch(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
  deps: WatchDeps = {},
): Promise<Result<WatchSweep>> {
  const live = fundingEnabled(env) && liveWalletAllowed(wallet, env);
  const mode: "paper" | "live" = live ? "live" : "paper";
  const locale: WatchLocale = deps.locale === "uk" ? "uk" : "en";
  const held = await listWatchRules(store, wallet);
  const watching = held.filter((record) => record.on);
  const tally = { rules: held.length, watched: watching.length, subjects: 0, fired: 0, confirmed: 0, stale: 0, unavailable: 0, explained: 0 };
  const stored = await listWatchSignals(store, wallet, Number.MAX_SAFE_INTEGER);
  const answer = async (providerFailure: WatchSweep["providerFailure"]): Promise<Result<WatchSweep>> => {
    const after = await listWatchSignals(store, wallet);
    return {
      ok: true,
      value: { wallet, mode, rules: (await listWatchRules(store, wallet)).map(ruleView), signals: after.map((record) => signalView(record, locale, nowMs)), tally, providerFailure, readAt: new Date(nowMs).toISOString() },
    };
  };

  /* Ageing is the store's own clock, not the provider's: it happens whether or not anything could be read. */
  for (const signal of stored) {
    if (!signalOpen(signal) || !signalAged(signal, nowMs)) continue;
    if (await settleSignal(store, wallet, signal.id, "stale", "aged", nowMs)) tally.stale += 1;
  }

  if (deps.judge === false || watching.length === 0) return answer(null);

  /*
   * The rules of one market and one side are read together: one read serves
   * every rule about them. The side is part of the key because a market's
   * price and its bars are a side's, and a person may watch Yes and No of the
   * same market — one read cannot answer for both.
   */
  const bySubject = new Map<string, WatchRuleRecord[]>();
  for (const record of watching) {
    const key = `${record.rule.subject.venueMarketId}|${record.rule.subject.outcomeId ?? "-"}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), record]);
  }
  /*
   * Longest unread first. A wallet with more markets than one pass reads
   * would otherwise keep reading the same first few for ever, and its last
   * market would never be watched at all.
   */
  const queue = [...bySubject.values()].sort((a, b) => oldestCheck(a) - oldestCheck(b));

  /* The positions are read once for the wallet, and only when a rule is about one. */
  let positions: readonly PaperPosition[] = [];
  let providerFailure: WatchSweep["providerFailure"] = null;
  if (watching.some((record) => record.rule.kind === "position_value")) {
    const read = await withProviderSession(
      store,
      provider,
      wallet,
      async (session) => {
        const [active, closed] = await Promise.all([provider.paperPositions(session, "active", mode), provider.paperPositions(session, "closed", mode)]);
        if (!active.ok) return active;
        if (!closed.ok) return closed;
        return { ok: true as const, value: [...active.value, ...closed.value] };
      },
      env,
      nowMs,
    ).catch(() => null);
    if (read && read.ok) positions = read.value;
    else if (read && !read.ok) providerFailure = { code: read.code, message: read.message };
  }

  const prefs = await readPrefs(store, wallet, nowMs);
  let explained = 0;

  for (const records of queue.slice(0, WATCH_SUBJECTS_PER_PASS)) {
    const subject = records[0]!.rule.subject;
    const needs = needsOf(records.map((record) => record.rule));
    const reads = await readSubject(subject, needs, { store, provider, positions, nowMs }).catch((): WatchReads => ({ readAt: nowMs }));
    tally.subjects += 1;

    for (const record of records) {
      /*
       * A rule whose last pass could not be read did not watch what happened
       * in between: it re-baselines rather than announcing a level the market
       * crossed unobserved. This is the same discipline a reconnecting socket
       * needs, for the same reason.
       */
      const reconnected = record.lastOutcome === "unavailable" || record.lastOutcome === "stale";
      const verdict = judgeRule(record.rule, { ...reads, reconnected }, record.observation);
      await recordVerdict(store, wallet, record.id, { observation: verdict.observation, outcome: verdict.outcome, reason: verdict.reason, fired: verdict.outcome === "fired" }, nowMs);
      if (verdict.outcome === "unavailable") tally.unavailable += 1;

      if (verdict.outcome === "fired" && verdict.facts && verdict.event) {
        const facts = factsWithSubject(subject, verdict.facts);
        const said = watchSentence(watchNoteKind(record.rule.kind), facts, locale);
        /* The model is asked only about a signal the engine already raised, and only for the first few of a pass. */
        let explanation: string | null = null;
        if (deps.explain && explained < WATCH_EXPLAIN_PER_PASS) {
          explained += 1;
          const written = await deps
            .explain({ locale, kind: record.rule.kind, eventTitle: subject.eventTitle, question: subject.question, outcomeLabel: subject.outcomeLabel, facts: verdict.facts, said })
            .catch(() => null);
          if (written) {
            const kept = keepExplanation(written, { locale, kind: record.rule.kind, eventTitle: subject.eventTitle, question: subject.question, outcomeLabel: subject.outcomeLabel, facts: verdict.facts, said });
            if (kept.ok) {
              explanation = kept.text;
              tally.explained += 1;
            }
          }
        }
        const raised = await raiseSignal(store, wallet, { ruleId: record.id, ruleKind: record.rule.kind, subject, event: verdict.event, facts, paper: mode === "paper", explanation }, nowMs);
        tally.fired += 1;
        /* One happening, one note: the signal's own identity is the note's, so a pass that ran twice tells the person once. */
        await note(
          store,
          wallet,
          {
            kind: watchNoteKind(record.rule.kind),
            identity: `watch:${record.id}:${verdict.event}`,
            facts: { ...facts, explanation: raised.signal.explanation },
            href: record.rule.kind === "position_value" ? PORTFOLIO_HREF : marketHref(subject),
            paper: mode === "paper",
          },
          nowMs,
        );
      }
    }

    /* What a later read says about the signals already raised on this market. Confirming or going stale sends nothing. */
    for (const signal of stored) {
      if (!signalOpen(signal) || signalAged(signal, nowMs)) continue;
      const rule = records.find((record) => record.id === signal.ruleId);
      if (!rule) continue;
      /* The read that raised a signal cannot also confirm it: a second, later read must agree. */
      if (Date.parse(signal.updatedAt) >= nowMs) continue;
      const review = reviewSignal(rule.rule, signal.facts, reads);
      if (review === "confirmed" && signal.state === "confirmed") continue;
      if (review === "unavailable" && signal.state === "unavailable") continue;
      const settled = await settleSignal(store, wallet, signal.id, review, review === "confirmed" ? "still_there" : review === "stale" ? "no_longer_there" : "market_unreadable", nowMs);
      if (!settled) continue;
      if (review === "confirmed") tally.confirmed += 1;
      else if (review === "stale") tally.stale += 1;
      else tally.unavailable += 1;
    }
  }

  if (deps.transports) await deliver(store, wallet, deps.transports, locale, prefs, nowMs);
  await pruneSignals(store, wallet, new Set(held.map((record) => record.id))).catch(() => undefined);
  return answer(providerFailure);
}

/** Send what is due for the wallet, each note in its own vocabulary. */
async function deliver(store: GuardStore, wallet: string, transports: NotifyTransports, locale: WatchLocale, prefs: NotifyPrefs, nowMs: number): Promise<void> {
  await deliverNotes(store, wallet, { transports, words: (row) => predictionNoteWords(row, locale), prefs }, nowMs).catch(() => undefined);
}
