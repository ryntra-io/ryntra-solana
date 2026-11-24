import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { clockOf } from "../../city/lib/autopilot/report.ts";
import { readReport } from "../../city/lib/autopilot/report-watch.ts";
import { DRIVE_KINDS } from "./events.ts";
import type { Lang } from "./figures.ts";

/**
 * What the person hears of her agent, and where: each kind of note — bought, sold, paused, stopped, the week — on or
 * off, and the two places it goes — Telegram and the phone. All on until she says otherwise. Her clock and language
 * ride along, so the week comes at her hour in her words. Kept beside the agent's daily report, in the same rows
 * (`agentReports`), under its own prefix `d:` — the report reads only its own `r:`.
 *
 * A channel is used only when her settings here and Ryntra's notification settings both allow it (the quiet hours and
 * «mute» stay Ryntra's). Public data only: switches, a clock, a language.
 */

export const DRIVE_TOPICS = [...DRIVE_KINDS, "week"] as const;
export type DriveTopic = (typeof DRIVE_TOPICS)[number];

export type DriveSettings = Readonly<{
  version: number;
  owner: string;
  topics: Readonly<Record<DriveTopic, boolean>>;
  telegram: boolean;
  push: boolean;
  locale: Lang;
  timezone: string;
  updatedAt: string;
}>;

export const DRIVE_COLLECTION = "agentReports" as const;
const PREFIX = "d:";
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

export const driveSettingsKey = (owner: string) => `${PREFIX}${owner}`;
const rows = (store: GuardStore) => store.versioned<DriveSettings>(DRIVE_COLLECTION);

const ALL_ON: Readonly<Record<DriveTopic, boolean>> = { bought: true, sold: true, paused: true, stopped: true, week: true };

/** A wallet's settings before she changed any: everything on, in her daily report's clock and language when it has one. */
export function defaultDriveSettings(owner: string, from: Readonly<{ locale?: Lang; timezone?: string }> = {}): DriveSettings {
  return { version: 0, owner, topics: ALL_ON, telegram: true, push: true, locale: from.locale ?? "en", timezone: clockOf(from.timezone), updatedAt: "1970-01-01T00:00:00.000Z" };
}

const isSettings = (row: unknown): row is DriveSettings =>
  typeof row === "object" && row !== null && typeof (row as DriveSettings).owner === "string" && typeof (row as DriveSettings).topics === "object" && (row as DriveSettings).topics !== null;

/** Her settings as kept; null — never changed. Throws when the store does not answer. */
export async function readDriveSettings(store: GuardStore, owner: string): Promise<DriveSettings | null> {
  const row = await rows(store).get(driveSettingsKey(owner));
  if (!isSettings(row)) return null;
  /* A topic added after she saved hers is on, as for everyone. */
  return { ...row, topics: { ...ALL_ON, ...row.topics } };
}

/** Her settings to tell by: as kept, or everything on in her daily report's clock and language. */
export async function driveSettingsOf(store: GuardStore, owner: string): Promise<DriveSettings> {
  const kept = await readDriveSettings(store, owner);
  if (kept) return kept;
  const report = await readReport(store, owner).catch(() => null);
  return defaultDriveSettings(owner, report ? { locale: report.locale, timezone: report.timezone } : {});
}

export const DriveSettingsChangeSchema = z
  .object({
    topics: z.object({ bought: z.boolean(), sold: z.boolean(), paused: z.boolean(), stopped: z.boolean(), week: z.boolean() }).partial().strict().optional(),
    telegram: z.boolean().optional(),
    push: z.boolean().optional(),
    locale: z.enum(["en", "uk"]).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();
export type DriveSettingsChange = z.infer<typeof DriveSettingsChangeSchema>;

/** Keeps her change over what was kept — or over everything on — with compare-and-set. */
export async function keepDriveSettings(store: GuardStore, owner: string, change: DriveSettingsChange, nowMs: number): Promise<DriveSettings> {
  if (!WALLET.test(owner)) throw new TypeError("A wallet is addressed by its Solana address.");
  const key = driveSettingsKey(owner);
  const at = new Date(nowMs).toISOString();
  return withBoundedCasRetry(async () => {
    const current = await readDriveSettings(store, owner);
    const base = current ?? (await driveSettingsOf(store, owner));
    const next: DriveSettings = {
      ...base,
      version: (current?.version ?? 0) + 1,
      topics: { ...base.topics, ...(change.topics ?? {}) },
      telegram: change.telegram ?? base.telegram,
      push: change.push ?? base.push,
      locale: change.locale ?? base.locale,
      timezone: change.timezone === undefined ? base.timezone : clockOf(change.timezone),
      updatedAt: at,
    };
    return (await rows(store).compareAndSet(key, current ? current.version : null, next)) ? next : false;
  });
}

/** The settings as a screen shows them: the switches, the clock, the language — never the row's bookkeeping. */
export function settingsView(settings: DriveSettings): Readonly<{ topics: DriveSettings["topics"]; telegram: boolean; push: boolean; locale: Lang; timezone: string; kept: boolean }> {
  return { topics: settings.topics, telegram: settings.telegram, push: settings.push, locale: settings.locale, timezone: settings.timezone, kept: settings.version > 0 };
}
