import Link from "next/link";

import { getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import { buildRadar } from "@/lib/markets/radar";
import { MAX_ENTRIES } from "@/lib/markets/watch";
import { Watchlist, type UniverseEntry } from "./list";
import "../markets.css";
import "./watchlist.css";

/**
 * The Watchlist — the fourth Discover surface, and the one that is not
 * a query at all.
 *
 * Radar pushes. The Screener answers a question asked once. The Scanner keeps
 * asking across the universe. This one is narrow on purpose: a person names a
 * handful of instruments, and the product remembers **what happened to them**.
 *
 * The server's whole job here is the index of what may be watched — symbol,
 * name and contract address for the 231 listed instruments. The entries
 * themselves live in the browser, because there is no account store in this
 * product; the observations they are reconciled against come back from
 * `observe/route.ts`, which keeps the universe and the chain reads on the
 * server where they belong.
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

export default async function WatchlistPage() {
  let universe: UniverseEntry[] = [];
  let outage: string | null = null;

  try {
    const [tokensRaw, overviewRaw] = await Promise.all([getSpotTokens(), getSpotOverview()]);
    const tokens = listOf(tokensRaw, "tokens");
    const overview = listOf(overviewRaw, "overview");
    if (!tokens || !overview) {
      outage = "The venue answered in a shape this product does not recognise, so nothing can be added rather than the wrong thing added.";
    } else {
      universe = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS)
        .map((row) => ({ symbol: row.symbol, name: row.name, address: row.address }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  } catch {
    outage = "The venue's endpoints did not answer, so the list of instruments that can be watched is unavailable.";
  }

  return (
    <main className="rm">
      <header>
        <h1 className="rm-h1">Watchlist</h1>
        <p className="rm-lead">
          Not a star. An entry is keyed by the token&rsquo;s <strong>contract address</strong>, so the symbol, the name,
          the class, the venue&rsquo;s verification, the routes, the price and the on-chain multiplier are all things it{" "}
          <em>observes</em> — and every change becomes an event in its history rather than an overwrite. A rename does
          not orphan an entry and a delisting does not delete one.
        </p>
        <p className="rm-note">
          Alerts here are conditions, not price pings. When one fires, the line you read is the condition — the figure
          that made it true sits beside it with the feed and field it came from. The{" "}
          <Link className="rm-inline" href="/robinhood/workspace/scanner">
            Scanner
          </Link>{" "}
          asks the same kind of question across all 231 instruments; this asks deeper questions about {MAX_ENTRIES} of
          them, and the difference is what a per-entry on-chain read costs.
        </p>
      </header>

      {outage ? <p className="rm-outage">{outage}</p> : null}

      <Watchlist universe={universe} />
    </main>
  );
}
