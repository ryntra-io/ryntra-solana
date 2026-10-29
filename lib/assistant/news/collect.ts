/**
 * The news collector (AI-09, PLAN §5) — every ten minutes, for everyone.
 *
 * Read the allow-listed feeds → keep the items that are new (one id per
 * link, `dedupe.ts`) → join them to the story they tell → find the tokens
 * their words name (`tagging.ts`) → let the everyday model label them in
 * batches, held to the candidates → store each with its source and time →
 * rebuild the digests of the tokens the run touched. Every hour the digests
 * of all are rebuilt, the followed tokens refreshed and old items removed
 * (`refreshNews`).
 *
 * The collector reads public feeds and writes the platform's own cache. It
 * signs nothing, sends nothing, reads nobody's keys. The model labels at most
 * `MODEL_BATCHES` batches a run, each priced on its receipt, so a day of
 * news has a ceiling by construction. Without a model the words label alone.
 *
 * Deps are handed in: the fetch, the clock, the store, the labeller, the
 * receipt writer and the catalogue's lookup — the tests bind fixtures.
 */

import { createHash, randomBytes } from "node:crypto";

import type { GuardStore } from "../../guard/store.ts";
import { storyFor, itemId, type StoryCandidate } from "./dedupe.ts";
import { NEWS_FEEDS, type NewsFeed } from "./feeds.ts";
import { FEED_MAX_BYTES, parseFeed, type FeedItem } from "./rss.ts";
import {
  buildDigest,
  digestMints,
  insertItem,
  pruneItems,
  readFollowedTerms,
  LOCK_SLOT_MS,
  NEWS_COLLECTION,
  readRecentItems,
  writeDigest,
  writeFollowedTerms,
  writeRunReport,
  type NewsRecord,
  type RunReport,
} from "./store.ts";
import { candidatesIn, followedTerm, holdTags, marketWide, safeFollowedTerms, TOKEN_TERMS, topicFromWords, type Candidate, type ModelTag, type TokenTerm } from "./tagging.ts";

export { safeFollowedTerms };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The everyday model's labels for a batch, with what the call cost. */
export type NewsLabeller = (batch: readonly Readonly<{ id: string; title: string; summary: string; candidates: readonly string[] }>[]) => Promise<
  Readonly<{ ok: boolean; tags: readonly ModelTag[]; costMicroUsd: number | null }>
>;

export type CollectDeps = Readonly<{
  store: GuardStore;
  nowMs: number;
  fetchImpl?: FetchLike;
  feeds?: readonly NewsFeed[];
  /** Null: the words label alone and nothing is spent. */
  label?: NewsLabeller | null;
  timeoutMs?: number;
  runId?: string;
}>;

/** Items a run has the model label, at most; the rest are labelled by the words. */
export const MODEL_BATCH_SIZE = 20;
export const MODEL_BATCHES = 2;
/** An item published longer ago than this is not news to collect. */
export const COLLECT_MAX_AGE_MS = 48 * 3_600_000;

const USER_AGENT = "RyntraNews/1.0 (+https://ryntra.io)";

async function readFeed(feed: NewsFeed, deps: CollectDeps): Promise<Readonly<{ ok: true; body: string }> | Readonly<{ ok: false; reason: string }>> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const response = await fetchImpl(feed.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9", "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000) });
    if (!response.ok) return { ok: false, reason: `The feed answered ${response.status}.` };
    return { ok: true, body: await boundedText(response, FEED_MAX_BYTES) };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: timeout ? "The feed did not answer in time." : "The feed could not be reached." };
  }
}

/** The body up to `max` bytes, read from the stream — a feed that grows without end costs a bounded read. */
async function boundedText(response: Response, max: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, max);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, all.length - at));
    all.set(part, at);
    at += part.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

export type CollectReport = RunReport;

/**
 * One run of the collector. Never throws on a feed: a feed that failed is a
 * line of the report, and the others are still read.
 */
