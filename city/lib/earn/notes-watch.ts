import { createHash } from 'node:crypto';

import { withBoundedCasRetry, type GuardStore } from '../../../lib/guard/store.ts';
import { inboxKeyOf } from '../../../lib/monitoring/apply.ts';
import { claimTrigger, inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from '../../../lib/monitoring/store.ts';
import {
  dividendTells,
  EARN_HREF,
  EARN_NOTE_WORDS,
  EARN_TRIGGER_PREFIX,
  earnNoteText,
  earnSubject,
  loanTells,
  rangeTells,
  weekendKey,
  weekendTell,
  type EarnEvent,
  type LoanGrade,
  type LoanRead,
  type Locale,
  type RangeRead,
  type StockHeld,
} from './notes.ts';
import type { ScaledConfig } from './stocks.ts';

/**
 * Ryntra's server watching Earn for the phone and Telegram (CITY-100, spec E9 «сервер-спостерігач»): every wallet that
 * asked under its own proof (`registerEarnWatch`, from the city once the wallet has something in Earn) is read now and
 * then — its pool positions, the stocks it holds or pools, its loans once Earn reads them — judged by the same
 * `notes.ts` as the city, and what is new becomes a note in the engine's own inbox with one delivery per channel the
 * wallet's preferences carry: Telegram where the account has a chat, the Ryntra app's push on the phone, the browser's
 * push. The engine's delivery keeps the quiet hours and the retries (`lib/monitoring/deliver.ts`).
 *
 * Late by design: a wallet is read at most every {@link EVERY_MS}, a few per pass, so a note can arrive minutes after
 * the fact — the notification window says so behind its «i».
 *
 * Each note is claimed once (`monitoringTriggers`): a position's exit by the read it was seen at, a dividend date and a
 * weekend for good, a loan's fall by its grade and read. The first positions read of a wallet is taken as known — the
 * city has just told it on screen. Reads and writes notes. Signs, sends and trades nothing.
 */

/** A wallet is read at most this often. */
export const EVERY_MS = 15 * 60_000;
/** Wallets one pass reads. */
export const WALLETS_PER_PASS = 12;
/** The pass starts no read after this; the cron has a minute for everything, the deliveries included. */
export const PASS_BUDGET_MS = 35_000;
/** A delivery is held from the monitoring cron this long: this pass sends it first. */
export const DELIVERY_HOLD_MS = 90_000;
/** A watch that found nothing in Earn for this long ends; the city asks again once there is something. */
export const DROP_MS = 30 * 24 * 3_600_000;

export const EARN_WATCH_COLLECTION = 'cityEarnNotes' as const;
const PREFIX = 'solana:mainnet:';

export type EarnWatchRecord = Readonly<{
  version: number;
  owner: string;
  locale: Locale;
  /** When the city last asked to watch the wallet. */
  registeredAt: string;
  /** The last read; null before the first. */
  checkedAt: string | null;
  /** The positions out of range at the last positions read; null before the first, which is taken as known. */
  out: readonly string[] | null;
  /** The loans' grades at the last read. */
  loans: Readonly<Record<string, LoanGrade>>;
  /** When a read last found anything in Earn. */
  seenAt: string;
}>;

export function earnWatchKey(owner: string): string {
  return `${PREFIX}${owner}`;
}

export function earnWatchesOf(store: GuardStore) {
  return store.versioned<EarnWatchRecord>(EARN_WATCH_COLLECTION);
}

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The city asks to watch the proven wallet: a new watch, or the language and time of one that stands. */
export async function registerEarnWatch(store: GuardStore, owner: string, locale: Locale, nowMs: number): Promise<EarnWatchRecord> {
  if (!WALLET.test(owner)) throw new TypeError('A wallet is addressed by its Solana address.');
  const at = new Date(nowMs).toISOString();
  const watches = earnWatchesOf(store);
  const key = earnWatchKey(owner);
  return withBoundedCasRetry(async () => {
    const current = await watches.get(key);
    const next: EarnWatchRecord = current
      ? { ...current, version: current.version + 1, locale, registeredAt: at, seenAt: at }
      : { version: 1, owner, locale, registeredAt: at, checkedAt: null, out: null, loans: {}, seenAt: at };
    return (await watches.compareAndSet(key, current ? current.version : null, next)) ? next : false;
  });
}

/** What one read of a wallet found; a part that could not be read is null and changes nothing. */
export type EarnWalletRead = Readonly<{
  positions: readonly RangeRead[] | null;
  stocks: Readonly<{ configs: readonly ScaledConfig[]; held: readonly StockHeld[]; exposed: readonly string[] }> | null;
  loans: readonly LoanRead[] | null;
}>;

export type EarnWatchDeps = Readonly<{
  guard: GuardStore;
  read: (owner: string) => Promise<EarnWalletRead>;
  clock: () => number;
  /** Sends the rows this pass queued (production: the monitoring delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  budgetMs?: number;
  perPass?: number;
  everyMs?: number;
}>;

export type EarnWatchReport = Readonly<{ wallets: number; checked: number; told: number; queued: number; dropped: number; failed: number; ms: number }>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);

/**
 * The note's identity: an exit and a loan's fall carry the read they were seen at — the next exit is a new note, and
 * two passes reading the same version claim one; a dividend date, a dividend added and a weekend are told for good.
 */
export function earnIdentity(owner: string, event: EarnEvent, version: number): string {
  const once = event.kind === 'range' || event.kind === 'loan' ? `:v${version}` : '';
  return `${EARN_TRIGGER_PREFIX}${owner}:${event.id}${once}`;
}

/** One event as the engine's inbox keeps it: both languages, said in the wallet's; it opens Earn in the city. */
export function earnInboxNote(owner: string, event: EarnEvent, identity: string, locale: Locale, nowMs: number): InboxRecord {
  const en = earnNoteText(event, 'en');
  const uk = earnNoteText(event, 'uk');
  const own = locale === 'uk' ? uk : en;
  return {
    id: `inb_${hash(identity)}`,
    owner,
    monitorId: `mon_${hash(`city-earn-monitor:${owner}`)}`,
    triggerId: identity,
    title: own.title,
    reason: own.line,
    context: earnSubject(event),
    href: EARN_HREF,
    cta: EARN_NOTE_WORDS[locale].cta,
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale,
    text: { en: { title: en.title, reason: en.line }, uk: { title: uk.title, reason: uk.line } },
  };
}

async function queue(guard: GuardStore, note: InboxRecord, channel: 'telegram' | 'push', nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(note.owner, note.triggerId, channel);
  const row: OutboxRecord = { id, owner: note.owner, triggerId: note.triggerId, inboxId: note.id, channel, state: 'pending', attempts: 0, nextAttemptAt: new Date(nowMs + DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(guard).insertIfAbsent(id, row)) ? id : null;
}

/** Tells one event: claimed once, the note once, its deliveries once each, as the wallet's preferences say. */
export async function tellEarn(guard: GuardStore, owner: string, event: EarnEvent, version: number, locale: Locale, nowMs: number): Promise<readonly string[] | null> {
  const identity = earnIdentity(owner, event, version);
  if (!(await claimTrigger(guard, identity, new Date(nowMs).toISOString()))) return null;
  const note = earnInboxNote(owner, event, identity, locale, nowMs);
  await inboxOf(guard).insertIfAbsent(inboxKeyOf(owner, note.id), note);
  const prefs = await readPreferences(guard, owner);
  /* Quiet hours are the delivery's to keep: it holds a row until they end. */
  const rows = [prefs.telegram ? await queue(guard, note, 'telegram', nowMs) : null, prefs.push ? await queue(guard, note, 'push', nowMs) : null];
  return rows.filter((id): id is string => id !== null);
}

/** What a read means for a watch: the events to tell and the record after them. Pure. */
export function judgeRead(record: EarnWatchRecord, read: EarnWalletRead, nowMs: number): Readonly<{ tell: EarnEvent[]; next: EarnWatchRecord; found: boolean }> {
  const tell: EarnEvent[] = [];
  let out = record.out;
  if (read.positions) {
    const range = rangeTells(new Set(record.out ?? []), read.positions);
    // The first read is known: the city told it on screen when it asked to be watched.
    if (record.out !== null) tell.push(...range.tell);
    out = range.out;
  }
  if (read.stocks) {
    tell.push(...dividendTells(read.stocks.configs, read.stocks.held, nowMs));
    const weekend = weekendTell(nowMs, read.stocks.exposed);
    if (weekend) tell.push(weekend);
  }
  let loans = record.loans;
  if (read.loans) {
    const graded = loanTells(record.loans, read.loans, weekendKey(nowMs) !== null);
    tell.push(...graded.tell);
    loans = graded.grades;
  }
  const found = (read.positions?.length ?? 0) > 0 || (read.stocks?.exposed.length ?? 0) > 0 || (read.loans?.length ?? 0) > 0;
  const at = new Date(nowMs).toISOString();
  return { tell, found, next: { ...record, version: record.version + 1, checkedAt: at, out, loans, seenAt: found ? at : record.seenAt } };
}

const checkedMs = (record: EarnWatchRecord) => (record.checkedAt === null ? 0 : Date.parse(record.checkedAt));

/** One pass: the longest unread watches first, a few per pass, each read and told; what is left waits for the next. */
export async function runEarnWatchPass(deps: EarnWatchDeps): Promise<EarnWatchReport> {
  const started = deps.clock();
  const budget = deps.budgetMs ?? PASS_BUDGET_MS;
  const every = deps.everyMs ?? EVERY_MS;
  const watches = earnWatchesOf(deps.guard);
  const all = await watches.valuesWithPrefix(PREFIX);
  const due = all
    .filter((record) => WALLET.test(record.owner) && started - checkedMs(record) >= every)
    .sort((a, b) => checkedMs(a) - checkedMs(b))
    .slice(0, deps.perPass ?? WALLETS_PER_PASS);
  const queued = new Set<string>();
  let checked = 0;
  let told = 0;
  let dropped = 0;
  let failed = 0;
  for (const record of due) {
    if (deps.clock() - started > budget) break;
    const read = await deps.read(record.owner).catch((): EarnWalletRead => ({ positions: null, stocks: null, loans: null }));
    const now = deps.clock();
    const nothingRead = read.positions === null && read.stocks === null && read.loans === null;
    if (nothingRead) failed += 1;
    const judged = judgeRead(record, read, now);
    if (!judged.found && !nothingRead && now - Date.parse(record.seenAt) > DROP_MS) {
      // Nothing in Earn for a month: the watch ends. A watch changed since it was read stays.
      const current = await watches.get(earnWatchKey(record.owner));
      if (current && current.version === record.version) {
        await watches.delete(earnWatchKey(record.owner));
        dropped += 1;
      }
      continue;
    }
    // The record first: a pass that lost the race to another reads nothing twice and tells nothing twice.
    if (!(await watches.compareAndSet(earnWatchKey(record.owner), record.version, judged.next))) continue;
    checked += 1;
    for (const event of judged.tell) {
      const rows = await tellEarn(deps.guard, record.owner, event, record.version, record.locale, now).catch(() => null);
      if (rows === null) continue;
      told += 1;
      for (const id of rows) queued.add(id);
    }
  }
  if (queued.size > 0 && deps.deliver) await deps.deliver(queued, deps.clock() + DELIVERY_HOLD_MS).catch(() => undefined);
  return { wallets: all.length, checked, told, queued: queued.size, dropped, failed, ms: deps.clock() - started };
}
