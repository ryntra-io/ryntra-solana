/**
 * «Ранковий огляд» as the person's page reads and writes it (AI-10): the
 * settings, when the next brief comes, where it goes and the latest one — the
 * contract's `AssistantBriefResponse`. The pass that makes briefs is
 * `run.ts`; this reads what it made and writes only the person's own
 * settings.
 */

import type { AssistantBrief, AssistantBriefResponse, AssistantBriefUpdate } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { readPreferences } from "../../monitoring/store.ts";
import { lineSource, type BriefLine, type BriefLocale } from "./lines.ts";
import { BRIEF_PRICE_CREDITS } from "./run.ts";
import { BRIEF_DEFAULT_TIME, BRIEF_DEFAULT_ZONE, isBriefTime, isZone, nextBriefAt, timeIsQuiet } from "./schedule.ts";
import { latestBrief, readBrief, readSettings, writeSettings, type BriefRecord, type BriefSettings } from "./store.ts";
import { briefTitle, marketUnreadLine, partTitle, personalNote } from "./words.ts";

function lineFor(line: BriefLine, locale: BriefLocale) {
  return { kind: line.kind, mark: line.mark, text: locale === "uk" ? line.uk : line.en, source: lineSource(line, locale), observedAt: line.observedAt, href: line.href };
}

/** A brief as the reader reads it, in the language they read the page in — the lines in either, the words in the brief's own. */
export function briefView(record: BriefRecord, locale: BriefLocale): AssistantBrief {
  const personalWords = record.personal?.words && record.locale === locale ? record.personal.words : [];
  return {
    day: record.day,
    title: briefTitle(record.day, locale),
    market: { title: partTitle("market", locale), words: record.market.words?.[locale] ?? [], lines: record.market.lines.map((line) => lineFor(line, locale)), note: record.market.lines.length === 0 ? marketUnreadLine(locale) : null },
    personal: {
      title: partTitle("personal", locale),
      words: personalWords,
      lines: (record.personal?.lines ?? []).map((line) => lineFor(line, locale)),
      state: record.personalState,
      note: personalNote(record, locale),
    },
    deliveredAt: record.updatedAt,
  };
}

/** `day` (a note's link) opens that day's brief when it was delivered; otherwise the latest. */
export async function readBriefSurface(store: GuardStore, owner: string, nowMs: number, locale: BriefLocale, day: string | null = null): Promise<AssistantBriefResponse> {
  const settings = await readSettings(store, owner);
  const prefs = await readPreferences(store, owner);
  const newest = await latestBrief(store, owner);
  const asked = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? await readBrief(store, owner, day) : null;
  const latest = asked?.state === "delivered" ? asked : newest;
  const clock = { time: settings?.time ?? BRIEF_DEFAULT_TIME, zone: settings?.zone ?? BRIEF_DEFAULT_ZONE };
  const enabled = settings?.enabled ?? false;
  return {
    settings: { enabled, time: clock.time, zone: clock.zone, locale: settings?.locale ?? locale },
    next: enabled ? { at: new Date(nextBriefAt(nowMs, clock, prefs.quietHours, newest?.day ?? null)).toISOString(), quiet: timeIsQuiet(clock, prefs.quietHours, nowMs) } : { at: null, quiet: timeIsQuiet(clock, prefs.quietHours, nowMs) },
    channels: { inbox: true, telegram: prefs.telegram, push: prefs.push },
    priceCredits: BRIEF_PRICE_CREDITS,
    charged: false,
    latest: latest ? briefView(latest, locale) : null,
  };
}

export type BriefUpdateResult = Readonly<{ ok: true; settings: BriefSettings }> | Readonly<{ ok: false; code: "VALIDATION_ERROR" | "UNAVAILABLE"; reason: string }>;

/** The person's own settings, written over the version read — a write from another tab meanwhile is read again and the newest word wins. */
export async function updateBriefSettings(store: GuardStore, owner: string, input: Required<AssistantBriefUpdate>, nowMs: number): Promise<BriefUpdateResult> {
  if (!isBriefTime(input.time)) return { ok: false, code: "VALIDATION_ERROR", reason: "The time is a quarter hour, HH:00, HH:15, HH:30 or HH:45." };
  if (!isZone(input.zone)) return { ok: false, code: "VALIDATION_ERROR", reason: "The time zone is not one this server knows." };
  const at = new Date(nowMs).toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await readSettings(store, owner);
    const next: BriefSettings = {
      schema: "ryntra.assistant.brief-settings",
      version: (found?.version ?? 0) + 1,
      owner,
      enabled: input.enabled,
      time: input.time,
      zone: input.zone,
      locale: input.locale,
      createdAt: found?.createdAt ?? at,
      updatedAt: at,
    };
    if (await writeSettings(store, next, found?.version ?? null)) return { ok: true, settings: next };
  }
  return { ok: false, code: "UNAVAILABLE", reason: "The settings kept changing meanwhile; try again." };
}
