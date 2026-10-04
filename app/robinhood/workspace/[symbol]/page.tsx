import Link from "next/link";
import { notFound } from "next/navigation";

import { getOracleFeeds, getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import { readOracleReading, readStockTokenOnchain } from "@/lib/rwa/stock-token";
import { corporateActionStatus } from "@/lib/token/ui-multiplier";
import { buildRadar, isTradable, type RadarRow } from "@/lib/markets/radar";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import {
  CORPORATE_ACTION_WORDING,
  economicRepresentation,
  type EconomicRepresentation,
} from "@/lib/markets/passport";
import "../markets.css";
import "./passport.css";

export const dynamic = "force-dynamic";

/**
 * The Asset Passport.
 *
 * Its whole subject is that **two of the numbers here are not measuring the
 * same thing.** A Stock Token carries an on-chain `uiMultiplier`; the oracle
 * feed price already bakes it in, while the venue's REST quote is the raw
 * underlying share. `AAPL` reads `1.000566080061` today and five of forty
 * sampled equities are already off unity, so this is a live condition rather
 * than a future one.
 *
 * The page therefore never prints one price. It prints the token price, the
 * per-share equivalent derived by dividing the multiplier back out, and the
 * venue's own quote — each labelled by what it measures — and compares only the
 * two that share a basis. `lib/markets/passport.ts` refuses the other
 * comparison rather than trusting this file to remember.
 *
 * Every fact carries its own source, and there is no composite score. That is
 * the rule for a Passport: facts and evidence, not advice.
 */

function listOf(raw: unknown, key: string): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

const money = (n: number) =>
  n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : `$${n.toPrecision(4)}`;

function Fact({ label, value, source }: { label: string; value: React.ReactNode; source: string }) {
  return (
    <div className="pp-fact">
      <dt>{label}</dt>
      <dd>
        {value}
        <span className="pp-source">{source}</span>
      </dd>
    </div>
  );
}

function Prices({ rep }: { rep: EconomicRepresentation }) {
  return (
    <>
      <div className="pp-prices">
        <div className="pp-price">
          <span className="pp-price-label">Token price</span>
          <span className="pp-price-value">
            {rep.tokenPrice.known ? money(rep.tokenPrice.value.value) : <em>Unknown</em>}
          </span>
          <span className="pp-basis">what one token is worth · oracle feed, multiplier already applied</span>
        </div>
        <div className="pp-price">
          <span className="pp-price-label">Per underlying share</span>
          <span className="pp-price-value">
            {rep.perShareEquivalent.known ? money(rep.perShareEquivalent.value.value) : <em>Unknown</em>}
          </span>
          <span className="pp-basis">derived: token price with the multiplier divided back out</span>
        </div>
        <div className="pp-price">
          <span className="pp-price-label">Venue quote</span>
          <span className="pp-price-value">
            {rep.venueQuote.known ? money(rep.venueQuote.value.value) : <em>Unknown</em>}
          </span>
          <span className="pp-basis">the raw underlying share, as the venue reports it</span>
        </div>
      </div>

      <p className="pp-explain">
        <b>The first two are different measurements, not a spread.</b> This token&rsquo;s multiplier is{" "}
        <span className="pp-mono">{rep.multiplierX.toFixed(12)}</span>
        {rep.hasDrift ? (
          <>
            {" "}
            — above 1.0 because corporate actions have been absorbed into it. The token standing above the
            share price is the design working, and it is not a premium to trade.
          </>
        ) : (
          <> — still exactly 1.0, so the two happen to agree today. They will not after the first dividend.</>
        )}
      </p>

      {rep.underlyingDivergence?.comparable ? (
        <p className="pp-explain">
          Against the venue&rsquo;s own quote, share for share, the difference is{" "}
          <span className="pp-mono">{rep.underlyingDivergence.percent.toFixed(3)}%</span>. That is the only
          comparison on this page, because it is the only pair measuring the same thing.
        </p>
      ) : (
        <p className="pp-explain">
          No share-for-share comparison is shown: {rep.underlyingDivergence?.reason ?? "one of the two figures could not be read."}
        </p>
      )}
    </>
  );
}

export default async function AssetPassportPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const wanted = decodeURIComponent(symbol).toUpperCase();

  const [tokensRaw, overviewRaw, feedsRaw] = await Promise.all([
    getSpotTokens().catch(() => null),
    getSpotOverview().catch(() => null),
    getOracleFeeds().catch(() => null),
  ]);

  const tokens = listOf(tokensRaw, "tokens");
  const overview = listOf(overviewRaw, "overview");
  if (!tokens || !overview) {
    return (
      <main className="rm">
        <p className="rm-outage">
          The venue&rsquo;s endpoints did not answer, so this asset cannot be described. Nothing is shown
          rather than shown stale.
        </p>
      </main>
    );
  }

  const rows: readonly RadarRow[] = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS);
  const row = rows.find((entry) => entry.symbol.toUpperCase() === wanted);
  if (!row) notFound();

  /* Only a Stock Token has a multiplier. `readStockTokenOnchain` throws for
     anything else, which is the gate rather than a failure — a community token
     gets the Passport its evidence supports instead of an equity one with
     empty rows. */
  const chain = await readStockTokenOnchain(row.address).catch(() => null);

  const feeds = (feedsRaw && typeof feedsRaw === "object" ? (feedsRaw as Record<string, unknown>).feeds ?? feedsRaw : null) as
    | Record<string, { proxy: string; decimals: number; heartbeat?: number }>
    | null;
  const feed = feeds?.[row.symbol] ?? null;
  const oracle = feed ? await readOracleReading(feed.proxy, feed.decimals).catch(() => null) : null;

  const rep = economicRepresentation({
    uiMultiplier: chain?.uiMultiplier ?? null,
    oracleTokenPrice: typeof oracle?.price === "number" ? oracle.price : null,
    venueQuotePrice: row.price.known ? row.price.value : null,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const caStatus = chain
    ? corporateActionStatus(
        { uiMultiplier: chain.uiMultiplier, newUiMultiplier: chain.newUiMultiplier, effectiveAt: chain.effectiveAt },
        nowSec,
      )
    : "unknown";

  return (
    <main className="rm pp">
      <nav className="pp-back">
        <Link href="/robinhood/workspace">← Radar</Link>
        {/* A plain link, not a button that writes storage from here. The
            watchlist is keyed by the contract address, so the address is what
            travels — and the entry's first observation is taken by the
            surface that owns it, rather than assembled twice in two places. */}
        <Link href={`/robinhood/workspace/watchlist?add=${encodeURIComponent(row.address)}`}>Watch this asset →</Link>
      </nav>

      <header className="rm-head">
        <h1 className="rm-h1">
          {row.symbol} <span className="pp-name">{row.name}</span>
        </h1>
        <p className="rm-lead">
          {row.instrumentClass === "STOCK_TOKEN"
            ? "A tokenized equity on Robinhood Chain. Its price and its underlying share price are two different measurements, and both are below."
            : "A token on Robinhood Chain. What this Passport can say is bounded by what the venue and the chain report about it."}
        </p>
      </header>

      {chain ? (
        <section>
          <h2 className="rm-h2">Price, on both bases</h2>
          <Prices rep={rep} />
        </section>
      ) : (
        <section>
          <h2 className="rm-h2">Price</h2>
          <div className="pp-prices">
            <div className="pp-price">
              <span className="pp-price-label">Venue quote</span>
              <span className="pp-price-value">
                {row.price.known ? money(row.price.value) : <em>Unknown</em>}
              </span>
              <span className="pp-basis">the venue&rsquo;s own quote · arcus:spot-overview</span>
            </div>
          </div>
          <p className="pp-explain">
            This token carries no on-chain <span className="pp-mono">uiMultiplier</span>, so there is no
            second basis to reconcile and no per-share equivalent to derive. One price is shown because one
            price is what exists.
          </p>
        </section>
      )}

      <section>
        <h2 className="rm-h2">Identity</h2>
        <dl className="pp-facts">
          <Fact label="Symbol" value={row.symbol} source="arcus:spot-tokens" />
          <Fact label="Name" value={row.name} source="arcus:spot-tokens" />
          <Fact label="Contract" value={<span className="pp-mono pp-addr">{row.address}</span>} source="arcus:spot-tokens" />
          <Fact label="Network" value="Robinhood Chain · 4663" source="arcus:spot-tokens" />
          <Fact
            label="Class"
            value={
              row.instrumentClass === "STOCK_TOKEN"
                ? "Stock token"
                : row.instrumentClass === "GENERIC_ERC20"
                  ? "Crypto"
                  : "Community token"
            }
            source={
              row.origin.agreed
                ? `venue category: ${row.origin.venueCategory}`
                : `venue endpoints disagree: ${row.origin.tokenCategory} / ${row.origin.overviewCategory}`
            }
          />
          <Fact
            label="Venue verification"
            value={row.venueVerified ? "Verified by the venue" : "Not verified by the venue"}
            source="arcus:spot-tokens · verified flag"
          />
        </dl>
      </section>

      {chain && (
        <section>
          <h2 className="rm-h2">Economic representation</h2>
          <dl className="pp-facts">
            <Fact
              label="uiMultiplier"
              value={<span className="pp-mono">{rep.multiplierX.toFixed(12)}</span>}
              source="chain:uiMultiplier() · 18 dp, 1e18 = 1.0"
            />
            <Fact
              label="What it means"
              value={`One token represents ${rep.multiplierX.toFixed(6)} underlying shares. Tokens do not rebase — a raw balance stays fixed and this scales the share-equivalent view.`}
              source="ERC-8056"
            />
            <Fact
              label="Scheduled multiplier"
              value={
                chain.newUiMultiplier == null ? (
                  <em>Unknown — the read failed</em>
                ) : (
                  <span className="pp-mono">{(Number(chain.newUiMultiplier / 10n ** 6n) / 1e12).toFixed(12)}</span>
                )
              }
              source="chain:newUIMultiplier()"
            />
            <Fact
              label="Effective at"
              value={
                chain.effectiveAt == null ? (
                  <em>Unknown — the read failed</em>
                ) : chain.effectiveAt === 0 ? (
                  "No change scheduled"
                ) : (
                  new Date(chain.effectiveAt * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
                )
              }
              source="chain:effectiveAt()"
            />
          </dl>
        </section>
      )}

      <section>
        <h2 className="rm-h2">Corporate actions</h2>
        <dl className="pp-facts">
          <Fact
            label="Status"
            value={<span className={caStatus === "unknown" ? "rm-warn" : undefined}>{CORPORATE_ACTION_WORDING[caStatus]}</span>}
            source={chain ? "chain:newUIMultiplier() and effectiveAt()" : "no on-chain multiplier on this token"}
          />
          {chain && (
            <Fact
              label="Oracle"
              value={
                chain.oraclePaused == null ? (
                  <em>Unknown — the read failed, and that is not treated as running</em>
                ) : chain.oraclePaused ? (
                  <span className="rm-warn">Paused</span>
                ) : (
                  "Running"
                )
              }
              source="chain:oraclePaused()"
            />
          )}
        </dl>
      </section>

      <section>
        <h2 className="rm-h2">Routes</h2>
        <dl className="pp-facts">
          <Fact
            label="Through Ryntra"
            value={
              isTradable(row.tradability)
                ? "Executable — this product holds a pre-signed route and the venue returns a live price."
                : "Listed only. No pre-signed route here, or no live price, so it cannot be traded through Ryntra."
            }
            source="lib/arcus/spot-exec-policy.ts · pre-sign allowlist"
          />
          <Fact
            label="0x"
            value="Not integrated. It is a registered direction with no adapter."
            source="lib/product/ecosystems.ts"
          />
        </dl>
      </section>
    </main>
  );
}
