/**
 * The city's search of Jupiter's catalogue (`/api/solana/tokens/search`), read
 * through the shared read layer.
 *
 * The same words typed by several people, or by one person's search box as it
 * re-asks, were each a call against the one shared key — and after a refusal
 * for rate the box stayed empty. Now:
 *
 *  - the same query asked at once is one read;
 *  - an answer is kept thirty seconds in this instance and a minute in the
 *    platform's data cache, which every instance reads;
 *  - after a `429` the provider is not asked for its pause, and the last good
 *    answer of that query (up to ten minutes old) is served with `stale: true`
 *    and the time it was read. A query never answered is a refusal with how
 *    long to wait — never an empty list that looks like «nothing found».
 *
 * `searchTokenCatalog` itself is unchanged: this is a read over it. Every found coin says which tokenized
 * stock it passes for, if any, and such a coin stands after the rest (`markCopies`).
 */

import { searchTokenCatalog, type TokenSearchResult, type TokenSearchRow } from "../solana/catalog.ts";
import { sharedRead } from "../stocks/shared-read.ts";
import { stockBookNow } from "../stocks/stock-book.server.ts";
import { passesForStock, type PassesFor } from "../stocks/stock-book.ts";
import type { StockBook } from "../world/text-safety/lookalike.ts";
import { createSharedReads, type ReadFailure } from "./shared-reads.ts";

export const CATALOG_SEARCH_TTL_MS = 30_000;
export const CATALOG_SEARCH_SHARED_SECONDS = 60;
export const CATALOG_SEARCH_HELD_MS = 10 * 60_000;
/** A data-cache copy older than this is not taken for a new answer. */
const SHARED_MAX_AGE_MS = 2 * CATALOG_SEARCH_TTL_MS;
/** One read asks for this many rows, whatever the caller's limit: one entry per query, trimmed per answer. */
const READ_LIMIT = 50;

type Found = Extract<TokenSearchResult, { ok: true }>;
type Refused = Extract<TokenSearchResult, { ok: false }> & ReadFailure;

/**
 * A found coin, with the tokenized stock it passes for and is not: its ticker or its company's name on
 * another mint — the stock's ticker, the company and the real one's mint. Null: it passes for none.
 */
export type CatalogSearchRow = TokenSearchRow & Readonly<{ passesFor: PassesFor | null }>;

export type CatalogSearchRead =
  | Readonly<{ ok: true; rows: readonly CatalogSearchRow[]; observedAt: string; source: Found["source"]; stale: boolean }>
  | Readonly<{ ok: false; code: string; reason: string; retryAfterMs?: number | null }>;

const reads = createSharedReads<Found, Refused>({ name: "token search", provider: "jupiter", ttlMs: CATALOG_SEARCH_TTL_MS, heldMs: CATALOG_SEARCH_HELD_MS, maxKeys: 500 });

export type CatalogSearchDeps = Readonly<{
  search?: typeof searchTokenCatalog;
  /** The cross-instance layer; tests pass the read straight through. */
  shared?: <T>(key: readonly string[], seconds: number, read: () => Promise<T>, ok: (value: T) => boolean) => Promise<T>;
  /** The stocks a coin may pass for; the server's book now by default. */
  book?: () => StockBook;
}>;

/**
 * The found coins with what each passes for, a coin passing for a stock after every other: a copy of «ANT»
 * never stands above the real ANT, nor above any coin that is its own. The catalogue's order holds otherwise.
 */
export function markCopies(rows: readonly TokenSearchRow[], book: StockBook): CatalogSearchRow[] {
  const marked = rows.map((row) => ({ ...row, passesFor: row.symbol ? passesForStock({ symbol: row.symbol, name: row.name, mint: row.mint, verified: row.isVerified }, book) : null }));
  return [...marked.filter((row) => row.passesFor === null), ...marked.filter((row) => row.passesFor !== null)];
}

async function readOnce(query: string, deps: CatalogSearchDeps): Promise<Readonly<{ ok: true; value: Found; readAt: number }> | Refused> {
  const search = deps.search ?? searchTokenCatalog;
  const shared = deps.shared ?? sharedRead;
  const direct = async () => {
    const result = await search(query, READ_LIMIT);
    return result.ok ? { ok: true as const, value: result, readAt: Date.parse(result.observedAt) || Date.now() } : (result as Refused);
  };
  let answer: Awaited<ReturnType<typeof direct>>;
  try {
    answer = await shared(["catalog-search", query], CATALOG_SEARCH_SHARED_SECONDS, direct, (value) => value.ok);
  } catch {
    return direct();
  }
  if (answer.ok && Date.now() - answer.readAt > SHARED_MAX_AGE_MS) return direct();
  return answer;
}

/** Find an asset by ticker, name or mint; never throws. */
export async function searchCatalogShared(query: string, limit: number, deps: CatalogSearchDeps = {}): Promise<CatalogSearchRead> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return { ok: false, code: "MALFORMED", reason: "A token search needs one to sixty-four characters." };
  const read = await reads.read(trimmed, () => readOnce(trimmed, deps));
  if (!read.ok) return read;
  const rows = markCopies(read.value.rows, (deps.book ?? stockBookNow)()).slice(0, limit);
  return { ok: true, rows, observedAt: new Date(read.readAt).toISOString(), source: read.value.source, stale: read.stale };
}

/** Test seam. */
export function resetCatalogSearch(): void {
  reads.reset();
}
