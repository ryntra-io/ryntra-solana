/**
 * The IPO and conversion watch in Monitoring — Ryntra does not let a token burn.
 *
 * A wallet that holds a token whose issuer opened a swap window is told: the
 * day Ryntra first sees it hold the token, then 90, 30, 7 and 1 days before
 * the issuer's deadline — never more than one note a day about one token,
 * never a missed one caught up (`conversion-watch.ts`). One note in the inbox,
 * which the bell and Home's «що потребує уваги» read, and one Telegram
 * message or push where the wallet's preferences carry them, each claimed
 * once per wallet, token and stage, so a retried pass never sends a second.
 * The note's one action opens the swap's fresh Review on the token's page; it
 * is never permission to trade — only the holder's signature swaps.
 *
 * What a wallet holds is read from the chain — never from a page, a request
 * or History — and only for the tokens watched now, at most once in a while
 * per wallet: every few hours for the tick, every couple of minutes while the
 * person's own app reads its notes, so the note of a token just bought
 * arrives while they look. A read that fails says nothing — no note, and the
 * next pass reads again; a wallet that holds none of the token is reminded of
 * nothing.
 *
 * Which wallets: every wallet Ryntra keeps anything for — a monitor, a plan,
 * an autoinvest rule, a device, preferences — and every wallet this watch has
 * read before (its own app read its notes). Nothing here reads a quote,
 * builds an order or touches a wallet.
 */

import { createHash } from "node:crypto";

import { listAllRuleRecords } from "../autoinvest/store.ts";
import type { GuardStore } from "../guard/store.ts";
import { isWatched, reminderDue, reminderIdentity, reminderWords, windowState, type ConversionStage, type WatchedEvent } from "../stocks/conversion-watch.ts";
import type { LifecycleEvent } from "../stocks/instrument.ts";
import { noticeFinding, noticeOnPage } from "../stocks/issuer-notices.ts";
import { PRESTOCKS_PAGES } from "../stocks/issuer-pages.ts";
import { LIFECYCLE_EVENTS, lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { enqueue, inboxKeyOf } from "./apply.ts";
import {
  claimTrigger,
  devicesOf,
  inboxOf,
  issuerWatchKey,
  issuerWatchOf,
  issuerWatchPrefix,
  listMonitors,
  newInboxId,
  issuerNoticeChecksOf,
  preferencesOf,
  readPreferences,
  type InboxRecord,
  type IssuerNoticeCheckRecord,
  type IssuerWatchRecord,
} from "./store.ts";

/** How a wallet's balance of the watched tokens is read — raw units per mint, null where the read failed. Injected, so tests run without the chain. */
export type HeldReader = (owner: string, mints: readonly string[]) => Promise<ReadonlyMap<string, bigint | null>>;

/** The tick reads a wallet's balance at most this often: the reminders are a day's grain. */
export const TICK_EVERY_MS = 6 * 60 * 60_000;
/** While the person's own app reads its notes: a token just bought is seen within a couple of minutes. */
export const READ_EVERY_MS = 2 * 60_000;
/** The most balance reads one tick makes; the rest wait five minutes for the next. */
export const MAX_READS_PER_TICK = 20;
/** The time one tick gives the watch's reads — the cron route has a minute for everything, deliveries included. */
export const TICK_BUDGET_MS = 20_000;

export type IssuerCheckDeps = Readonly<{
  readHeld: HeldReader;
  /** The least time between two reads of one wallet's balance. */
  everyMs: number;
  /** The language the person's own app reads in, when the check comes from it; the record keeps the last one known. */
  locale?: "en" | "uk";
  /** The registry, for tests; production reads `LIFECYCLE_EVENTS`. */
  events?: readonly LifecycleEvent[];
}>;

/** The events the watch speaks about now: a swap window with a stated cut-off, open. */
export function openWatchedEvents(nowMs: number, events: readonly LifecycleEvent[] = LIFECYCLE_EVENTS): WatchedEvent[] {
  return events.filter(isWatched).filter((event) => windowState(event, nowMs) === "open");
}

/** The monitor id an issuer's notes carry — the contract's `mon_` shape, derived from the wallet and the token; an event is not a monitor and no monitor has it. */
export function issuerMonitorId(owner: string, mint: string): string {
  return `mon_${createHash("sha256").update(`issuer-event:${owner}:${mint}`).digest("hex").slice(0, 24)}`;
}

/** Write one reminder: the note, then its deliveries. Idempotent by the wallet, the token and the stage. */
export async function writeIssuerNote(store: GuardStore, owner: string, event: WatchedEvent, stage: ConversionStage, locale: "en" | "uk", nowMs: number, first: boolean): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  const identity = reminderIdentity(owner, event.mint, stage);
  if (!(await claimTrigger(store, identity, at))) return false;
  const words = reminderWords(event, stage, nowMs, first);
  const own = words[locale];
  const inboxId = newInboxId();
  const note: InboxRecord = {
    id: inboxId,
    owner,
    monitorId: issuerMonitorId(owner, event.mint),
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: event.watch.company,
    href: `/app/alerts/open?n=${inboxId}`,
    cta: own.cta,
    paper: false,
    unread: true,
    createdAt: at,
    locale,
    subject: { kind: "issuer-event", id: event.mint },
    text: { en: { title: words.en.title, reason: words.en.reason }, uk: { title: words.uk.title, reason: words.uk.reason } },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(owner, inboxId), note);
  const prefs = await readPreferences(store, owner);
  if (prefs.telegram) await enqueue(store, owner, identity, inboxId, "telegram", at);
  if (prefs.push) await enqueue(store, owner, identity, inboxId, "push", at);
  return true;
}

