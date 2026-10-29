/**
 * «Ранковий огляд» in the Guard store (AI-10) — one collection,
 * `assistantBriefs`, no DDL.
 *
 * - `settings:solana:mainnet:<wallet>` — whether the brief is on, its time,
 *   its zone and its language; versioned, written by the person's own page.
 * - `market:<UTC hour>` — «Сьогодні на ринку», built once for everyone in a
 *   slot and read by every brief of that hour.
 * - `brief:solana:mainnet:<wallet>:<day>` — a wallet's brief of a day,
 *   created by compare-and-set, so two passes of the cron make one; it waits
 *   for its words while Flex is busy, and is delivered once.
 * - `run:last` — what the last pass did.
 */

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import { BRIEF_LINE_KINDS } from "./lines.ts";

export const BRIEFS_COLLECTION = "assistantBriefs" as const;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Clock = z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/);
const Locale = z.enum(["en", "uk"]);

export const BriefSettingsSchema = z
  .object({
    schema: z.literal("ryntra.assistant.brief-settings"),
    version: z.number().int().min(1),
    owner: Wallet,
    enabled: z.boolean(),
    time: Clock,
    zone: z.string().min(1).max(64),
    locale: Locale,
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type BriefSettings = z.infer<typeof BriefSettingsSchema>;

export const BriefLineSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(BRIEF_LINE_KINDS),
    mark: z.enum(["fact", "unverified"]),
    en: z.string().min(1).max(600),
    uk: z.string().min(1).max(600),
    source: z.string().min(1).max(48),
    observedAt: Iso.nullable(),
    href: z.string().max(600).nullable(),
    figures: z.object({ pct: z.array(z.number()).max(8), usd: z.array(z.number()).max(4), moves: z.array(z.object({ symbol: z.string().min(1).max(32), pct: z.number() }).strict()).max(8) }).strict(),
  })
  .strict();

const Words = z.object({ en: z.array(z.string().min(1).max(400)).max(2), uk: z.array(z.string().min(1).max(400)).max(2) }).strict();
export type BriefWords = z.infer<typeof Words>;

/** What one model call cost, as the provider's usage priced it — micro-dollars, the tier it was served on. */
const Spend = z
  .object({
    model: z.string().min(1).max(64),
    serviceTier: z.enum(["default", "flex"]),
    costMicroUsd: z.number().int().min(0).nullable(),
    input: z.number().int().min(0),
    cached: z.number().int().min(0),
    output: z.number().int().min(0),
    latencyMs: z.number().int().min(0),
  })
  .strict();
export type BriefSpend = z.infer<typeof Spend>;

export const MarketSummarySchema = z
  .object({
    schema: z.literal("ryntra.assistant.market-summary"),
    version: z.number().int().min(1),
    slot: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
    state: z.enum(["building", "ready"]),
    builtAt: Iso,
    lines: z.array(BriefLineSchema).max(12),
    /** Null while building, and when the model was off, busy or said nothing that held. */
    words: Words.nullable(),
    spend: Spend.nullable(),
  })
  .strict();
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

