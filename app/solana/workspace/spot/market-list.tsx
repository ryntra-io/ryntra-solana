"use client";

import { MagnifyingGlass, Star } from "@phosphor-icons/react";
import Image from "next/image";
import { useState } from "react";

import type { SpotMarketListRow, SpotView } from "@/lib/spot/markets";
import { spotListNoticeVisible } from "@/lib/spot/read-retry";

import { useSolanaI18n } from "../i18n/provider.tsx";
import type { MarketListRead, WatchlistSync } from "./use-spot-data.ts";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "./spot-format.ts";

import styles from "./spot.module.css";

export const SPOT_VIEW_ORDER: readonly SpotView[] = ["all", "crypto", "meme", "stock", "watchlist"];

export function viewLabel(view: SpotView, text: (english: string) => string): string {
  switch (view) {
    case "all":
      return text("All");
    case "crypto":
      return text("Crypto");
    case "meme":
      return text("Memes");
    case "stock":
      return text("Stocks/RWA");
    case "watchlist":
      return text("Watchlist");
  }
}

/**
 * A token's icon, through `/api/spot/icon` and next/image — the site's CSP
 * allows images from itself, and the catalogue's icons live on four hundred
 * hosts. The catalogue's own address goes back with the request, so a
 * serverless instance that never read the list can still fetch the picture;
 * the route accepts only a public https address; next/image resizes what
 * comes back once, so a 1.5 MB upload behind a 28 px avatar is served small.
 * Two letters stand in where there is no icon, or where the host would not
 * answer.
 */
export function MarketIcon({ mint, icon, symbol, size = 28, className, plain = false }: { mint: string; icon: string | null; symbol: string; size?: number; className?: string; /** Serve the file as it is from the start — for icons from hosts the optimiser is known to refuse. */ plain?: boolean }) {
  /* Optimised first; the plain route when the optimiser will not take the
     file (an SVG, an odd encoding); two letters when the host will not answer. */
  const [mode, setMode] = useState<Readonly<{ mint: string; step: "plain" | "broken" }> | null>(null);
  /* An SVG never goes to the optimiser: it refuses the format with a 400 on every
     load (INVALID_IMAGE_OPTIMIZE_REQUEST) and the fallback below already served
     the file plain — the detour cost one failed request and a console error per
     icon. The issuers that publish SVG logos are known by their URLs; anything
     else is optimised first as before. */
  const svg = icon !== null && (/\.svg(\?|$)/i.test(icon) || icon.startsWith("https://backpack.exchange/api/stock-logo/"));
  const step = mode && mode.mint === mint ? mode.step : svg || plain ? "plain" : "optimized";
  if (!icon || step === "broken") return <span className={className ?? styles.iconFallback} aria-hidden="true">{symbol.slice(0, 2)}</span>;
  const src = icon.startsWith("https://")
    ? `/api/spot/icon?mint=${encodeURIComponent(mint)}&u=${encodeURIComponent(icon)}`
    : `/api/spot/icon?mint=${encodeURIComponent(mint)}`;
  if (step === "plain") {
    // eslint-disable-next-line @next/next/no-img-element -- the optimiser refused this file; the route serves it as it is
    return <img className={className ?? styles.icon} src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setMode({ mint, step: "broken" })} />;
  }
  return <Image className={className ?? styles.icon} src={src} alt="" width={size} height={size} loading="lazy" onError={() => setMode({ mint, step: "plain" })} />;
}

/**
 * The market column — search, the market switch, one ranked list, one star.
 *
 * Every figure in a row is the provider's own: the price and the day's change
 * from Jupiter's stats, the volume in Pro. A row the provider did not price
 * prints a dash where the price would be, never a zero.
 */
