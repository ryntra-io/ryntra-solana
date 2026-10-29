/**
 * The notification channel of Ryntra Predictions — the one place a note is
 * written, grouped, held back or sent.
 *
 * It is deliberately told nothing about markets: a note is a kind, a grouping
 * identity and a few figures, and the caller hands in the words and the
 * transports. Settlement (PM-05) is its first caller; market watching is the
 * second, and takes the same module rather than a second one of its own.
 *
 * What it holds to, whatever the caller:
 *
 * - **One note per thing that happened.** A note is written under its own
 *   identity with `insertIfAbsent`: a pass that ran twice, or two instances
 *   at once, leave one note. The same identity arriving again inside the
 *   grouping window raises that note's count instead of making a second one
 *   («групування однакових»).
 * - **The quiet hour.** Inside the person's quiet window nothing leaves: the
 *   note is recorded and its channels wait until the window ends. A price at
 *   02:14 is not news to be sent at 02:14.
 * - **A ceiling per hour.** At most `perHour` notes of a wallet reach the
 *   channels in one clock hour; the rest stay in the list, marked.
 * - **One touch stops it.** `on: false` and no channel is used again until the
 *   person turns it back on. Notes are still written, so the list in the app
 *   stays the record.
 * - **The decision is taken once.** What became of a note's delivery is
 *   written on the note; a pass retried after a crash reads it and does not
 *   send twice.
 *
 * Nothing here signs, trades or reads a key, and no note is permission to do
 * anything. The rows live in the watchlists' collection under keys of their
 * own — the store's list of collections is not the line's to extend.
 *
 * The shapes and the decisions that need no store are in `notes.ts`, which
 * a page may read; this module is the store side.
 *
 * Server only.
 */

import { createHash } from "node:crypto";

import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";

import { NOTES_KEPT, NOTE_GROUP_MS, defaultPrefs, deliveryDecision, type Note, type NoteDelivery, type NoteDraft, type NoteWords, type NotifyPrefs, type NotifyTransports, type PrefsChange, mergePrefs } from "./notes.ts";

export * from "./notes.ts";

export const NOTIFY_COLLECTION = "predictionWatchlists" as const;

const PREFS_PREFIX = "notify:prefs:";
const NOTE_PREFIX = "notify:note:";
const RATE_PREFIX = "notify:rate:";

type RateRow = Readonly<{ version: number; wallet: string; hour: string; count: number }>;

/* One collection, three shapes under keys of their own: the store's list of collections is not the line's to extend. */
const prefsRows = (store: GuardStore) => store.versioned<NotifyPrefs>(NOTIFY_COLLECTION);
const noteRows = (store: GuardStore) => store.versioned<Note>(NOTIFY_COLLECTION);
const rateRows = (store: GuardStore) => store.versioned<RateRow>(NOTIFY_COLLECTION);

const shortId = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);
const prefsKey = (wallet: string) => `${PREFS_PREFIX}${wallet}`;
const noteKey = (wallet: string, id: string) => `${NOTE_PREFIX}${wallet}:${id}`;
const rateKey = (wallet: string, hour: string) => `${RATE_PREFIX}${wallet}:${hour}`;
const hourOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 13);

/** The note's id: the identity as given, reduced to a key the store can hold whatever the caller wrote. */
export function noteIdOf(identity: string): string {
  return shortId(identity);
}

/* ------------------------------------------------------------------ preferences */

function isPrefs(row: unknown): row is NotifyPrefs {
  return typeof row === "object" && row !== null && typeof (row as NotifyPrefs).on === "boolean" && Array.isArray((row as NotifyPrefs).channels);
}

export async function readPrefs(store: GuardStore, wallet: string, nowMs: number = Date.now()): Promise<NotifyPrefs> {
  const row = await prefsRows(store).get(prefsKey(wallet)).catch(() => undefined);
  return isPrefs(row) && row.wallet === wallet ? row : defaultPrefs(wallet, nowMs);
}

export async function writePrefs(store: GuardStore, wallet: string, change: PrefsChange, nowMs: number = Date.now()): Promise<NotifyPrefs> {
  const key = prefsKey(wallet);
  const collection = prefsRows(store);
  try {
    const written = await withBoundedCasRetry(async () => {
      const found = await collection.get(key);
      const current = isPrefs(found) && found.wallet === wallet ? found : defaultPrefs(wallet, nowMs);
      const next: NotifyPrefs = { ...mergePrefs(current, change, nowMs), version: current.version + 1 };
      return (await collection.compareAndSet(key, isPrefs(found) ? found.version : null, next)) ? next : false;
    });
    if (written) return written;
  } catch {
    /* The store would not take the change: the person is answered with what it still holds. */
  }
  return readPrefs(store, wallet, nowMs);
}

