/**
 * «Ранковий огляд» in Telegram (AI-10): the whole brief of a wallet's day,
 * read from its record when the monitoring cron sends the note — the inbox
 * keeps one block, Telegram carries every part with its lines' sources and
 * times. Null when the record is gone (the note's own words are sent then).
 */

import type { GuardStore } from "../../guard/store.ts";
import type { BriefLocale } from "./lines.ts";
import { readBrief } from "./store.ts";
import { briefNoteText } from "./words.ts";

export async function briefTelegramText(store: GuardStore, owner: string, day: string, locale: BriefLocale): Promise<string | null> {
  const record = await readBrief(store, owner, day);
  return record ? briefNoteText(record, locale) : null;
}