export function MarketList({
  view,
  onView,
  query,
  onQuery,
  list,
  selectedMint,
  onSelect,
  isStarred,
  onStar,
  sync,
  onProve,
  proving,
  pro,
  autoFocus,
}: {
  /** Null until the kept view is known; nothing is pressed and nothing is read. */
  view: SpotView | null;
  onView: (view: SpotView) => void;
  query: string;
  onQuery: (query: string) => void;
  list: MarketListRead;
  selectedMint: string | null;
  onSelect: (row: SpotMarketListRow) => void;
  isStarred: (mint: string) => boolean;
  onStar: (mint: string) => void;
  sync: WatchlistSync;
  onProve: () => void;
  proving: boolean;
  pro: boolean;
  autoFocus?: boolean;
}) {
  const { text, locale } = useSolanaI18n();
  const rows = list.value ?? [];
  const searching = query.trim().length > 0;

  return (
    <>
      <div className={styles.marketsHead}>
        <div className={styles.searchRow}>
          <label className={styles.search}>
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={text("Search by name, ticker or address")}
              aria-label={text("Search markets")}
              autoComplete="off"
              spellCheck={false}
              autoFocus={autoFocus}
            />
          </label>
          {/* The watchlist is its star, beside the search rather than in the
              category row: the mark a person pressed to fill the list, and a
              word that is long in Ukrainian. Pressing it again returns to
              All. */}
          <button
            type="button"
            className={styles.watchToggle}
            aria-pressed={view === "watchlist"}
            aria-label={viewLabel("watchlist", text)}
            title={viewLabel("watchlist", text)}
            onClick={() => onView(view === "watchlist" ? "all" : "watchlist")}
          >
            <Star size={16} weight={view === "watchlist" ? "fill" : "regular"} aria-hidden="true" />
          </button>
        </div>
        {searching ? null : (
          <div className={styles.views} role="group" aria-label={text("Market")}>
            {SPOT_VIEW_ORDER.filter((entry) => entry !== "watchlist").map((entry) => (
              <button key={entry} type="button" className={styles.view} aria-pressed={view === entry} onClick={() => onView(entry)}>
                {viewLabel(entry, text)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.marketsBody}>
        {/* A read that failed is being asked again on its own; the column says
            *Loading* through the quick retries and only then that the list is
            unavailable, with a button that asks now. */}
        {list.status === "unavailable" && rows.length === 0 && spotListNoticeVisible(list.failures) ? (
          <p className={styles.listNote}>
            <b>{text("The market list is unavailable right now.")}</b>
            {text("Search still works; try again in a moment.")}
            <button type="button" className={styles.ghost} onClick={list.retry}>{text("Try again")}</button>
          </p>
        ) : (list.status === "loading" || list.status === "unavailable") && rows.length === 0 ? (
          <p className={styles.listNote}>{text("Loading markets…")}</p>
        ) : rows.length === 0 ? (
          <p className={styles.listNote}>
            {searching ? (
              <>
                <b>{text("Nothing found.")}</b>
                {text("Try the ticker, the full name or the mint address.")}
              </>
            ) : view === "watchlist" ? (
              <>
                <b>{text("Your watchlist is empty.")}</b>
                {text("Star a market and it stays here.")}
              </>
            ) : (
              text("No markets in this category right now.")
            )}
          </p>
        ) : (
          <ul>
            {rows.map((row) => {
              const tone = toneOf(row.change24hPct);
              const starred = isStarred(row.mint);
              return (
                <li key={row.mint} className={styles.row} aria-current={row.mint === selectedMint ? "true" : undefined}>
                  <button type="button" className={styles.rowMain} onClick={() => onSelect(row)}>
                    <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={32} />
                    <span className={styles.rowName}>
                      <b>{row.symbol}</b>
                      {/* A flag first, because it is the one thing a person
                          must not miss; then the name; the day's volume
                          last, and only where the column is wide enough to
                          carry it without cutting the name. */}
                      <span className={styles.rowSub}>
                        <span className={styles.rowNameText}>
                          {[row.suspicious ? text("Flagged") : row.verified ? null : text("Unverified"), row.name]
                            .filter((part): part is string => part !== null)
                            .join(" · ")}
                        </span>
                        {pro && row.volume24hUsd !== null ? <span className={styles.rowVol}>· {text("Vol")} {formatUsdCompact(row.volume24hUsd, locale)}</span> : null}
                      </span>
                    </span>
                    <span className={styles.rowNumbers}>
                      <b>{formatUsdPrice(row.price, locale)}</b>
                      <span className={tone === "up" ? styles.up : tone === "down" ? styles.down : styles.flat}>{formatPercent(row.change24hPct, locale)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.star}
                    aria-pressed={starred}
                    aria-label={starred ? `${text("Remove from watchlist")}: ${row.symbol}` : `${text("Add to watchlist")}: ${row.symbol}`}
                    onClick={() => onStar(row.mint)}
                  >
                    <Star size={16} weight={starred ? "fill" : "regular"} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {view === "watchlist" && sync === "unproven" ? (
        <div className={styles.syncLine}>
          <span>{text("Kept in this browser.")}</span>
          <button type="button" className={styles.ghost} onClick={onProve} disabled={proving}>
            {proving ? text("Waiting for wallet…") : text("Sync across devices")}
          </button>
        </div>
      ) : view === "watchlist" && sync === "offline" ? (
        <div className={styles.syncLine}>
          <span>{text("Saved here; sync will retry.")}</span>
        </div>
      ) : null}
    </>
  );
}
