/**
 * The news Ryntra collected, and the digest of it per token (AI-09).
 *
 * One Guard collection, `assistantNews`, no DDL. Keys:
 * - `item:<UTC day of publication>:<id>` — one item, written once with
 *   `insertIfAbsent`, so two collectors that read the same link keep one;
 * - `digest:<mint>` and `digest:market` — a token's (or the whole market's)
 *   stories of the last two days, rebuilt by the collector for the tokens a
 *   run touched and every hour for all;
 * - `terms:followed` — the tokens people follow, as terms the collector looks
 *   for; `run:last` — what the last collection did.
 *
 * A question reads one digest and nothing else: it never starts a
 * collection (PLAN §5). Items live three days; the digest speaks of two.
 */

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import { NEWS_TOPICS, safeFollowedTerms, TOKEN_TERMS, type NewsTopic, type TokenTerm } from "./tagging.ts";

export const NEWS_COLLECTION = "assistantNews" as const;
export const NEWS_KEEP_MS = 3 * 86_400_000;
export const DIGEST_SPAN_MS = 48 * 3_600_000;
export const DIGEST_DAY_MS = 24 * 3_600_000;
/** A digest rebuilt longer ago than this is said as stale: the collector has not run. */
export const DIGEST_STALE_MS = 90 * 60_000;
export const DIGEST_STORIES_MAX = 20;
/** The collector's run lock: one run per slot (`collect.ts`). */
export const LOCK_SLOT_MS = 8 * 60_000;

const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });
const Id = z.string().regex(/^nw_[0-9a-f]{24}$/);

export const NewsRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.news-item"),
    schemaVersion: z.literal("1.0.0"),
    id: Id,
    story: Id,
    feedId: z.string().min(1).max(32),
    source: z.string().min(1).max(48),
    title: z.string().min(1).max(200),
    summary: z.string().max(300),
    url: z.string().url().max(600),
    publishedAt: Iso,
    collectedAt: Iso,
    mints: z.array(Mint).max(8),
    topic: z.enum(NEWS_TOPICS),
    market: z.boolean(),
    taggedBy: z.enum(["model", "words"]),
  })
  .strict();
export type NewsRecord = z.infer<typeof NewsRecordSchema>;

/** One story as a digest tells it: its first item, and how many other sources told it. */
export const DigestStorySchema = z
  .object({
    id: Id,
    story: Id,
    title: z.string().min(1).max(200),
    source: z.string().min(1).max(48),
    feedId: z.string().min(1).max(32),
    url: z.string().url().max(600),
    publishedAt: Iso,
    topic: z.enum(NEWS_TOPICS),
    /** Other sources that told the same story within the window. */
    also: z.number().int().min(0).max(20),
  })
  .strict();
export type DigestStory = z.infer<typeof DigestStorySchema>;

export const NewsDigestSchema = z
  .object({
    schema: z.literal("ryntra.assistant.news-digest"),
    schemaVersion: z.literal("1.0.0"),
    /** The token's mint, or null for the market as a whole. */
    mint: Mint.nullable(),
    builtAt: Iso,
    /** Stories, sources and topics of the last 24 h. */
    day: z.object({ stories: z.number().int().min(0), sources: z.number().int().min(0), topics: z.array(z.object({ topic: z.enum(NEWS_TOPICS), stories: z.number().int().min(1) }).strict()).max(NEWS_TOPICS.length) }).strict(),
    /** The stories of the last 48 h, newest first. */
    stories: z.array(DigestStorySchema).max(DIGEST_STORIES_MAX),
  })
  .strict();
export type NewsDigest = z.infer<typeof NewsDigestSchema>;

const TermSchema = z.object({ mint: Mint, symbol: z.string().min(1).max(16), names: z.array(z.string().max(48)).max(4), weakNames: z.array(z.string().max(48)).max(4).optional(), capitalSymbol: z.boolean() }).strict();
const FollowedSchema = z.object({ schema: z.literal("ryntra.assistant.news-terms"), builtAt: Iso, terms: z.array(TermSchema).max(200) }).strict();

const FeedReportSchema = z.object({ id: z.string(), ok: z.boolean(), reason: z.string().max(120).nullable(), seen: z.number().int(), kept: z.number().int(), fresh: z.number().int(), screened: z.number().int() }).strict();
export const RunReportSchema = z
  .object({
    schema: z.literal("ryntra.assistant.news-run"),
    runId: z.string().min(8).max(40),
    at: Iso,
    ms: z.number().int().min(0),
    feeds: z.array(FeedReportSchema).max(20),
    fresh: z.number().int().min(0),
    taggedByModel: z.number().int().min(0),
    taggedByWords: z.number().int().min(0),
    modelCalls: z.number().int().min(0),
    /** Micro-dollars the model calls of the run cost, from the provider's usage; null when one of them could not be priced. */
    costMicroUsd: z.number().int().min(0).nullable(),
    digests: z.number().int().min(0),
    /** Whether the model labelled this run — the followed tokens are labelled only by it. */
    labeller: z.boolean().optional(),
  })
  .strict();
