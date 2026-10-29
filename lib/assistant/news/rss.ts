/**
 * An RSS 2.0 or Atom feed read into items (AI-09).
 *
 * Only what an item needs: its headline, its link, its time and a short
 * summary. The link must be https and on the feed's own hosts
 * (`feeds.ts`); the time must be a real one, not in the future; the text is
 * cleaned and screened (`text.ts`) — an item that fails any of these is not
 * an item. A feed is read up to a size and a count, so a feed that grows or
 * breaks costs a bounded amount of work.
 *
 * Pure: the body of a response in, items out — no fetch, no clock but the
 * one it is handed.
 */

import { allowedLink, type NewsFeed } from "./feeds.ts";
import { cleanText, decodeEntities, screenText, unwrapCdata } from "./text.ts";

export const FEED_MAX_BYTES = 1_500_000;
export const FEED_MAX_ITEMS = 60;
export const TITLE_MAX = 180;
export const SUMMARY_MAX = 280;
/** An item older than this at collection is history, not news. */
export const ITEM_MAX_AGE_MS = 7 * 86_400_000;
/** A clock a little ahead of ours is tolerated; a time further ahead is not a time. */
const FUTURE_SLACK_MS = 10 * 60_000;

export type FeedItem = Readonly<{
  feedId: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
}>;

export type FeedParse = Readonly<{ items: readonly FeedItem[]; seen: number; dropped: Readonly<{ link: number; time: number; text: number; screened: number }> }>;

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? match[1] : null;
}

/** An Atom entry's link: the alternate one, or the first without a rel. */
function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((match) => match[1]);
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  const pick = links.find((attrs) => {
    const rel = attr(attrs, "rel");
    return !rel || (rel[2] ?? rel[3]) === "alternate";
  });
  if (!pick) return null;
  const href = attr(pick, "href");
  return href ? decodeEntities(href[2] ?? href[3] ?? "") : null;
}

function rssLink(block: string): string | null {
  const link = tag(block, "link");
  if (link && link.trim().length > 0) return decodeEntities(unwrapCdata(link)).trim();
  /* A guid that is a permalink is the link. */
  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
  if (guid && !/isPermaLink\s*=\s*["']false["']/i.test(guid[1])) return decodeEntities(unwrapCdata(guid[2])).trim();
  return null;
}

function timeOf(block: string): number | null {
  for (const name of ["pubDate", "published", "dc:date", "updated", "atom:updated"]) {
    const raw = tag(block, name);
    if (!raw) continue;
    const ms = Date.parse(unwrapCdata(raw).trim());
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function parseFeed(body: string, feed: NewsFeed, nowMs: number): FeedParse {
  const text = body.length > FEED_MAX_BYTES ? body.slice(0, FEED_MAX_BYTES) : body;
  const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, FEED_MAX_ITEMS);
  const dropped = { link: 0, time: 0, text: 0, screened: 0 };
  const items: FeedItem[] = [];
  for (const [, kind, block] of blocks) {
    const atom = kind.toLowerCase() === "entry";
    const link = allowedLink((atom ? atomLink(block) : rssLink(block)) ?? "", feed);
    if (!link) {
      dropped.link += 1;
      continue;
    }
    const at = timeOf(block);
    if (at === null || at > nowMs + FUTURE_SLACK_MS || at < nowMs - ITEM_MAX_AGE_MS) {
      dropped.time += 1;
      continue;
    }
    const title = cleanText(tag(block, "title") ?? "", TITLE_MAX);
    const rawSummary = cleanText(tag(block, atom ? "summary" : "description") ?? tag(block, "content") ?? "", SUMMARY_MAX);
    if (title.length < 8) {
      dropped.text += 1;
      continue;
    }
    /* A headline that steers or orders a trade drops the item; so does a summary that steers. A summary that only sells is dropped, the headline kept. */
    const screenedSummary = screenText(rawSummary);
    if (!screenText(title).ok || (!screenedSummary.ok && screenedSummary.kind === "steering")) {
      dropped.screened += 1;
      continue;
    }
    const summary = screenedSummary.ok ? rawSummary : "";
    items.push({ feedId: feed.id, source: feed.name, title, summary, url: link, publishedAt: new Date(Math.min(at, nowMs)).toISOString() });
  }
  return { items, seen: blocks.length, dropped };
}