/* ------------------------------------------------------------------ notes */

function isNote(row: unknown): row is Note {
  return typeof row === "object" && row !== null && typeof (row as Note).kind === "string" && typeof (row as Note).count === "number";
}

export async function listNotes(store: GuardStore, wallet: string, limit = 30): Promise<readonly Note[]> {
  const found: readonly Note[] = await noteRows(store).valuesWithPrefix(`${NOTE_PREFIX}${wallet}:`).catch(() => []);
  return found
    .filter((row) => isNote(row) && row.wallet === wallet)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

/** Take one of the hour's deliveries; false once the hour's ceiling is reached. */
async function takeHour(store: GuardStore, wallet: string, nowMs: number, limit: number): Promise<boolean> {
  const key = rateKey(wallet, hourOf(nowMs));
  const collection = rateRows(store);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = await collection.get(key).catch(() => undefined);
    const current = found && typeof found.count === "number" ? found : null;
    const count = current?.count ?? 0;
    if (count >= limit) return false;
    const next: RateRow = { version: (current?.version ?? 0) + 1, wallet, hour: hourOf(nowMs), count: count + 1 };
    if (await collection.compareAndSet(key, current?.version ?? null, next).catch(() => false)) return true;
  }
  /* A counter that kept changing under us: the ceiling is a ceiling, not a reason to lose a note. */
  return true;
}

export type NoteOutcome = Readonly<{ note: Note; fresh: boolean }>;

/**
 * Write one note, or raise the count of the one that is already there.
 *
 * A note is only ever created once per identity. The same thing happening
 * again inside the grouping window raises its count and moves it to the top;
 * past the window it starts a new note, because it is news again. A draft
 * marked `once` is a standing fact and is only ever said the first time.
 */