export type RunReport = z.infer<typeof RunReportSchema>;

export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const itemKey = (record: Pick<NewsRecord, "publishedAt" | "id">): string => `item:${record.publishedAt.slice(0, 10)}:${record.id}`;
export const digestKey = (mint: string | null): string => `digest:${mint ?? "market"}`;

function news(store: GuardStore) {
  return store.collection<unknown>(NEWS_COLLECTION);
}

/** The items published on the days that reach back `spanMs` from now. */
export async function readRecentItems(store: GuardStore, nowMs: number, spanMs = NEWS_KEEP_MS): Promise<NewsRecord[]> {
  const days: string[] = [];
  for (let at = nowMs - spanMs; at <= nowMs + 86_400_000; at += 86_400_000) if (!days.includes(dayKey(at))) days.push(dayKey(at));
  /* One day at a time: a few small scans, never a burst of connections at the pool. */
  const rows: unknown[] = [];
  for (const day of days) rows.push(...(await news(store).valuesWithPrefix(`item:${day}:`)));
  return rows
    .map((row) => NewsRecordSchema.safeParse(row))
    .filter((parsed): parsed is { success: true; data: NewsRecord } => parsed.success)
    .map((parsed) => parsed.data)
    .filter((record) => Date.parse(record.publishedAt) >= nowMs - spanMs);
}

/** One item, written once; a record that does not fit the schema is not written, and says so by `false`. */
export async function insertItem(store: GuardStore, record: NewsRecord): Promise<boolean> {
  const parsed = NewsRecordSchema.safeParse(record);
  if (!parsed.success) return false;
  return news(store).insertIfAbsent(itemKey(parsed.data), parsed.data);
}

/** Items older than the days kept, removed day by day — the collector's own cache, nothing of anyone's. */
export async function pruneItems(store: GuardStore, nowMs: number): Promise<number> {
  let removed = 0;
  for (let back = 4; back <= 10; back += 1) {
    const day = dayKey(nowMs - back * 86_400_000);
    const rows = await news(store).valuesWithPrefix(`item:${day}:`);
    for (const row of rows) {
      const parsed = NewsRecordSchema.safeParse(row);
      if (!parsed.success) continue;
      await news(store).delete(itemKey(parsed.data));
      removed += 1;
    }
  }
  /* The collector's run locks older than a day go too: a slot is eight minutes, a lock outlives its run by nothing. */
  const locks = await news(store).valuesWithPrefix("lock:collect:").catch(() => [] as unknown[]);
  for (const lock of locks) {
    const slot = lock && typeof lock === "object" ? (lock as { slot?: unknown }).slot : null;
    if (typeof slot === "number" && Number.isInteger(slot) && slot * LOCK_SLOT_MS < nowMs - 86_400_000) await news(store).delete(`lock:collect:${slot}`);
  }
  return removed;
}

/**
 * The digest of one token (or of the market): its stories of the last 48 h,
 * one row per story — the story's first item, the number of other sources
 * that told it — newest first; and the last 24 h counted by story, by source
 * and by topic. Arithmetic on what was collected, nothing more.
 */
export function buildDigest(mint: string | null, records: readonly NewsRecord[], nowMs: number): NewsDigest {
  const about = records.filter((record) => (mint === null ? record.market : record.mints.includes(mint)) && Date.parse(record.publishedAt) >= nowMs - DIGEST_SPAN_MS && Date.parse(record.publishedAt) <= nowMs + 600_000);
  const byStory = new Map<string, NewsRecord[]>();
  for (const record of about) byStory.set(record.story, [...(byStory.get(record.story) ?? []), record]);
  const stories: DigestStory[] = [...byStory.values()].map((group) => {
    const sorted = [...group].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    const first = sorted[0];
    const others = new Set(sorted.slice(1).map((record) => record.feedId).filter((feed) => feed !== first.feedId));
    return { id: first.id, story: first.story, title: first.title, source: first.source, feedId: first.feedId, url: first.url, publishedAt: first.publishedAt, topic: first.topic, also: Math.min(20, others.size) };
  });
  stories.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const day = stories.filter((story) => Date.parse(story.publishedAt) >= nowMs - DIGEST_DAY_MS);
  const sources = new Set(about.filter((record) => Date.parse(record.publishedAt) >= nowMs - DIGEST_DAY_MS).map((record) => record.feedId));
  const topics = new Map<NewsTopic, number>();
  for (const story of day) topics.set(story.topic, (topics.get(story.topic) ?? 0) + 1);
  return NewsDigestSchema.parse({
    schema: "ryntra.assistant.news-digest",
    schemaVersion: "1.0.0",
    mint,
    builtAt: new Date(nowMs).toISOString(),
    day: { stories: day.length, sources: sources.size, topics: [...topics].sort((a, b) => b[1] - a[1]).map(([topic, count]) => ({ topic, stories: count })) },
    stories: stories.slice(0, DIGEST_STORIES_MAX),
  });
}

