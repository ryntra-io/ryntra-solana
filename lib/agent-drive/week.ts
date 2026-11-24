import type { GuardStore } from "../guard/store.ts";
import type { BookEntry } from "../mandate/book.server.ts";
import type { AgentDay } from "../mandate/report.ts";
import { triggersOf } from "../monitoring/store.ts";
import { clockOf } from "../../city/lib/autopilot/report.ts";
import { cardsOf, type DriveCard } from "./card.ts";
import { weekIdentity, xText } from "./events.ts";
import { coinName, solPlain, solSigned, type Lang } from "./figures.ts";
import { weekNote } from "./note.ts";
import { driveSettingsOf } from "./settings.ts";
import { DRIVE_HOLD_MS, tellNote } from "./tell.ts";
import { DRIVE_WORDS } from "./words.ts";

/**
 * The agent's week: once a week, on Monday from 10:00 of the person's own clock, what her agents did over the last seven
 * days — their trades, the SOL they spent, the result after every fee as the agent's book counts it and the venue
 * prices it now (`lib/mandate/report.ts`, the same reading as the daily report), and the trades that closed with the
 * best «×». One note a week, by her ISO week; a week without a trade is passed quietly. The same summary stands in her
 * bots (`/api/v1/agent-drive/week`).
 *
 * Reads the book and writes one note. Signs, sends and trades nothing.
 */

export const WEEK_MS = 7 * 86_400_000;
/** Monday, from this hour of her day. */
export const WEEK_HOUR = 10;
export const WEEK_PER_PASS = 20;
export const WEEK_BUDGET_MS = 30_000;

export type WeekSummary = Readonly<{
  since: number;
  until: number;
  /** The agents' done trades in the week. */
  trades: number;
  /** The SOL they spent, lamports. */
  spentRaw: string;
  /** The week's result, lamports: after every fee when the book counted them; null — not read. */
  resultRaw: string | null;
  /** Whether `resultRaw` is after every fee. */
  afterFees: boolean;
  /** The trades closed in the week, and the best of them. */
  closed: number;
  best: Readonly<{ x: number; coin: DriveCard["coin"]; card: string }> | null;
}>;

/** The week of her agents from each mandate's span (`AgentDay`) and her closed trades' cards. */
export function weekSummary(days: readonly AgentDay[], cards: readonly DriveCard[], span: Readonly<{ since: number; until: number }>): WeekSummary {
  const trades = days.reduce((sum, day) => sum + day.trades, 0);
  const spent = days.reduce((sum, day) => sum + BigInt(day.spentRaw), 0n);
  const counted = days.length > 0 && days.every((day) => day.netRaw !== undefined);
  const parts = days.map((day) => (counted ? day.netRaw : day.earnedRaw));
  const result = parts.length === 0 ? 0n : parts.some((part) => part === null || part === undefined) ? null : parts.reduce((sum, part) => sum + BigInt(part!), 0n);
  const closed = cards.filter((card) => card.closedAt >= span.since && card.closedAt <= span.until);
  const best = closed.filter((card) => card.x !== null).sort((a, b) => b.x! - a.x!)[0] ?? null;
  return {
    since: span.since,
    until: span.until,
    trades,
    spentRaw: spent.toString(),
    resultRaw: result === null ? null : result.toString(),
    afterFees: counted && result !== null,
    closed: closed.length,
    best: best ? { x: best.x!, coin: best.coin, card: best.id } : null,
  };
}

/** Whether the week has anything to tell: a trade, or a trade closed. */
export const weekWorth = (week: WeekSummary): boolean => week.trades > 0 || week.closed > 0;

