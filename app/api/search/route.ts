import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import type { SearchIndex } from "@/lib/search/product-search";
import { coinShelf, memeShelf, USDC_MINT, USDT_MINT } from "@/lib/spot/coin-shelf";
import { withoutOffensiveNames } from "@/lib/spot/offensive-names";
import { toListRow } from "@/lib/spot/markets";
import { listSpotMarkets, readSpotMarket, spotListEdgeSeconds } from "@/lib/spot/markets.server";
import { shelfCompanies, shelfPrivateCompanies } from "@/lib/stocks/shelf";
import { readStockUniverse } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A list refresh that outlives its answer runs inside this invocation (`after`): the universe's slowest honest read is about 44 s. */
export const maxDuration = 60;

/**
 * The index the product's search reads: the same lists Markets draws — one
 * company, one card, from the stock universe; the venue's verified crypto and
 * memes; the two dollars — trimmed to what a search shows. Read-only and
 * wallet-free, built from reads the server already keeps warm, cached briefly
 * at the edge because every visitor sees the same index. A list whose source
 * did not answer is empty and `partial` says so; the search then finds the
 * actions and what did answer.
 */

const COINS = 80;
const MEMES = 60;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const [universe, crypto, memes, ...dollars] = await Promise.all([
    readStockUniverse(),
    listSpotMarkets("crypto", 400),
    listSpotMarkets("meme", 200),
    ...[USDC_MINT, USDT_MINT].map((mint) => readSpotMarket(mint)),
  ]);
  const dollarRows = dollars.flatMap((answer) => (answer.ok && answer.market ? [toListRow(answer.market)] : []));
  const shelf = coinShelf([...(crypto.ok ? crypto.rows : []), ...dollarRows]);
  const index: SearchIndex = {
    companies: universe.ok ? shelfCompanies(universe.universe.rows) : [],
    privateCompanies: universe.ok ? shelfPrivateCompanies(universe.universe.rows) : [],
    /* A token named with a hate word is not offered (B2b): the index fills Home's «Ринки зараз» and the search. */
    coins: withoutOffensiveNames(shelf.crypto).slice(0, COINS),
    memes: memes.ok ? withoutOffensiveNames(memeShelf(memes.rows)).slice(0, MEMES) : [],
    dollars: shelf.dollars,
  };
  const partial = !universe.ok || !crypto.ok || !memes.ok;
  if (!universe.ok && !crypto.ok && !memes.ok && dollarRows.length === 0) return failure(503, "SEARCH_UNAVAILABLE", "No market list answered.", rate);
  /* The coins' and memes' prices are kept at the edge no longer than they stay fresh (SOL-D1), and not at all when stale. */
  const lists = [crypto, memes].filter((read) => read.ok);
  const stale = lists.some((read) => read.stale);
  const edge = lists.length > 0 ? spotListEdgeSeconds(lists.map((read) => read.oldestReadAt).sort()[0], Date.now()) : { ttl: 60, revalidate: 300 };
  return Response.json(
    { ...index, partial, readAt: new Date().toISOString() },
    { headers: partial || stale || !edge ? { ...rateLimitHeaders(rate), ...privateNoStoreHeaders() } : { ...publicCacheHeaders(edge.ttl, edge.revalidate), ...rateLimitHeaders(rate) } },
  );
}