export async function collectNews(deps: CollectDeps & Readonly<{ lock?: boolean }>): Promise<CollectReport | null> {
  const started = Date.now();
  const nowMs = deps.nowMs;
  if (deps.lock && !(await deps.store.collection<unknown>(NEWS_COLLECTION).insertIfAbsent(`lock:collect:${Math.floor(nowMs / LOCK_SLOT_MS)}`, { slot: Math.floor(nowMs / LOCK_SLOT_MS), at: new Date(nowMs).toISOString() }))) return null;
  const feeds = deps.feeds ?? NEWS_FEEDS;
  const runId = deps.runId ?? `nwr_${randomBytes(8).toString("hex")}`;
  const reads = await Promise.all(feeds.map(async (feed) => ({ feed, read: await readFeed(feed, deps) })));
  const known = await readRecentItems(deps.store, nowMs);
  const knownIds = new Set(known.map((record) => record.id));
  const report: RunReport["feeds"][number][] = [];
  const fresh: (FeedItem & { id: string })[] = [];
  for (const { feed, read } of reads) {
    if (!read.ok) {
      report.push({ id: feed.id, ok: false, reason: read.reason, seen: 0, kept: 0, fresh: 0, screened: 0 });
      continue;
    }
    const parsed = parseFeed(read.body, feed, nowMs);
    let added = 0;
    for (const item of parsed.items) {
      if (Date.parse(item.publishedAt) < nowMs - COLLECT_MAX_AGE_MS) continue;
      const id = itemId(item.url);
      if (knownIds.has(id)) continue;
      knownIds.add(id);
      fresh.push({ ...item, id });
      added += 1;
    }
    report.push({ id: feed.id, ok: true, reason: null, seen: parsed.seen, kept: parsed.items.length, fresh: added, screened: parsed.dropped.screened });
  }

  /* The stories: the earliest first, each new item joining a story already told by another feed. */
  fresh.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const stories: StoryCandidate[] = known.map((record) => ({ id: record.id, story: record.story, title: record.title, publishedAt: record.publishedAt, feedId: record.feedId }));
  const terms: readonly TokenTerm[] = [...TOKEN_TERMS, ...safeFollowedTerms(await readFollowedTerms(deps.store))];
  const pending = fresh.map((item) => {
    const story = storyFor(item, stories);
    stories.push({ id: item.id, story, title: item.title, publishedAt: item.publishedAt, feedId: item.feedId });
    const words = `${item.title}. ${item.summary}`;
    return { item, story, candidates: candidatesIn(words, terms), topic: topicFromWords(words), words };
  });

  /* The model labels the newest items that name a token, in batches; every call is priced. */
  const labelled = new Map<string, ModelTag>();
  let modelCalls = 0;
  let cost: number | null = 0;
  if (deps.label) {
    const asked = pending.filter((entry) => entry.candidates.length > 0).slice(-MODEL_BATCH_SIZE * MODEL_BATCHES);
    const batches: (typeof asked)[] = [];
    for (let start = 0; start < asked.length; start += MODEL_BATCH_SIZE) batches.push(asked.slice(start, start + MODEL_BATCH_SIZE));
    /* The batches at once: a run stays inside the cron's minute even when the model is slow. */
    const label = deps.label;
    const answers = await Promise.all(batches.map((batch) => label(batch.map((entry) => ({ id: entry.item.id, title: entry.item.title, summary: entry.item.summary, candidates: entry.candidates.map((candidate: Candidate) => candidate.symbol) })))));
    answers.forEach((answer, index) => {
      modelCalls += 1;
      cost = cost === null || answer.costMicroUsd === null ? null : cost + answer.costMicroUsd;
      if (!answer.ok) return;
      const ids = new Set(batches[index].map((entry) => entry.item.id));
      for (const tag of answer.tags) if (ids.has(tag.id) && !labelled.has(tag.id)) labelled.set(tag.id, tag);
    });
  }

  const collectedAt = new Date(nowMs).toISOString();
  const written: NewsRecord[] = [];
  let byModel = 0;
  for (const entry of pending) {
    const held = holdTags(entry.candidates, entry.topic, labelled.get(entry.item.id) ?? null);
    if (held.byModel) byModel += 1;
    const record: NewsRecord = {
      schema: "ryntra.assistant.news-item",
      schemaVersion: "1.0.0",
      id: entry.item.id,
      story: entry.story,
      feedId: entry.item.feedId,
      source: entry.item.source,
      title: entry.item.title,
      summary: entry.item.summary,
      url: entry.item.url,
      publishedAt: entry.item.publishedAt,
      collectedAt,
      mints: [...new Set(held.mints)].slice(0, 8),
      topic: held.topic,
      market: marketWide(entry.words, held.topic),
      taggedBy: held.byModel ? "model" : "words",
    };
    /* One record that does not fit is one record lost, never the run. */
    if (await insertItem(deps.store, record).catch(() => false)) written.push(record);
  }

  /* The digests of what this run touched: each token it named, and the market when a market-wide story came. */
  const all = [...known, ...written];
  const touched = new Set<string | null>();
  for (const record of written) {
    for (const mint of record.mints) touched.add(mint);
    if (record.market) touched.add(null);
  }
  for (const mint of touched) await writeDigest(deps.store, buildDigest(mint, all, nowMs));

  const run: RunReport = {
    schema: "ryntra.assistant.news-run",
    runId,
    at: collectedAt,
    ms: Math.max(0, Date.now() - started),
    feeds: report,
    fresh: written.length,
    taggedByModel: byModel,
    taggedByWords: written.length - byModel,
    modelCalls,
    costMicroUsd: cost,
    digests: touched.size,
    labeller: Boolean(deps.label),
  };
  await writeRunReport(deps.store, run);
  return run;
}

