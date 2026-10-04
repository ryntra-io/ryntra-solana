import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { listSpotMarkets } from "@/lib/spot/markets.server";
import type { SpotMarketListRow } from "@/lib/spot/markets";

import { DRAWN_TREND_MODES, resolveTrendMode } from "./modes";
import { pulseOf, type Pulse } from "./pulse";
import styles from "./trends.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Trends" };

const LIMIT = 50;

/**
 * Trends — where a trade or a piece of research starts: **Trends owns
 * discovery.**
 *
 * The bar draws the modes with a list behind them — Trending and Memes read
 * the ranked Jupiter universe Spot already reads (`listSpotMarkets`), so every
 * figure on a row is the provider's own: price, the day's change, volume,
 * liquidity, verification — and Stocks/RWA, which is a page of its own. New
 * and My Screeners have no source and are not drawn at all: no *Soon* tag, no
 * card about a list that does not exist, no *Being built* chip over a page
 * whose every mode works. A saved link to one of them opens Trending.
 *
 * A design pass (2026-09-15) composed the page as a market desk: the head
 * with the one line and the moment of the prices, the pulse — the most
 * traded, the biggest move, the most liquid, the day's activity, each a real
 * figure of the list itself — and the full-width list, a row per asset with
 * its picture, its figures and, on hover, where it goes: Spot, where the star,
 * the chart and the ticket are, or a plan for a stock.
 * Nothing here is a control over money.
 */
export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [locale, params] = await Promise.all([solanaServerLocale(), searchParams]);
  const uk = locale === "uk";
  const lang = uk ? "uk" : "en";
  const mode = resolveTrendMode(params.mode);
  /* A mode that became a page of its own opens that page: a saved
     `?mode=stocks` lands on Stocks, and Trends does not carry a second
     screener of the same class. */
  if (mode.movedTo) redirect(mode.movedTo);
  /* A mode with no list is not drawn, and a saved link to one opens the list
     that exists rather than a page about one that does not. */
  if (mode.source === null) redirect("/app/trends");
  const read = await listSpotMarkets(mode.source, LIMIT);
  /* The moment the prices were read, stated beside them. A valuation without a
     time is a claim about now that nobody checked.
     Rendered on the server, so the zone is named: a bare `11:50` from a
     machine in UTC reads as a wrong clock to a person in Kyiv. */
  const observedAt = read.ok ? new Date(read.observedAt).toLocaleTimeString(uk ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : null;
  const pulse = read.ok ? pulseOf(read.rows) : null;

  return (
    <section className={styles.page} aria-labelledby="trends-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <h1 id="trends-title">{uk ? "Тренди" : "Trends"}</h1>
          <p className={styles.lead}>{mode.lead[lang]}</p>
        </div>
        <div className={styles.meta}>
          {observedAt ? (
            <span className={styles.observed}>
              {uk ? `Ціни станом на ${observedAt} UTC · Jupiter` : `Prices as of ${observedAt} UTC · Jupiter`}
              {read.ok && read.stale ? (uk ? " · частина даних могла застаріти" : " · some figures may be behind") : ""}
            </span>
          ) : null}
        </div>
      </header>

      <nav className={styles.modes} aria-label={uk ? "Режими" : "Modes"}>
        {DRAWN_TREND_MODES.map((spec) => (
          <Link
            key={spec.id}
            className={styles.mode}
            href={spec.movedTo ?? (spec.id === "trending" ? "/app/trends" : `/app/trends?mode=${spec.id}`)}
            aria-current={spec.id === mode.id ? "page" : undefined}
          >
            <span>{spec.label[lang]}</span>
          </Link>
        ))}
      </nav>

      {read.ok ? (
        <>
          {pulse ? <PulseStrip pulse={pulse} locale={locale} meme={mode.id === "memes"} /> : null}
          <MarketRows rows={read.rows} locale={locale} />
        </>
      ) : (
        <p className={`${styles.card} ${styles.unavailable}`} role="status">
          {uk ? "Ринкові дані тимчасово недоступні. Спот і далі працює за живим котируванням." : "Market data is temporarily unavailable. Spot still works from the live quote."}
        </p>
      )}
    </section>
  );
}

