/**
 * The stops' cron pass (CITY-149): every watched stop asked about with the swap engine's quote for its exact amount,
 * judged the city's way (`stopReached`: the quote's `outAmountRaw` against the stop's `limitAmounts` line), «reached»
 * written once, and the person told — a note in the inbox (`lib/monitoring`), Telegram if the wallet's account has a
 * chat, the phone's push and the browser's push as the person's settings say. Stops past their time expire.
 *
 * One quote answers every stop of the same pair and amount. A pass cut short leaves the rest for the next one: the
 * longest unchecked go first, «reached» is a conditional write, and the note's id is the stop's, so nothing is told
 * twice. Reads the quote, writes notes. Signs, sends and trades nothing.
 */

import type { GuardStore } from "../guard/store.ts";
import { inboxKeyOf } from "../monitoring/apply.ts";
import { inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from "../monitoring/store.ts";
import type { QuoteNow } from "./api.ts";
import { inputMintOf, outputMintOf, stopReached, type EngineStop } from "./model.ts";
import { STOP_TRIGGER_PREFIX, stopHref, stopMonitorId, stopNoteId, stopNoteText, tickerOf } from "./notes.ts";
import type { StopsStore } from "./store.ts";

/** The pass stops starting new quotes after this; the cron's own limit is a minute. */
export const PASS_BUDGET_MS = 40_000;
/** Watched stops one pass asks about. */
export const DUE_PER_PASS = 300;
/** Quotes asked at once. */
export const QUOTES_AT_ONCE = 4;
/** Reached stops one pass tells. */
export const TOLD_PER_PASS = 100;
/** A delivery is held from the monitoring cron this long: this pass sends it first. */
export const DELIVERY_HOLD_MS = 90_000;

export type StopsPassDeps = Readonly<{
  stops: StopsStore;
  /** Where the notes and their deliveries are kept (the Guard store the monitoring engine reads). */
  guard: GuardStore;
  quote: QuoteNow;
  clock: () => number;
  /** Sends the rows this pass queued (production: the monitoring delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  budgetMs?: number;
}>;

export type StopsPassReport = Readonly<{ expired: number; checked: number; quotes: number; unquoted: number; reached: number; told: number; queued: number; ms: number }>;

/** The pair and amount a quote answers: stops that share it share one quote. */
const quoteKey = (stop: EngineStop) => `${inputMintOf(stop)}>${outputMintOf(stop)}:${stop.amountRaw}`;

/** The note of a reached stop, in both languages, said in the one the person set it in. */
export function stopNote(stop: EngineStop, nowMs: number): InboxRecord {
  const en = stopNoteText(stop, "en");
  const uk = stopNoteText(stop, "uk");
  const own = stop.locale === "uk" ? uk : en;
  return {
    id: stopNoteId(stop.id),
    owner: stop.owner,
    monitorId: stopMonitorId(stop.id),
    triggerId: `${STOP_TRIGGER_PREFIX}${stop.id}`,
    title: own.title,
    reason: own.reason,
    context: tickerOf(stop.base.symbol),
    href: stopHref(stop),
    cta: own.cta,
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale: stop.locale,
    text: { en: { title: en.title, reason: en.reason }, uk: { title: uk.title, reason: uk.reason } },
  };
}

async function queue(guard: GuardStore, note: InboxRecord, channel: "telegram" | "push", nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(note.owner, note.triggerId, channel);
  const row: OutboxRecord = { id, owner: note.owner, triggerId: note.triggerId, inboxId: note.id, channel, state: "pending", attempts: 0, nextAttemptAt: new Date(nowMs + DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(guard).insertIfAbsent(id, row)) ? id : null;
}

/** Tells the person of one reached stop: the note once, its deliveries once each, as their settings say. */
export async function tell(guard: GuardStore, stop: EngineStop, nowMs: number): Promise<readonly string[]> {
  const note = stopNote(stop, nowMs);
  await inboxOf(guard).insertIfAbsent(inboxKeyOf(stop.owner, note.id), note);
  const prefs = await readPreferences(guard, stop.owner);
  /* Quiet hours are the delivery's to keep: it holds a row until they end, so a stop reached at night is said in the morning. */
  const rows = [prefs.telegram ? await queue(guard, note, "telegram", nowMs) : null, prefs.push ? await queue(guard, note, "push", nowMs) : null];
  return rows.filter((id): id is string => id !== null);
}

export async function runStopsPass(deps: StopsPassDeps): Promise<StopsPassReport> {
  const started = deps.clock();
  const budget = deps.budgetMs ?? PASS_BUDGET_MS;
  const expired = await deps.stops.expire(started, 1_000);
  const due = await deps.stops.due(started, DUE_PER_PASS);

  const groups = new Map<string, EngineStop[]>();
  for (const stop of due) groups.set(quoteKey(stop), [...(groups.get(quoteKey(stop)) ?? []), stop]);
  let quotes = 0;
  let unquoted = 0;
  let reached = 0;
  const pending = [...groups.values()];
  const worker = async () => {
    for (let group = pending.shift(); group; group = pending.shift()) {
      if (deps.clock() - started > budget) {
        unquoted += group.length;
        continue;
      }
      const first = group[0]!;
      quotes += 1;
      const outRaw = await deps.quote({ inputMint: inputMintOf(first), outputMint: outputMintOf(first), amountRaw: first.amountRaw }).catch(() => null);
      if (outRaw === null) {
        unquoted += group.length;
        continue;
      }
      for (const stop of group) {
        if (stopReached(stop, outRaw) && (await deps.stops.reach(stop.id, outRaw, deps.clock()))) reached += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUOTES_AT_ONCE, pending.length) }, worker));

  /* Every reached stop not told yet — this pass's and any a pass before it reached and could not tell. */
  const queued = new Set<string>();
  let told = 0;
  for (const stop of await deps.stops.untold(TOLD_PER_PASS)) {
    const now = deps.clock();
    for (const id of await tell(deps.guard, stop, now)) queued.add(id);
    await deps.stops.told(stop.id, now);
    told += 1;
  }
  if (queued.size > 0 && deps.deliver) await deps.deliver(queued, deps.clock() + DELIVERY_HOLD_MS).catch(() => undefined);
  return { expired, checked: due.length, quotes, unquoted, reached, told, queued: queued.size, ms: deps.clock() - started };
}
