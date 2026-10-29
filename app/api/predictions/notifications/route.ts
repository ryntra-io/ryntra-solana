import { z } from "zod";

import { predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { predictionsLocale } from "@/lib/predictions/locale.server";
import { listNotes, markRead, readPrefs, writePrefs, NOTE_CHANNELS, NOTES_PER_HOUR_MAX, NOTES_PER_HOUR_MIN, type NoteChannel } from "@/lib/predictions/notify/channel";
import { predictionNoteWords } from "@/lib/predictions/notify/words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const Body = z
  .object({
    /** The one touch: false, and no note leaves by any channel until it is true again. */
    on: z.boolean().optional(),
    channels: z.array(z.enum([...NOTE_CHANNELS] as [NoteChannel, ...NoteChannel[]])).max(NOTE_CHANNELS.length).optional(),
    /** The quiet window in the person's own timezone; null clears it. */
    quietHours: z.union([z.object({ start: Clock, end: Clock, timezone: z.string().min(1).max(64) }).strict(), z.null()]).optional(),
    perHour: z.number().int().min(NOTES_PER_HOUR_MIN).max(NOTES_PER_HOUR_MAX).optional(),
    /** Note ids to mark read, or `true` for every one of them. */
    read: z.union([z.array(z.string().regex(/^[0-9a-f]{6,64}$/)).max(60), z.literal(true)]).optional(),
  })
  .strict();

/** The notes of the wallet with their words in the person's language, and how they are set to arrive. */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const locale = await predictionsLocale();
  const [notes, prefs] = await Promise.all([listNotes(actor.store, actor.wallet), readPrefs(actor.store, actor.wallet)]);
  return predictionJson({ wallet: actor.wallet, prefs, notes: notes.map((note) => ({ ...note, words: predictionNoteWords(note, locale) })) });
}

/** How the person wants to be told — and *stop* in one touch — and which notes they have read. */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const { read: markAsRead, ...change } = read.body;
  if (markAsRead !== undefined) await markRead(actor.store, actor.wallet, markAsRead === true ? null : markAsRead);
  const prefs = Object.keys(change).length > 0 ? await writePrefs(actor.store, actor.wallet, change) : await readPrefs(actor.store, actor.wallet);
  const locale = await predictionsLocale();
  const notes = await listNotes(actor.store, actor.wallet);
  return predictionJson({ wallet: actor.wallet, prefs, notes: notes.map((note) => ({ ...note, words: predictionNoteWords(note, locale) })) });
}
