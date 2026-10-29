import type { DataStatus } from "@ryntra/core/adapters";
import { MiniBars, type BarDatum } from "@ryntra/core/chart/compact";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";
import type { BinsRead } from "@/lib/liquidity/catalog/chain.server";

import { formatPoolPrice } from "./pool-format";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

/** How long the server keeps a read of a pool's bins (`chain.server.ts`). */
const BINS_READ_MS = 20_000;

/** The bins' status: Ryntra's own read of the pool's accounts on the Solana chain, at most `BINS_READ_MS` old when read. */
export function binsStatus(bins: BinsRead, now: number = Date.now()): DataStatus {
  const at = Math.min(now, bins.at);
  return {
    state: "delayed",
    market: "open",
    source: { id: "solana-chain", label: "Solana", attribution: null, rights: "display" },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: BINS_READ_MS,
    derived: true,
  };
}

/**
 * DLMM's bins around the price as bars — the core's compact bars (`@ryntra/core/chart/compact`, CH-17): each bar is
 * what the bin holds, valued in Y at the bin's price. Bins under the price hold Y, bins over it hold X, the active bin
 * both — two tones and the active one in the text's colour, its readout on a pointer or the keyboard, three prices under
 * the axis.
 */
export function BinsChart({ bins, xSymbol, ySymbol, locale }: { bins: BinsRead; xSymbol: string; ySymbol: string; locale: WorkspaceLocale }) {
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const rows = bins.bins.filter((bin) => Number.isFinite(bin.price) && bin.price > 0);
  if (rows.length === 0) return <p className={styles.note}>{word("distributionDown")}</p>;
  const bars: BarDatum[] = rows.map((bin) => {
    const value = bin.x * bin.price + bin.y;
    return {
      key: String(bin.binId),
      v: Number.isFinite(value) && value >= 0 ? String(Number(value.toPrecision(12))) : null,
      label: `${formatPoolPrice(bin.price, numberLocale)} ${ySymbol} · ${formatPoolPrice(bin.x, numberLocale)} ${xSymbol} + ${formatPoolPrice(bin.y, numberLocale)} ${ySymbol}`,
      /* An explicit tone wins over `accent`: the active bin names its own. */
      tone: bin.binId === bins.activeBin ? "text" : bin.binId < bins.activeBin ? "info" : "muted",
    };
  });
  const active = rows.find((bin) => bin.binId === bins.activeBin) ?? null;
  return (
    <figure className={styles.chart} data-chart="bins">
      <MiniBars
        bars={bars}
        status={binsStatus(bins)}
        label={`${word("distributionBins")} ${ySymbol}`}
        lang={locale === "uk" ? "uk" : "en"}
        unit={ySymbol}
        accent={active ? String(active.binId) : null}
        caption="short"
        className={styles.binsPlot}
      />
      {/* The first and the last bin are the bars' own labels; under them, the price now. */}
      <figcaption className={styles.chartAxis} data-centered>
        <span className={styles.chartActive}>
          {word("activeBin")}: {active ? formatPoolPrice(active.price, numberLocale) : "—"} {ySymbol}
        </span>
      </figcaption>
      <p className={styles.chartLegend}>
        <span data-side="y">{ySymbol}</span>
        <span data-side="active">{word("activeBin")}</span>
        <span data-side="x">{xSymbol}</span>
        <span className={styles.chartUnit}>
          {word("distributionBins")} {ySymbol}
        </span>
      </p>
    </figure>
  );
}

/**
 * DAMM v2's one range: where the price sits between the pool's bounds, and how
 * the pool's value splits between the two tokens at the venue's prices.
 */
export function RangeBar({
  min,
  max,
  price,
  compounding,
  xValue,
  yValue,
  xSymbol,
  ySymbol,
  locale,
}: {
  min: number | null;
  max: number | null;
  price: number | null;
  compounding: boolean;
  xValue: number | null;
  yValue: number | null;
  xSymbol: string;
  ySymbol: string;
  locale: WorkspaceLocale;
}) {
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const bounded = min !== null && max !== null && max > min && price !== null;
  /* On a log scale, as prices move: the marker's place between the bounds. */
  const at = bounded ? Math.min(Math.max((Math.log(price) - Math.log(min)) / (Math.log(max) - Math.log(min)), 0), 1) : null;
  const total = xValue !== null && yValue !== null ? xValue + yValue : null;
  const xShare = total && total > 0 ? (xValue! / total) * 100 : null;
  return (
    <div className={styles.rangeWrap} data-chart="range">
      <p className={styles.chartUnit}>{compounding ? word("compounding") : word("distributionRange")}</p>
      <div className={styles.rangeTrack} aria-hidden="true">
        {/* A marker only between two bounds: on an open side there is no place to put the price that would be true. */}
        {at !== null ? <span className={styles.rangeMarker} style={{ left: `${at * 100}%` }} /> : null}
      </div>
      <div className={styles.chartAxis}>
        <span>
          {word("lower")}: {min === null ? word("noBound") : formatPoolPrice(min, numberLocale)}
        </span>
        <span className={styles.chartActive}>
          {word("activeBin")}: {formatPoolPrice(price, numberLocale)} {ySymbol}
        </span>
        <span>
          {word("upper")}: {max === null ? word("noBound") : formatPoolPrice(max, numberLocale)}
        </span>
      </div>
      {xShare !== null ? (
        <>
          <div className={styles.split} role="img" aria-label={`${xSymbol} ${Math.round(xShare)}% · ${ySymbol} ${Math.round(100 - xShare)}%`}>
            <span data-side="x" style={{ width: `${xShare}%` }} />
            <span data-side="y" style={{ width: `${100 - xShare}%` }} />
          </div>
          <p className={styles.chartLegend}>
            <span data-side="x">
              {xSymbol} {formatUsdCompact(xValue, numberLocale)} · {Math.round(xShare)}%
            </span>
            <span data-side="y">
              {ySymbol} {formatUsdCompact(yValue, numberLocale)} · {Math.round(100 - xShare)}%
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
