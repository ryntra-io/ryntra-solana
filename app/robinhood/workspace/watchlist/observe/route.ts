import { NextResponse, type NextRequest } from "next/server";

import { getMarkets, getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import { buildRadar, type RadarRow } from "@/lib/markets/radar";
import { MAX_ENTRIES, isAddress, watchKey, type ChainRead, type Observation } from "@/lib/markets/watch";
import { readStockTokenOnchain } from "@/lib/rwa/stock-token";

/**
 * The current state of the addresses a watchlist holds.
 *
 * The list itself lives in the browser, so the server cannot know which
 * instruments to describe until it is told. This route is that conversation:
 * up to 25 addresses in, one observation each out — the venue's row, the perps
 * market if there is one, and the on-chain corporate-action read.
 *
 * **The chain read is why the cap exists.** Each entry costs four `eth_call`s;
 * 100 of them returned in 632 ms measured against Robinhood Chain on
 * 2026-08-19, which is what makes per-entry corporate-action reads affordable
 * here and unaffordable over the 231-instrument universe the Scanner covers.
 * The bound is a product decision with a measured reason, not a guess.
 *
 * Every address is validated as 20 bytes of hex before it reaches a fetch. A
 * value from `localStorage` is untrusted input in exactly the way a URL is.
 */
export const dynamic = "force-dynamic";

function listOf(raw: unknown, key: string): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const wanted: string[] = [];
  for (const raw of request.nextUrl.searchParams.getAll("a")) {
    if (!isAddress(raw)) continue;
    const key = watchKey(raw);
    if (!wanted.includes(key)) wanted.push(key);
    if (wanted.length >= MAX_ENTRIES) break;
  }

  const at = Date.now();
  if (wanted.length === 0) {
    return NextResponse.json({ at, observations: [] as Observation[] });
  }

  let rows: readonly RadarRow[] = [];
  let perps: readonly { baseAsset: string; status: string; isOutsideRth?: boolean | null }[] = [];
  try {
    const [tokensRaw, overviewRaw, marketsRaw] = await Promise.all([
      getSpotTokens(),
      getSpotOverview(),
      /* Market hours narrow rather than fail: a perps outage costs the
         underlying-closes condition its coverage and nothing else. */
      getMarkets().catch(() => [] as never[]),
    ]);
    const tokens = listOf(tokensRaw, "tokens");
    const overview = listOf(overviewRaw, "overview");
    if (!tokens || !overview) {
      return NextResponse.json(
        { at, error: "The venue answered in a shape this product does not recognise, so nothing is described rather than described wrongly." },
        { status: 502 },
      );
    }
    rows = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS);
    perps = marketsRaw as never[];
  } catch {
    return NextResponse.json({ at, error: "The venue's endpoints did not answer, so nothing below is current." }, { status: 502 });
  }

  const byAddress = new Map(rows.map((row) => [watchKey(row.address), row]));
  const byBaseAsset = new Map(perps.map((market) => [market.baseAsset, market]));

  const observations = await Promise.all(
    wanted.map(async (address): Promise<Observation> => {
      const row = byAddress.get(address) ?? null;
      const market = row ? byBaseAsset.get(row.symbol) : undefined;

      /* `readStockTokenOnchain` throws for anything that is not a Stock Token,
         which is the gate rather than a failure: a community token has no
         multiplier and must not be given a fabricated one. */
      const chain: ChainRead | null = row
        ? await readStockTokenOnchain(row.address)
            .then((read) => ({
              uiMultiplier: read.uiMultiplier.toString(),
              newUiMultiplier: read.newUiMultiplier === null ? null : read.newUiMultiplier.toString(),
              effectiveAt: read.effectiveAt,
              oraclePaused: read.oraclePaused,
            }))
            .catch(() => null)
        : null;

      return {
        address,
        row,
        market: market ? { status: market.status, isOutsideRth: market.isOutsideRth ?? null } : null,
        chain,
        at,
      };
    }),
  );

  return NextResponse.json({ at, observations });
}