export async function note(store: GuardStore, wallet: string, draft: NoteDraft, nowMs: number = Date.now()): Promise<NoteOutcome> {
  const collection = noteRows(store);
  const id = noteIdOf(`${wallet}:${draft.identity}`);
  const key = noteKey(wallet, id);
  const stamp = new Date(nowMs).toISOString();
  const fresh: Note = {
    version: 1,
    wallet,
    id,
    kind: draft.kind,
    facts: draft.facts ?? {},
    href: draft.href,
    paper: draft.paper ?? false,
    count: 1,
    delivery: null,
    deliverAfter: null,
    readAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (await collection.insertIfAbsent(key, fresh).catch(() => false)) return { note: fresh, fresh: true };
  if (draft.once) {
    /* Already said: a standing fact is not news again, however many passes read it. */
    const held = await collection.get(key).catch(() => undefined);
    if (isNote(held)) return { note: held, fresh: false };
  }
  try {
    const raised = await withBoundedCasRetry(async () => {
      const found = await collection.get(key);
      if (!isNote(found)) return fresh;
      /* Past the grouping window the same thing is news again: the note starts over, undelivered. */
      const stale = nowMs - Date.parse(found.createdAt) >= NOTE_GROUP_MS;
      const next: Note = stale
        ? { ...fresh, version: found.version + 1 }
        : { ...found, facts: draft.facts ?? found.facts, count: found.count + 1, updatedAt: stamp, version: found.version + 1 };
      return (await collection.compareAndSet(key, found.version, next)) ? next : false;
    });
    return { note: raised, fresh: raised.delivery === null && raised.count === 1 };
  } catch {
    const found = await collection.get(key).catch(() => null);
    return { note: isNote(found) ? found : fresh, fresh: false };
  }
}

async function patchNote(store: GuardStore, wallet: string, id: string, patch: (current: Note) => Partial<Note>, nowMs: number): Promise<Note | null> {
  const collection = noteRows(store);
  const key = noteKey(wallet, id);
  try {
    return await withBoundedCasRetry(async () => {
      const found = await collection.get(key);
      if (!isNote(found)) return null as never;
      const next: Note = { ...found, ...patch(found), version: found.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await collection.compareAndSet(key, found.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

export type DeliverTally = Readonly<{ sent: number; quiet: number; capped: number; off: number; noChannel: number; failed: number }>;

const EMPTY: DeliverTally = { sent: 0, quiet: 0, capped: 0, off: 0, noChannel: 0, failed: 0 };

/**
 * Send what is due for one wallet: every note whose delivery is not decided
 * yet, and every note the quiet hour held back whose window has passed.
 *
 * The decision is written on the note before a transport is called, so a
 * crash between the two never sends twice; a transport that failed leaves
 * `failed` and is not tried again by itself — the note is in the list, and
 * the next thing that happens carries its own.
 */
export async function deliverNotes(
  store: GuardStore,
  wallet: string,
  deps: Readonly<{ transports: NotifyTransports; words: (note: Note) => NoteWords; prefs?: NotifyPrefs }>,
  nowMs: number = Date.now(),
): Promise<DeliverTally> {
  const prefs = deps.prefs ?? (await readPrefs(store, wallet, nowMs));
  const pending = (await listNotes(store, wallet, NOTES_KEPT)).filter((n) => n.delivery === null || (n.delivery === "quiet" && n.deliverAfter !== null && Date.parse(n.deliverAfter) <= nowMs));
  const tally = { ...EMPTY };
  for (const row of pending) {
    const { decision, until } = deliveryDecision(prefs, nowMs);
    if (decision !== "send") {
      await patchNote(store, wallet, row.id, () => ({ delivery: decision, deliverAfter: until === null ? null : new Date(until).toISOString() }), nowMs);
      if (decision === "quiet") tally.quiet += 1;
      else if (decision === "off") tally.off += 1;
      else tally.noChannel += 1;
      continue;
    }
    if (!(await takeHour(store, wallet, nowMs, prefs.perHour))) {
      await patchNote(store, wallet, row.id, () => ({ delivery: "capped", deliverAfter: null }), nowMs);
      tally.capped += 1;
      continue;
    }
    /* Claimed before anything leaves: `failed` is overwritten below only by what the transports answer. */
    const claimed = await patchNote(store, wallet, row.id, () => ({ delivery: "failed", deliverAfter: null }), nowMs);
    if (!claimed) {
      tally.failed += 1;
      continue;
    }
    const words = deps.words(claimed);
    const outcomes = await Promise.all([
      prefs.channels.includes("webpush") && deps.transports.webpush ? deps.transports.webpush(wallet, nowMs).catch((): "failed" => "failed") : Promise.resolve<"none">("none"),
      prefs.channels.includes("telegram") && deps.transports.telegram ? deps.transports.telegram(wallet, words, claimed.href).catch((): "failed" => "failed") : Promise.resolve<"none">("none"),
    ]);
    const delivery: NoteDelivery = outcomes.includes("sent") ? "sent" : outcomes.every((o) => o === "none") ? "no_channel" : "failed";
    await patchNote(store, wallet, row.id, () => ({ delivery }), nowMs);
    if (delivery === "sent") tally.sent += 1;
    else if (delivery === "no_channel") tally.noChannel += 1;
    else tally.failed += 1;
  }
  return tally;
}

/** Mark notes read; with no ids, every note of the wallet. */
export async function markRead(store: GuardStore, wallet: string, ids: readonly string[] | null, nowMs: number = Date.now()): Promise<number> {
  const wanted = ids === null ? null : new Set(ids);
  let marked = 0;
  for (const row of await listNotes(store, wallet, NOTES_KEPT)) {
    if (row.readAt !== null || (wanted && !wanted.has(row.id))) continue;
    if (await patchNote(store, wallet, row.id, () => ({ readAt: new Date(nowMs).toISOString() }), nowMs)) marked += 1;
  }
  return marked;
}

/** The notes past what is kept, and the hour counters older than two hours, go. */
export async function pruneNotes(store: GuardStore, wallet: string, nowMs: number = Date.now()): Promise<void> {
  const all = await listNotes(store, wallet, Number.MAX_SAFE_INTEGER);
  for (const row of all.slice(NOTES_KEPT)) await noteRows(store).delete(noteKey(wallet, row.id)).catch(() => undefined);
  const cut = hourOf(nowMs - 2 * 3_600_000);
  const rates: readonly RateRow[] = await rateRows(store).valuesWithPrefix(`${RATE_PREFIX}${wallet}:`).catch(() => []);
  for (const rate of rates) {
    if (typeof rate.hour === "string" && rate.hour < cut) await rateRows(store).delete(rateKey(wallet, rate.hour)).catch(() => undefined);
  }
}