export type IssuerCheck = Readonly<{ read: boolean; reminded: number }>;

/**
 * One wallet: read its balance of the watched tokens whose last read is older
 * than `everyMs`, keep what was read, and remind of the stage that stands
 * where the wallet holds the token and has not had it.
 */
export async function checkIssuerEvents(store: GuardStore, owner: string, nowMs: number, deps: IssuerCheckDeps): Promise<IssuerCheck> {
  const events = openWatchedEvents(nowMs, deps.events);
  if (events.length === 0) return { read: false, reminded: 0 };
  const watch = issuerWatchOf(store);
  const records = new Map((await watch.valuesWithPrefix(issuerWatchPrefix(owner))).map((record) => [record.mint, record]));
  const due = events.filter((event) => {
    const previous = records.get(event.mint);
    return !previous || nowMs - Date.parse(previous.checkedAt) >= deps.everyMs;
  });
  if (due.length === 0) return { read: false, reminded: 0 };
  const held = await deps.readHeld(owner, due.map((event) => event.mint));
  const at = new Date(nowMs).toISOString();
  let reminded = 0;
  for (const event of due) {
    const previous = records.get(event.mint);
    const raw = held.get(event.mint);
    const locale = deps.locale ?? previous?.locale ?? "en";
    let sent = previous?.sent ?? [];
    if (typeof raw === "bigint" && raw > 0n) {
      const stage = reminderDue(event, sent.map((entry) => ({ stage: entry.stage, atMs: Date.parse(entry.at) })), nowMs);
      if (stage) {
        if (await writeIssuerNote(store, owner, event, stage, locale, nowMs, sent.length === 0)) reminded += 1;
        /* Kept as sent either way: a claim lost to another pass means that pass wrote the note. */
        sent = [...sent, { stage, at }];
      }
    }
    const record: IssuerWatchRecord = { owner, mint: event.mint, checkedAt: at, heldRaw: typeof raw === "bigint" ? raw.toString() : null, locale, sent };
    await watch.set(issuerWatchKey(owner, event.mint), record);
  }
  return { read: true, reminded };
}

/** Every wallet Ryntra keeps anything for, and every wallet this watch has read before. */
export async function knownWallets(store: GuardStore): Promise<readonly string[]> {
  const owners = new Set<string>();
  const add = (owner: unknown) => {
    if (typeof owner === "string" && owner.length >= 32 && owner.length <= 44) owners.add(owner);
  };
  for (const row of await listMonitors(store)) add(row.owner);
  for (const collection of ["tradingPlans", "predictionPlans"] as const) {
    for (const row of await store.versioned<{ version: number; owner: string }>(collection).valuesWithPrefix("solana:mainnet:")) add(row.owner);
  }
  for (const row of await listAllRuleRecords(store)) add(row.owner);
  for (const row of await devicesOf(store).valuesWithPrefix("solana:mainnet:")) add(row.owner);
  for (const row of await preferencesOf(store).valuesWithPrefix("solana:mainnet:")) add(row.owner);
  for (const row of await issuerWatchOf(store).valuesWithPrefix(issuerWatchPrefix())) add(row.owner);
  return [...owners].sort();
}

export type IssuerTick = Readonly<{ wallets: number; read: number; reminded: number; failed: number }>;

