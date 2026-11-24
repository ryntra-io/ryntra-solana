import type { GuardStore } from "../guard/store.ts";
import { inboxKeyOf } from "../monitoring/apply.ts";
import { claimTrigger, inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from "../monitoring/store.ts";
import { cardOf, keepCard, shareWorthy } from "./card.ts";
import { driveIdentity, DriveEventSchema, topicOf, type DriveEvent } from "./events.ts";
import { driveNote } from "./note.ts";
import { driveSettingsOf, type DriveSettings } from "./settings.ts";

/**
 * Tells one drive event at once — the handler every seller of the agent's moves calls: the watch over the agent's book
 * (`./watch.ts`) for bought, paused and stopped, and a sale for sold. In order:
 *
 * 1. the event is checked against its shape (`DriveEventSchema`) — anything else tells nothing;
 * 2. a closed trade keeps its «×» card first (`./card.ts`), whether or not she hears of it;
 * 3. her settings (`./settings.ts`) — a kind she turned off is kept quiet;
 * 4. the event's identity is claimed in the engine's triggers — a second telling of the same move finds it claimed;
 * 5. one note in the engine's inbox, one delivery per channel her settings and Ryntra's both allow — Telegram, the
 *    phone's push (the app's and the browser's) — sent at once through the engine's delivery, which keeps her quiet
 *    hours and retries what did not go.
 *
 * Writes notes and a card. Signs, sends and trades nothing; holds no key.
 */

/** A delivery is held from the engine's own pass this long: the telling sends it first, at once. */
export const DRIVE_HOLD_MS = 90_000;

export type TellDeps = Readonly<{
  clock?: () => number;
  /** Sends the rows this telling queued, at once (production: the engine's delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  /** Her settings, when the caller has read them already. */
  settings?: DriveSettings;
}>;

export type TellResult =
  | Readonly<{ told: true; rows: readonly string[]; card: string | null }>
  | Readonly<{ told: false; why: "invalid" | "muted" | "told-before"; card: string | null }>;

async function queue(store: GuardStore, note: InboxRecord, channel: "telegram" | "push", nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(note.owner, note.triggerId, channel);
  const row: OutboxRecord = { id, owner: note.owner, triggerId: note.triggerId, inboxId: note.id, channel, state: "pending", attempts: 0, nextAttemptAt: new Date(nowMs + DRIVE_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(store).insertIfAbsent(id, row)) ? id : null;
}

/**
 * One note, claimed once by its identity, written in her inbox and queued to each channel she allows; the rows queued.
 * Null — the identity was claimed before.
 */
export async function tellNote(store: GuardStore, note: InboxRecord, settings: Pick<DriveSettings, "telegram" | "push">, nowMs: number): Promise<readonly string[] | null> {
  if (!(await claimTrigger(store, note.triggerId, new Date(nowMs).toISOString()))) return null;
  await inboxOf(store).insertIfAbsent(inboxKeyOf(note.owner, note.id), note);
  const prefs = await readPreferences(store, note.owner);
  /* Quiet hours are the delivery's to keep: it holds a row until they end. */
  const rows = [settings.telegram && prefs.telegram ? await queue(store, note, "telegram", nowMs) : null, settings.push && prefs.push ? await queue(store, note, "push", nowMs) : null];
  return rows.filter((id): id is string => id !== null);
}

/** Tells one event: see the file's head. `mark` — the watch's step that saw a state change (its identity). */
export async function tellDrive(store: GuardStore, input: DriveEvent | unknown, deps: TellDeps = {}, mark?: number): Promise<TellResult> {
  const parsed = DriveEventSchema.safeParse(input);
  if (!parsed.success) return { told: false, why: "invalid", card: null };
  const event = parsed.data;
  const now = (deps.clock ?? Date.now)();
  const settings = deps.settings ?? (await driveSettingsOf(store, event.owner));
  const card = event.kind === "sold" ? await keepCard(store, cardOf(event, settings.locale, now)) : null;
  const cardId = card?.id ?? null;
  if (!settings.topics[topicOf(event.kind)]) return { told: false, why: "muted", card: cardId };
  const identity = driveIdentity(event, mark);
  const note = driveNote(event, identity, settings.locale, now, card && shareWorthy(card) ? card.id : null);
  const rows = await tellNote(store, note, settings, now);
  if (rows === null) return { told: false, why: "told-before", card: cardId };
  if (rows.length > 0 && deps.deliver) await deps.deliver(new Set(rows), now + DRIVE_HOLD_MS).catch(() => undefined);
  return { told: true, rows, card: cardId };
}