function categoryWord(row: SpotMarketListRow, uk: boolean): string | null {
  switch (row.category) {
    case "crypto":
      return uk ? "Крипто" : "Crypto";
    case "meme":
      return uk ? "Мем" : "Meme";
    case "stock":
      return uk ? "Акція/RWA" : "Stock/RWA";
    default:
      return null;
  }
}

/**
 * The pulse — four figures of the list itself, each a real row: the most
 * traded, the biggest move of the day, the most liquid, and the day's
 * activity across the rows shown. The tiles open Spot like the rows do.
 */
function PulseStrip({ pulse, locale, meme }: { pulse: Pulse; locale: WorkspaceLocale; meme: boolean }) {
  const uk = locale === "uk";
  const numberLocale = uk ? "uk-UA" : "en-US";
  const label = (en: string, ukWord: string) => (uk ? ukWord : en);
  return (
    <div className={`${styles.card} ${styles.pulse}`} role="group" aria-label={meme ? label("Meme pulse", "Пульс мемів") : label("Market pulse", "Пульс ринку")}>
      <PulseTile row={pulse.mostTraded} label={label("Most traded", "Найбільше торгів")} figure={formatUsdCompact(pulse.mostTraded?.volume24hUsd ?? null, numberLocale)} figureWord={label("volume 24h", "обсяг 24h")} numberLocale={numberLocale} />
      <PulseTile row={pulse.biggestMove} label={label("Biggest move", "Найбільший рух")} figure={formatPercent(pulse.biggestMove?.change24hPct ?? null, numberLocale)} figureWord={label("in 24h", "за 24h")} figureTone={toneOf(pulse.biggestMove?.change24hPct ?? null)} numberLocale={numberLocale} />
      <PulseTile row={pulse.mostLiquid} label={label("Most liquid", "Найліквідніший")} figure={formatUsdCompact(pulse.mostLiquid?.liquidityUsd ?? null, numberLocale)} figureWord={label("in pools", "у пулах")} numberLocale={numberLocale} />
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{label("Activity 24h", "Активність 24h")}</span>
        <span className={styles.tileValue} translate="no">
          {formatUsdCompact(pulse.volumeUsd, numberLocale)}
        </span>
        <span className={styles.tileSub}>
          {uk ? `обсяг · ${pulse.count} активів у списку` : `volume · ${pulse.count} assets listed`}
          {pulse.up > 0 || pulse.down > 0 ? (
            <>
              {" · "}
              <span className={styles.up} translate="no">
                {pulse.up}↑
              </span>{" "}
              <span className={styles.down} translate="no">
                {pulse.down}↓
              </span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function PulseTile({ row, label, figure, figureWord, figureTone, numberLocale }: { row: SpotMarketListRow | null; label: string; figure: string; figureWord: string; figureTone?: "up" | "down" | "flat"; numberLocale: string }) {
  if (!row) {
    return (
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{label}</span>
        <span className={styles.tileValue}>—</span>
      </div>
    );
  }
  return (
    <Link className={`${styles.tile} ${styles.tileLink}`} href={`/app/spot?mint=${encodeURIComponent(row.mint)}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileAsset}>
        <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={36} className={styles.tileIcon} />
        <span className={styles.tileNames}>
          <span className={styles.tileSymbol} translate="no">
            {row.symbol}
          </span>
          <span className={styles.tilePriceRow} translate="no">
            <span className={styles.tilePrice}>{formatUsdPrice(row.price, numberLocale)}</span>
            <span className={`${styles.tileChange} ${styles[toneOf(row.change24hPct)]}`}>{formatPercent(row.change24hPct, numberLocale)}</span>
          </span>
        </span>
      </span>
      <span className={styles.tileSub}>
        <b className={figureTone ? styles[figureTone] : undefined} translate="no">
          {figure}
        </b>{" "}
        {figureWord}
      </span>
    </Link>
  );
}

/**
 * The ranked rows. Each one opens Spot, because that is where a person
 * watches, charts and trades it; the numbers are the provider's and a
 * figure the provider did not state prints a dash rather than a zero. On
 * hover the row says where else it can go: a plan, for a stock.
 */
function MarketRows({ rows, locale }: { rows: readonly SpotMarketListRow[]; locale: WorkspaceLocale }) {
  const uk = locale === "uk";
  const numberLocale = uk ? "uk-UA" : "en-US";
  if (rows.length === 0) {
    return (
      <p className={`${styles.card} ${styles.unavailable}`} role="status">
        {uk ? "У цьому режимі зараз немає активів." : "Nothing is listed in this mode right now."}
      </p>
    );
  }
  return (
    <div className={`${styles.card} ${styles.list}`}>
      <ol className={styles.rows}>
        <li className={styles.rowHead} aria-hidden="true">
          <span className={styles.cRank}>#</span>
          <span className={styles.cAsset}>
            {uk ? "Актив" : "Asset"}
            <Help topic="verified" locale={locale} />
          </span>
          <span className={styles.cPrice}>{uk ? "Ціна" : "Price"}</span>
          <span className={styles.cChange}>24h</span>
          <span className={styles.cVolume}>
            {uk ? "Обсяг 24h" : "Volume 24h"}
            <Help topic="volume" locale={locale} />
          </span>
          <span className={styles.cLiquidity}>
            {uk ? "Ліквідність" : "Liquidity"}
            <Help topic="liquidity" locale={locale} />
          </span>
          <span className={styles.cActions} />
        </li>
        {rows.map((row, index) => {
          const category = categoryWord(row, uk);
          const spotHref = `/app/spot?mint=${encodeURIComponent(row.mint)}`;
          return (
            <li key={row.mint} className={styles.row}>
              <span className={`${styles.cRank} ${styles.rank}`} translate="no">
                {index + 1}
              </span>
              <span className={styles.cAsset}>
                <Link className={styles.asset} href={spotHref}>
                  <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={32} className={styles.icon} />
                  <span className={styles.names}>
                    <span className={styles.symbol} translate="no">
                      {row.symbol}
                      {!row.verified ? <span className={styles.unverified}>{uk ? "не верифіковано" : "unverified"}</span> : null}
                    </span>
                    <span className={styles.name}>
                      {row.name}
                      {category ? <span className={styles.category}> · {category}</span> : null}
                    </span>
                  </span>
                </Link>
              </span>
              <span className={`${styles.cPrice} ${styles.num}`} translate="no">
                {formatUsdPrice(row.price, numberLocale)}
              </span>
              <span className={`${styles.cChange} ${styles.num} ${styles[toneOf(row.change24hPct)]}`} translate="no">
                {formatPercent(row.change24hPct, numberLocale)}
              </span>
              <span className={`${styles.cVolume} ${styles.num}`} translate="no">
                {formatUsdCompact(row.volume24hUsd, numberLocale)}
              </span>
              <span className={`${styles.cLiquidity} ${styles.num}`} translate="no">
                {formatUsdCompact(row.liquidityUsd, numberLocale)}
              </span>
              <span className={`${styles.cActions} ${styles.rowActions}`}>
                <Link className={styles.rowAction} href={spotHref}>
                  {uk ? "Спот" : "Spot"}
                </Link>
                {row.category === "stock" ? (
                  <Link className={`${styles.rowAction} ${styles.rowActionPrimary}`} href={`/app/strategies/new?mint=${encodeURIComponent(row.mint)}`} prefetch={false}>
                    {uk ? "План" : "Plan"}
                  </Link>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className={styles.foot}>
        <span>{uk ? `${rows.length} активів · дані Jupiter · не рейтинг і не порада купувати` : `${rows.length} assets · Jupiter's figures · not a ranking or advice to buy`}</span>
        <Link className={styles.footLink} href="/app/spot">
          {uk ? "Шукати будь-який актив у Споті" : "Search any asset in Spot"}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