/**
 * One pass for the monitoring tick: every known wallet whose last read is
 * older than `TICK_EVERY_MS`, at most `MAX_READS_PER_TICK` reads — the rest on
 * the next pass. A wallet that fails is left for the next pass and never
 * stops the others.
 */
export async function tickIssuerEvents(
  store: GuardStore,
  nowMs: number,
  deps: Readonly<{ readHeld: HeldReader; events?: readonly LifecycleEvent[]; maxReads?: number; everyMs?: number; budgetMs?: number }>,
): Promise<IssuerTick> {
  if (openWatchedEvents(nowMs, deps.events).length === 0) return { wallets: 0, read: 0, reminded: 0, failed: 0 };
  const started = Date.now();
  const wallets = await knownWallets(store);
  const cap = deps.maxReads ?? MAX_READS_PER_TICK;
  const budget = deps.budgetMs ?? TICK_BUDGET_MS;
  let read = 0;
  let reminded = 0;
  let failed = 0;
  for (const owner of wallets) {
    /* A slow chain never eats the minute the deliveries need: what is left waits for the next pass. */
    if (read >= cap || Date.now() - started >= budget) break;
    try {
      const check = await checkIssuerEvents(store, owner, nowMs, { readHeld: deps.readHeld, everyMs: deps.everyMs ?? TICK_EVERY_MS, events: deps.events });
      if (check.read) read += 1;
      reminded += check.reminded;
    } catch {
      failed += 1;
    }
  }
  return { wallets: wallets.length, read, reminded, failed };
}

/* ------------------------------------------------ the issuer's pages, daily */

/** How one product page is read — its HTML, or null when it could not be. Injected, so tests run without the network. */
export type PageFetcher = (url: string) => Promise<string | null>;

const PAGE_TIMEOUT_MS = 10_000;
const PAGE_MAX_CHARS = 2_000_000;
/** A day whose read left a page unreadable is read again, at most this often. */
const PAGES_RETRY_MS = 60 * 60_000;

/** The production page reader: a plain GET with a timeout and a size bound; any failure is null. */
export const fetchIssuerPage: PageFetcher = async (url) => {
  try {
    const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; Ryntra issuer watch)" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return null;
    const html = await response.text();
    return html.length > PAGE_MAX_CHARS ? html.slice(0, PAGE_MAX_CHARS) : html;
  } catch {
    return null;
  }
};

/**
 * Once a UTC day, from the monitoring tick: every product page the registry
 * is kept against (`PRESTOCKS_PAGES`) read — all at once, each within ten
 * seconds — and its notice held against the
 * registry's event for the same mint (`issuer-notices.ts`). The day's
 * findings are kept (`issuerNoticeChecks`); anything but «agrees» goes to the
 * server's error log for a person to verify and write into the registry —
 * nothing a holder is told changes here. A day with a page left unreadable is
 * read again within the hour; a finished day is not read twice.
 */
export async function checkIssuerPages(store: GuardStore, nowMs: number, deps: Readonly<{ fetchPage?: PageFetcher; log?: (line: string) => void }> = {}): Promise<IssuerNoticeCheckRecord | null> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const checks = issuerNoticeChecksOf(store);
  const earlier = await checks.get(day);
  if (earlier) {
    const unreadable = earlier.pages.some((page) => page.finding === "unreadable");
    if (!unreadable || nowMs - Date.parse(earlier.checkedAt) < PAGES_RETRY_MS) return null;
  }
  const fetchPage = deps.fetchPage ?? fetchIssuerPage;
  const pages: IssuerNoticeCheckRecord["pages"][number][] = await Promise.all(
    PRESTOCKS_PAGES.map(async (page) => {
      const html = await fetchPage(page.url).catch(() => null);
      const notice = html === null ? "unreadable" : noticeOnPage(html);
      const finding = noticeFinding(notice, lifecycleEventFor(page.mint));
      const read = notice !== null && notice !== "unreadable" ? notice : null;
      return { symbol: page.symbol, mint: page.mint, url: page.url, finding, notice: read?.text ?? null, deadline: read?.deadline ?? null };
    }),
  );
  const record: IssuerNoticeCheckRecord = { day, checkedAt: new Date(nowMs).toISOString(), pages };
  await checks.set(day, record);
  const drift = pages.filter((page) => page.finding !== "agrees" && page.finding !== "unreadable");
  if (drift.length > 0) (deps.log ?? console.error)(`[issuer-watch] the issuer's pages and the registry of events differ — verify and write lib/stocks/lifecycle-events.ts: ${JSON.stringify(drift)}`);
  return record;
}