/** The catalogue's symbol and name for many mints at once; null when the catalogue cannot be asked now. */
export type FollowedLookup = (mints: readonly string[]) => Promise<ReadonlyMap<string, Readonly<{ symbol: string; name: string }>> | null>;

/** At most this many followed tokens become terms — the most followed first. */
export const FOLLOWED_MAX = 60;

/**
 * The hourly pass: every digest rebuilt so stories older than two days fall
 * out, the items older than three days removed — first, so the pass does its
 * own work whatever the catalogue does — and then the tokens people follow
 * refreshed as terms, in one batch read. A read that did not answer keeps the
 * last terms; nothing is overwritten with nothing. `followedMints` is every
 * watchlist's mints, one entry per wallet that follows the mint.
 */
export async function refreshNews(deps: Readonly<{ store: GuardStore; nowMs: number; followedMints?: readonly string[]; lookup?: FollowedLookup }>): Promise<Readonly<{ digests: number; followed: number | null; pruned: number }>> {
  const nowMs = deps.nowMs;
  const records = await readRecentItems(deps.store, nowMs);
  const mints = new Set<string | null>([null, ...(await digestMints(deps.store))]);
  for (const record of records) for (const mint of record.mints) mints.add(mint);
  for (const mint of mints) await writeDigest(deps.store, buildDigest(mint, records, nowMs));
  const pruned = await pruneItems(deps.store, nowMs);
  let followed: number | null = null;
  if (deps.followedMints && deps.lookup) {
    const counts = new Map<string, number>();
    for (const mint of deps.followedMints) if (!TOKEN_TERMS.some((term) => term.mint === mint)) counts.set(mint, (counts.get(mint) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, FOLLOWED_MAX).map(([mint]) => mint);
    const found = top.length > 0 ? await deps.lookup(top).catch(() => null) : new Map();
    if (found !== null) {
      const terms = safeFollowedTerms(top.flatMap((mint) => {
        const row = found.get(mint);
        const term = row ? followedTerm({ mint, symbol: row.symbol, name: row.name }) : null;
        return term ? [term] : [];
      }));
      await writeFollowedTerms(deps.store, terms, nowMs);
      followed = terms.length;
    }
  }
  return { digests: mints.size, followed, pruned };
}

/** A stable id for a run when the caller wants one (tests). */
export function runIdFor(seed: string): string {
  return `nwr_${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16)}`;
}
