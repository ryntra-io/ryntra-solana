import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/**
 * How many times a personal link was opened — the first step of a partner's
 * funnel, and nothing about whoever opened it.
 *
 * One number per code per day (UTC): no address, no IP, no browser id is
 * stored. The link route counts an open only when it is a person's first in
 * that browser (the code not remembered there yet, or remembered more than a
 * day ago), so a reload is not a second open; never a link preview a network
 * fetches for a post (`isLinkPreview`); never the owner of the code opening
 * their own link; never more than a few from one address a minute (a limit
 * kept in memory, `openCountAllowed`); never past a cap per code per day; and
 * never for a code nobody owns, so random codes write nothing. A rough count:
 * the funnel calls it opens, not people. The count is written after the redirect is
 * sent: it never stands between a person and the page they asked for.
 */

export const LINK_OPENS_COLLECTION = "growthLinkOpens" as const;

export type LinkOpensDay = Readonly<{ version: number; code: string; day: string; opens: number }>;

/** The day of a moment, UTC, `YYYY-MM-DD`. */
export function openDay(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error("An open needs a readable moment.");
  return new Date(ms).toISOString().slice(0, 10);
}

export function linkOpensKey(code: string, day: string): string {
  return `${code}:${day}`;
}

/** Opens one code counts in a day at most: a rough count, never one a loop can run up without end. */
export const OPENS_PER_CODE_PER_DAY = 500;

/** Count one open of `code` on the day of `now` — up to the day's cap. */
export async function recordLinkOpen(store: GuardStore, code: string, now: string): Promise<void> {
  const day = openDay(now);
  const key = linkOpensKey(code, day);
  const collection = store.versioned<LinkOpensDay>(LINK_OPENS_COLLECTION);
  await withBoundedCasRetry(async () => {
    const current = await collection.get(key);
    if ((current?.opens ?? 0) >= OPENS_PER_CODE_PER_DAY) return true;
    const next: LinkOpensDay = { version: (current?.version ?? 0) + 1, code, day, opens: (current?.opens ?? 0) + 1 };
    return collection.compareAndSet(key, current?.version ?? null, next);
  });
}

/**
 * Every open of `code` and the first day one was counted (null — none yet).
 * Rows of another code that share the prefix are not this code's.
 */
export async function readLinkOpens(store: GuardStore, code: string): Promise<Readonly<{ opens: number; since: string | null }>> {
  const rows = await store.collection<LinkOpensDay>(LINK_OPENS_COLLECTION).valuesWithPrefix(`${code}:`);
  let opens = 0;
  let since: string | null = null;
  for (const row of rows) {
    if (row.code !== code || !Number.isInteger(row.opens) || row.opens < 0) continue;
    opens += row.opens;
    if (since === null || row.day < since) since = row.day;
  }
  return { opens, since };
}

/**
 * A link preview fetched by a network or a messenger for a post — not a person
 * opening the link. Matched on the fetchers' own published user agents.
 */
const PREVIEW_AGENTS = /bot\b|crawler|spider|preview|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|whatsapp|linkedinbot|embedly|skypeuripreview|vkshare|pinterest|redditbot|applebot|googlebot|bingbot|yandex|baiduspider|headlesschrome|curl\/|wget\/|python-requests|node-fetch|undici|axios|go-http-client|okhttp/i;

export function isLinkPreview(userAgent: string | null | undefined): boolean {
  return !userAgent || PREVIEW_AGENTS.test(userAgent);
}

/** Opens one address may count in a minute: a person opening a few links, never a loop. */
export const OPENS_PER_ADDRESS_PER_MINUTE = 5;

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
const MAX_ADDRESSES = 5_000;

/**
 * Whether an open from this address may be counted now. Kept in this
 * instance's memory only, by address, for a minute; nothing is stored.
 */
export function openCountAllowed(address: string, nowMs: number = Date.now()): boolean {
  const key = address.slice(0, 64) || "unknown";
  const current = windows.get(key);
  if (!current || current.resetAt <= nowMs) {
    if (windows.size >= MAX_ADDRESSES) {
      for (const [stale, entry] of windows) if (entry.resetAt <= nowMs) windows.delete(stale);
      if (windows.size >= MAX_ADDRESSES) windows.delete(windows.keys().next().value!);
    }
    windows.set(key, { count: 1, resetAt: nowMs + 60_000 });
    return true;
  }
  if (current.count >= OPENS_PER_ADDRESS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}