export async function writeDigest(store: GuardStore, digest: NewsDigest): Promise<void> {
  await news(store).set(digestKey(digest.mint), NewsDigestSchema.parse(digest));
}

export type DigestRead =
  | Readonly<{
      ok: true;
      digest: NewsDigest | null;
      stale: boolean;
      collectedAt: string;
      /** Whether the collector looks for this token at all: the market, a verified token, or a followed one the model labels. */
      tracked: boolean;
      /** The feeds the last run read, and how many answered. */
      feeds: Readonly<{ ok: number; total: number }>;
    }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * A token's digest, or the market's; `digest` null when no story of the last
 * two days named it. Freshness is the collector's: when its last run is older
 * than `DIGEST_STALE_MS`, everything read here is stale, however recent the
 * stories. Stories that aged past the window since the digest was built are
 * left out at the read. «No story» means something only where the collector
 * looks (`tracked`) and some feed answered: a last run whose every feed failed
 * is a read that did not answer, never «nothing was published».
 */
export async function readDigest(store: GuardStore, mint: string | null, nowMs: number): Promise<DigestRead> {
  try {
    const rawDigest = await news(store).get(digestKey(mint));
    const rawRun = await news(store).get("run:last");
    const run = RunReportSchema.safeParse(rawRun);
    if (!run.success) return { ok: false, reason: "News has not been collected yet." };
    const feeds = { ok: run.data.feeds.filter((feed) => feed.ok).length, total: run.data.feeds.length };
    if (feeds.ok === 0) return { ok: false, reason: "No news feed answered on the last run." };
    const stale = nowMs - Date.parse(run.data.at) > DIGEST_STALE_MS;
    const tracked = mint === null || TOKEN_TERMS.some((term) => term.mint === mint) || (run.data.labeller === true && safeFollowedTerms(await readFollowedTerms(store)).some((term) => term.mint === mint));
    const base = { ok: true as const, stale, collectedAt: run.data.at, tracked, feeds };
    if (rawDigest === undefined || rawDigest === null) return { ...base, digest: null };
    const parsed = NewsDigestSchema.safeParse(rawDigest);
    if (!parsed.success) return { ok: false, reason: "The news digest could not be read." };
    const stories = parsed.data.stories.filter((story) => Date.parse(story.publishedAt) >= nowMs - DIGEST_SPAN_MS);
    /* A token with stories is tracked by the fact of them, whatever the terms are today. */
    return { ...base, tracked: true, digest: stories.length === 0 ? null : { ...parsed.data, stories } };
  } catch {
    return { ok: false, reason: "The news store could not be read." };
  }
}

/** The mints that have a digest now — the hourly pass rebuilds them all, so none outlives its stories. */
export async function digestMints(store: GuardStore): Promise<readonly (string | null)[]> {
  const rows = await news(store).valuesWithPrefix("digest:");
  return rows.map((row) => NewsDigestSchema.safeParse(row)).filter((parsed): parsed is { success: true; data: NewsDigest } => parsed.success).map((parsed) => parsed.data.mint);
}

export async function readFollowedTerms(store: GuardStore): Promise<readonly TokenTerm[]> {
  const parsed = FollowedSchema.safeParse(await news(store).get("terms:followed").catch(() => undefined));
  return parsed.success ? parsed.data.terms : [];
}

export async function writeFollowedTerms(store: GuardStore, terms: readonly TokenTerm[], nowMs: number): Promise<void> {
  await news(store).set("terms:followed", FollowedSchema.parse({ schema: "ryntra.assistant.news-terms", builtAt: new Date(nowMs).toISOString(), terms: terms.slice(0, 200) }));
}

export async function writeRunReport(store: GuardStore, report: RunReport): Promise<void> {
  await news(store).set("run:last", RunReportSchema.parse(report));
}

export async function readRunReport(store: GuardStore): Promise<RunReport | null> {
  const parsed = RunReportSchema.safeParse(await news(store).get("run:last").catch(() => undefined));
  return parsed.success ? parsed.data : null;
}