/** The week's two lines in one language. */
export function weekWords(week: WeekSummary, lang: Lang): Readonly<{ title: string; reason: string }> {
  const w = DRIVE_WORDS[lang];
  const title = w.week(w.trades(week.trades), week.resultRaw === null ? null : solSigned(week.resultRaw, lang));
  const parts = [w.weekSpent(solPlain(week.spentRaw, lang))];
  if (week.closed > 0) parts.push(w.weekClosed(week.closed));
  if (week.best && week.best.x > 1) parts.push(w.weekBest(xText(week.best.x, lang), coinName(week.best.coin, lang)));
  if (week.afterFees) parts.push(w.afterFees);
  return { title, reason: parts.join(" · ") };
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Her day, weekday and hour on her clock. */
export function weekClock(nowMs: number, timezone: string): Readonly<{ year: number; month: number; day: number; weekday: number; hour: number }> {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: clockOf(timezone), year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: Number(part("year")), month: Number(part("month")), day: Number(part("day")), weekday: DAYS.indexOf(part("weekday")) + 1, hour: Number(part("hour")) };
}

/** Her ISO week, `2026-W47`, of a day on her clock. */
export function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Whether her week is due now — Monday, from {@link WEEK_HOUR} of her day — and which week it is. */
export function weekDue(nowMs: number, timezone: string): Readonly<{ due: boolean; week: string }> {
  const clock = weekClock(nowMs, timezone);
  return { due: clock.weekday === 1 && clock.hour >= WEEK_HOUR, week: isoWeek(clock.year, clock.month, clock.day) };
}

/** Her mandates that traded in the span: the ones the week speaks of, at most five. */
export function weekEntries(entries: readonly BookEntry[], owner: string, since: number): readonly BookEntry[] {
  return entries
    .filter((entry) => entry.record.owner === owner && entry.trades.some((trade) => trade.status === "ok" && trade.at >= since))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
}

export type WeekDeps = Readonly<{
  store: GuardStore;
  clock: () => number;
  entries: readonly BookEntry[];
  /** One mandate's span, read as the daily report reads it; null — not read. */
  read: (entry: BookEntry, since: number, until: number) => Promise<AgentDay | null>;
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  budgetMs?: number;
  perPass?: number;
}>;

export type WeekPass = Readonly<{ owners: number; told: number; quiet: number; failed: number }>;

/** One pass: each person whose Monday hour has come hears her agents' week, once. */
export async function runWeekPass(deps: WeekDeps): Promise<WeekPass> {
  const started = deps.clock();
  const owners = [...new Set(deps.entries.filter((entry) => entry.trades.some((trade) => trade.status === "ok" && trade.at >= started - WEEK_MS)).map((entry) => entry.record.owner))];
  const queued = new Set<string>();
  let told = 0;
  let quiet = 0;
  let failed = 0;
  let asked = 0;
  for (const owner of owners) {
    if (deps.clock() - started > (deps.budgetMs ?? WEEK_BUDGET_MS) || asked >= (deps.perPass ?? WEEK_PER_PASS)) break;
    const settings = await driveSettingsOf(deps.store, owner).catch(() => null);
    if (!settings || !settings.topics.week) continue;
    const now = deps.clock();
    const { due, week } = weekDue(now, settings.timezone);
    if (!due) continue;
    const identity = weekIdentity(owner, week);
    if (await triggersOf(deps.store).get(identity)) continue;
    asked += 1;
    const span = { since: now - WEEK_MS, until: now };
    const days = await Promise.all(weekEntries(deps.entries, owner, span.since).map((entry) => deps.read(entry, span.since, span.until).catch(() => null)));
    if (days.some((day) => day === null)) {
      /* A price or the book did not answer: she stays due, and the next pass tries again. */
      failed += 1;
      continue;
    }
    const cards = await cardsOf(deps.store, owner, span.since).catch(() => [] as readonly DriveCard[]);
    const summary = weekSummary(days as AgentDay[], cards, span);
    if (!weekWorth(summary)) {
      quiet += 1;
      continue;
    }
    const note = weekNote(owner, identity, { en: weekWords(summary, "en"), uk: weekWords(summary, "uk") }, settings.locale, now);
    const rows = await tellNote(deps.store, note, settings, now).catch(() => null);
    if (rows === null) continue;
    told += 1;
    for (const row of rows) queued.add(row);
  }
  if (queued.size > 0 && deps.deliver) await deps.deliver(queued, deps.clock() + DRIVE_HOLD_MS).catch(() => undefined);
  return { owners: owners.length, told, quiet, failed };
}