export const BriefRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.brief"),
    version: z.number().int().min(1),
    owner: Wallet,
    day: Day,
    locale: Locale,
    /** `waiting` — its words are not back yet (Flex busy); `delivered` — the note is written and the deliveries queued. */
    state: z.enum(["waiting", "delivered"]),
    attempts: z.number().int().min(0).max(20),
    /** When it was due on the person's clock (after the quiet hours). */
    dueAt: Iso,
    market: z.object({ slot: z.string().max(16), lines: z.array(BriefLineSchema).max(12), words: Words.nullable() }).strict(),
    /** Null when nothing of the person's changed: then the brief is the market's alone and no model is called for it. */
    personal: z.object({ lines: z.array(BriefLineSchema).max(12), words: z.array(z.string().min(1).max(400)).max(2).nullable() }).strict().nullable(),
    /** `changed` — the person's part has lines; `unchanged` — every read answered and nothing changed; `unread` — the wallet or its list did not answer, so «nothing changed» is not said. */
    personalState: z.enum(["changed", "unchanged", "unread"]),
    /** What of the person's own could not be read: tokens not read (of all their tokens), and whether the notes could not. Null when everything answered. */
    personalGap: z
      .object({
        tokens: z.number().int().min(0),
        of: z.number().int().min(0),
        notes: z.boolean(),
        list: z.boolean(),
        /** The wallet itself: not read, or read in part (some tokens not seen at all). */
        wallet: z.enum(["unread", "partial"]).nullable(),
        /** Changes past the lines a brief shows. */
        more: z.number().int().min(0),
        /** Tokens Jupiter does not verify that moved by `MOVE_PCT` or more: a change, counted here and never named. */
        hidden: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    /** The zone the brief's times are said in — the person's own. */
    zone: z.string().min(1).max(64),
    /** The brief's price in credits, as the plan sets it — `charged` stays false until credits exist (AI-04). */
    priceCredits: z.number().int().min(0),
    charged: z.literal(false),
    spend: Spend.nullable(),
    inboxId: z.string().regex(/^inb_[0-9a-f]{24}$/).nullable(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type BriefRecord = z.infer<typeof BriefRecordSchema>;

export const BriefRunSchema = z
  .object({
    at: Iso,
    subscribers: z.number().int().min(0),
    due: z.number().int().min(0),
    delivered: z.number().int().min(0),
    waiting: z.number().int().min(0),
    personalCalls: z.number().int().min(0),
    marketCall: z.boolean(),
    costMicroUsd: z.number().int().min(0),
    deferred: z.number().int().min(0),
  })
  .strict();
export type BriefRun = z.infer<typeof BriefRunSchema>;

const PREFIX = "solana:mainnet:";
export const settingsKey = (owner: string) => `settings:${PREFIX}${owner}`;
export const briefKey = (owner: string, day: string) => `brief:${PREFIX}${owner}:${day}`;
export const briefPrefix = (owner: string) => `brief:${PREFIX}${owner}:`;
export const marketKey = (slot: string) => `market:${slot}`;
export const slotOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 13);

type Versioned = { version: number };
const briefs = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(BRIEFS_COLLECTION);

export async function readSettings(store: GuardStore, owner: string): Promise<BriefSettings | null> {
  const parsed = BriefSettingsSchema.safeParse(await briefs(store).get(settingsKey(owner)));
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

/** Every wallet's settings that are on — the pass's list of people. */
export async function listEnabledSettings(store: GuardStore): Promise<BriefSettings[]> {
  const rows = await briefs(store).valuesWithPrefix(`settings:${PREFIX}`);
  return rows.flatMap((row) => {
    const parsed = BriefSettingsSchema.safeParse(row);
    return parsed.success && parsed.data.enabled ? [parsed.data] : [];
  });
}

/** Write the settings over the version read; false when someone else wrote first. */
export async function writeSettings(store: GuardStore, next: BriefSettings, expected: number | null): Promise<boolean> {
  return briefs(store).compareAndSet(settingsKey(next.owner), expected, BriefSettingsSchema.parse(next));
}

export async function readBrief(store: GuardStore, owner: string, day: string): Promise<BriefRecord | null> {
  const parsed = BriefRecordSchema.safeParse(await briefs(store).get(briefKey(owner, day)));
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

/** The wallet's latest delivered brief — what the page shows. */
export async function latestBrief(store: GuardStore, owner: string): Promise<BriefRecord | null> {
  const rows = await briefs(store).valuesWithPrefix(briefPrefix(owner));
  const parsed = rows.flatMap((row) => {
    const read = BriefRecordSchema.safeParse(row);
    return read.success && read.data.owner === owner && read.data.state === "delivered" ? [read.data] : [];
  });
  return parsed.sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
}

export async function writeBrief(store: GuardStore, next: BriefRecord, expected: number | null): Promise<boolean> {
  return briefs(store).compareAndSet(briefKey(next.owner, next.day), expected, BriefRecordSchema.parse(next));
}

export async function readMarketSummary(store: GuardStore, slot: string): Promise<MarketSummary | null> {
  const parsed = MarketSummarySchema.safeParse(await briefs(store).get(marketKey(slot)));
  return parsed.success ? parsed.data : null;
}

/** The stored version of a slot whatever its shape — so a record this code cannot read is taken over, never a slot blocked. */
export async function marketSummaryVersion(store: GuardStore, slot: string): Promise<number | null> {
  const raw = await briefs(store).get(marketKey(slot));
  return raw && typeof raw.version === "number" ? raw.version : null;
}

export async function writeMarketSummary(store: GuardStore, next: MarketSummary, expected: number | null): Promise<boolean> {
  return briefs(store).compareAndSet(marketKey(next.slot), expected, MarketSummarySchema.parse(next));
}

/** A wallet's briefs older than `keepDays` go when the pass passes them; the note in the inbox stays the inbox's. */
export async function pruneBriefs(store: GuardStore, owner: string, today: string, keepDays = 14): Promise<number> {
  const rows = await briefs(store).valuesWithPrefix(briefPrefix(owner));
  const [y, m, d] = today.split("-").map(Number);
  const cut = new Date(Date.UTC(y, m - 1, d - keepDays)).toISOString().slice(0, 10);
  let removed = 0;
  for (const row of rows) {
    const read = BriefRecordSchema.safeParse(row);
    if (read.success && read.data.day < cut) {
      await briefs(store).delete(briefKey(owner, read.data.day));
      removed += 1;
    }
  }
  return removed;
}

export async function writeRun(store: GuardStore, run: BriefRun): Promise<void> {
  await store.collection<BriefRun>(BRIEFS_COLLECTION).set("run:last", BriefRunSchema.parse(run));
}

export async function readRun(store: GuardStore): Promise<BriefRun | null> {
  const parsed = BriefRunSchema.safeParse(await store.collection<unknown>(BRIEFS_COLLECTION).get("run:last"));
  return parsed.success ? parsed.data : null;
}

/** Old market summaries go: a slot is read within its hour, kept a day. */
export async function pruneMarketSummaries(store: GuardStore, nowMs: number): Promise<number> {
  const rows = await briefs(store).valuesWithPrefix("market:");
  const cut = slotOf(nowMs - 24 * 3_600_000);
  let removed = 0;
  for (const row of rows) {
    const read = MarketSummarySchema.safeParse(row);
    if (read.success && read.data.slot < cut) {
      await briefs(store).delete(marketKey(read.data.slot));
      removed += 1;
    }
  }
  return removed;
}
