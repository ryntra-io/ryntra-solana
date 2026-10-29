/**
 * One story, however many times it is told (AI-09).
 *
 * The same link is the same item: its canonical form — no tracking
 * parameters, no fragment, no trailing slash — is hashed into the item's id,
 * so a feed that repeats an item, or two feeds that carry one link, keep one.
 * Two publishers' items about one event are two items of one story: their
 * headlines share most of their words within a day and a half, and the
 * later one joins the earlier one's story. A story says how many sources
 * tell it; it never makes what they say verified.
 *
 * Pure.
 */

import { createHash } from "node:crypto";

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|cmpid|campaign|rss|feed|_ga|igshid|s_cid|guccounter)$/i;

/** The link with what does not change the page removed. */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const query = url.searchParams.toString();
  return `https://${url.hostname}${path}${query ? `?${query}` : ""}`;
}

export function itemId(url: string): string {
  return `nw_${createHash("sha256").update(canonicalUrl(url), "utf8").digest("hex").slice(0, 24)}`;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as", "at", "by", "is", "are", "be", "its", "it", "from", "after", "over", "into", "new", "says", "say", "this", "that", "than", "amid", "how", "why", "what", "will", "can", "could", "may", "has", "have", "here", "s"]);

/** A headline's words that carry its meaning, lower case, without punctuation or stop words. */
export function titleWords(title: string): ReadonlySet<string> {
  const words = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^\p{L}\p{N}$]+/u)
    .filter((word) => word.length > 1 && !STOP.has(word));
  return new Set(words);
}

export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Two headlines tell one story when they share this much of their words. */
export const STORY_SIMILARITY = 0.5;
export const STORY_WINDOW_MS = 36 * 3_600_000;

export type StoryCandidate = Readonly<{ id: string; story: string; title: string; publishedAt: string; feedId: string }>;

/**
 * The story an item joins: the earliest item of another feed whose headline
 * is close enough within the window, or the item's own id. Items of one feed
 * are never one story by this rule — a publisher that tells a thing twice
 * wrote two items.
 */
export function storyFor(item: Readonly<{ id: string; title: string; publishedAt: string; feedId: string }>, known: readonly StoryCandidate[]): string {
  const words = titleWords(item.title);
  if (words.size < 4) return item.id;
  const at = Date.parse(item.publishedAt);
  let best: { story: string; score: number; at: number } | null = null;
  for (const other of known) {
    if (other.id === item.id || other.feedId === item.feedId) continue;
    const otherAt = Date.parse(other.publishedAt);
    if (Math.abs(otherAt - at) > STORY_WINDOW_MS) continue;
    const otherWords = titleWords(other.title);
    if (otherWords.size < 4) continue;
    const score = similarity(words, otherWords);
    if (score < STORY_SIMILARITY) continue;
    if (best === null || score > best.score || (score === best.score && otherAt < best.at)) best = { story: other.story, score, at: otherAt };
  }
  return best?.story ?? item.id;
}
