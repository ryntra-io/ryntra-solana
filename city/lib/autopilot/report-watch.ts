import { createHash } from 'node:crypto';

import { withBoundedCasRetry, type GuardStore } from '../../../lib/guard/store.ts';
import { readBook, type BookEntry } from '../../../lib/mandate/book.server.ts';
import { DAY_MS, type AgentDay } from '../../../lib/mandate/report.ts';
import { inboxKeyOf } from '../../../lib/monitoring/apply.ts';
import { claimTrigger, inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from '../../../lib/monitoring/store.ts';
import {
  AGENT_REPORT,
  AGENT_REPORT_HREF,
  AGENT_REPORT_TRIGGER,
  clockOf,
  dayDetail,
  daySummary,
  localClock,
  REPORT_HOUR,
  reportDue,
  worthTelling,
  type Lang,
  type ReportSettings,
} from './report.ts';

/**
 * The agent's daily report on Ryntra's server (CITY-194): once an hour the cron reads every person whose hour has come
 * on her own clock, takes what her agent did since the last report (at most a day) from its book, and — when it
 * traded — writes one note in the engine's own inbox with one delivery per channel her preferences carry: Telegram
 * where her account has a chat, the Ryntra app's push, the browser's push. The engine's delivery keeps the quiet hours
 * and the retries (`lib/monitoring/deliver.ts`); the note's Telegram message carries «Turn off daily report».
 *
 * One report a day: her settings are claimed for the day first, then the note by its day (`monitoringTriggers`), so two
 * passes never tell her twice. A day the agent did not trade is passed quietly. Reads and writes notes. Signs, sends
 * and trades nothing.
 */

export const REPORT_COLLECTION = 'agentReports' as const;
const PREFIX = 'r:';
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/** The pass starts no read after this; the cron has a minute for everything, the deliveries included. */
export const PASS_BUDGET_MS = 40_000;
/** People one pass tells, at most; the rest wait for the next hour's pass, still due. */
export const PER_PASS = 40;
/** A delivery is held from the monitoring cron this long: this pass sends it first. */
export const DELIVERY_HOLD_MS = 90_000;

export const reportKey = (owner: string) => `${PREFIX}${owner}`;
export const reportsOf = (store: GuardStore) => store.versioned<ReportSettings>(REPORT_COLLECTION);

export async function readReport(store: GuardStore, owner: string): Promise<ReportSettings | null> {
  return (await reportsOf(store).get(reportKey(owner))) ?? null;
}

export type ReportChange = Readonly<{ owner: string; timezone?: string; locale?: Lang; on?: boolean; hour?: number }>;

/** The city keeps her clock and language, and her choice of on and hour; a new report is on at {@link REPORT_HOUR}. */
export async function keepReport(store: GuardStore, change: ReportChange, nowMs: number): Promise<ReportSettings> {
  if (!WALLET.test(change.owner)) throw new TypeError('A wallet is addressed by its Solana address.');
  if (change.hour !== undefined && !(Number.isInteger(change.hour) && change.hour >= 0 && change.hour <= 23)) throw new TypeError('An hour is 0–23.');
  const reports = reportsOf(store);
  const key = reportKey(change.owner);
  const at = new Date(nowMs).toISOString();
  return withBoundedCasRetry(async () => {
    const current = await reports.get(key);
    const base: ReportSettings = current ?? { version: 0, owner: change.owner, on: true, hour: REPORT_HOUR, timezone: 'UTC', locale: 'en', toldDay: null, toldAt: null, updatedAt: at };
    const next: ReportSettings = {
      ...base,
      version: base.version + 1,
      on: change.on ?? base.on,
      hour: change.hour ?? base.hour,
      timezone: change.timezone === undefined ? base.timezone : clockOf(change.timezone),
      locale: change.locale ?? base.locale,
      updatedAt: at,
    };
    return (await reports.compareAndSet(key, current ? current.version : null, next)) ? next : false;
  });
}

/** What the agent did for one mandate in a span, and the names that say it; null when the book did not answer. */
export type ReportRead = Readonly<{ day: AgentDay; symbol: string | null; solUsd: number | null }> | null;

export type ReportDeps = Readonly<{
  store: GuardStore;
  cluster: 'devnet' | 'mainnet';
  clock: () => number;
  read: (entry: BookEntry, since: number, until: number) => Promise<ReportRead>;
  /** Sends the rows this pass queued (production: the monitoring delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  budgetMs?: number;
  perPass?: number;
}>;

export type ReportPass = Readonly<{ people: number; due: number; told: number; quiet: number; queued: number; failed: number; ms: number }>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);

/** The report as the engine's inbox keeps it: both languages, said in hers; it opens her agent in the city. */
export function reportNote(owner: string, identity: string, read: NonNullable<ReportRead>, locale: Lang, nowMs: number): InboxRecord {
  const say = (lang: Lang) => ({ title: AGENT_REPORT[lang].noteTitle(daySummary(read.day, lang, read.solUsd, true)), reason: dayDetail(read.day, lang, read.symbol) });
  const en = say('en');
  const uk = say('uk');
  const own = locale === 'uk' ? uk : en;
  return {
    id: `inb_${hash(identity)}`,
    owner,
    monitorId: `mon_${hash(`city-agent-report:${owner}`)}`,
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: AGENT_REPORT[locale].today,
    href: AGENT_REPORT_HREF,
    cta: AGENT_REPORT[locale].noteCta,
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale,
    text: { en: { title: en.title, reason: en.reason }, uk: { title: uk.title, reason: uk.reason } },
  };
}

async function queue(store: GuardStore, note: InboxRecord, channel: 'telegram' | 'push', nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(note.owner, note.triggerId, channel);
  const row: OutboxRecord = { id, owner: note.owner, triggerId: note.triggerId, inboxId: note.id, channel, state: 'pending', attempts: 0, nextAttemptAt: new Date(nowMs + DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(store).insertIfAbsent(id, row)) ? id : null;
}

/** Tells one day: claimed once by her day, the note once, its deliveries once each, as her preferences say. */
export async function tellReport(store: GuardStore, settings: ReportSettings, day: string, read: NonNullable<ReportRead>, nowMs: number): Promise<readonly string[] | null> {
  const identity = `${AGENT_REPORT_TRIGGER}${settings.owner}:${day}`;
  if (!(await claimTrigger(store, identity, new Date(nowMs).toISOString()))) return null;
  const note = reportNote(settings.owner, identity, read, settings.locale, nowMs);
  await inboxOf(store).insertIfAbsent(inboxKeyOf(settings.owner, note.id), note);
  const prefs = await readPreferences(store, settings.owner);
  /* Quiet hours are the delivery's to keep: it holds a row until they end. */
  const rows = [prefs.telegram ? await queue(store, note, 'telegram', nowMs) : null, prefs.push ? await queue(store, note, 'push', nowMs) : null];
  return rows.filter((id): id is string => id !== null);
}

/** The mandate a report speaks of: her newest in the book — at work, or the last one she had. */
export function entryFor(entries: readonly BookEntry[], owner: string): BookEntry | null {
  const hers = entries.filter((entry) => entry.record.owner === owner);
  if (hers.length === 0) return null;
  return [...hers].sort((a, b) => (a.status === 'working' ? 0 : 1) - (b.status === 'working' ? 0 : 1) || b.updatedAt - a.updatedAt)[0]!;
}

/** One pass: those whose hour has come, each claimed for the day, read and — when the agent traded — told. */
export async function runReportPass(deps: ReportDeps): Promise<ReportPass> {
  const started = deps.clock();
  const budget = deps.budgetMs ?? PASS_BUDGET_MS;
  const reports = reportsOf(deps.store);
  const all = await reports.valuesWithPrefix(PREFIX);
  const due = all.filter((settings) => WALLET.test(settings.owner) && reportDue(settings, started)).slice(0, deps.perPass ?? PER_PASS);
  const book = due.length ? await readBook(deps.store, deps.cluster) : [];
  const queued = new Set<string>();
  let told = 0;
  let quiet = 0;
  let failed = 0;
  for (const settings of due) {
    if (deps.clock() - started > budget) break;
    const now = deps.clock();
    const clock = localClock(now, settings.timezone);
    const entry = entryFor(book, settings.owner);
    /* Since the last report, never more than a day: «today» is her last day. */
    const since = Math.max(settings.toldAt ?? 0, now - DAY_MS);
    const read = entry ? await deps.read(entry, since, now).catch((): ReportRead => null) : null;
    if (entry && read === null) {
      // The book or the price did not answer: she stays due, and the next pass tries again.
      failed += 1;
      continue;
    }
    // Her day first: a pass that lost the race to another tells nothing twice.
    const next: ReportSettings = { ...settings, version: settings.version + 1, toldDay: clock.day, toldAt: now, updatedAt: new Date(now).toISOString() };
    if (!(await reports.compareAndSet(reportKey(settings.owner), settings.version, next))) continue;
    if (!read || !worthTelling(read.day)) {
      quiet += 1;
      continue;
    }
    const rows = await tellReport(deps.store, settings, clock.day, read, now).catch(() => null);
    if (rows === null) continue;
    told += 1;
    for (const id of rows) queued.add(id);
  }
  if (queued.size > 0 && deps.deliver) await deps.deliver(queued, deps.clock() + DELIVERY_HOLD_MS).catch(() => undefined);
  return { people: all.length, due: due.length, told, quiet, queued: queued.size, failed, ms: deps.clock() - started };
}
