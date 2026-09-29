import { Info } from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";

import { clockOf, periodTone, periodWord, wordsFor, type StockStrip } from "./stock-model";
import styles from "./stocks.module.css";

/**
 * The strip above the list — five instruments a person reads without
 * reading: the US session as the issuer's calendar states it, how many
 * stock tokens are listed and by how many issuers, how many traded today and
 * for how much, what the pools hold. Every figure is the sum or count of the
 * venue's own rows; the session is the issuer's word for its own tokens.
 */
export function StockStripBar({ strip, locale }: { strip: StockStrip; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const tone = periodTone(strip.session.period);
  const change = clockOf(strip.session.nextChangeAt, locale);
  const sessionSub =
    strip.session.period === "unknown"
      ? word("calendarUnknown")
      : change
        ? `${word("nextChange")} ${change} UTC`
        : null;
  const updated = clockOf(strip.fetchedAt, locale);
  return (
    <div className={`${styles.card} ${styles.strip}`} role="group" aria-label={word("market")}>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("usSession")}</span>
        <span className={styles.metricValue} data-prose="true">
          {tone ? (
            <span className={styles.session} data-tone={tone}>
              <span className={styles.dot} aria-hidden="true" />
              {periodWord(strip.session.period, locale)}
            </span>
          ) : (
            <span className={styles.dash}>—</span>
          )}
        </span>
        {sessionSub ? <span className={styles.metricSub}>{sessionSub}</span> : null}
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("listed")}</span>
        <span className={styles.metricValue} translate="no">
          {strip.listed.toLocaleString(numberLocale)}
        </span>
        <span className={styles.metricSub}>
          {word("stocksAndEtfs")} · {strip.issuers} {word("issuersN")}
        </span>
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("tradedToday")}</span>
        <span className={styles.metricValue} translate="no">
          {strip.tradedToday.toLocaleString(numberLocale)}
        </span>
        <span className={styles.metricSub}>
          {word("tokensN")} · {word("volume24h").toLowerCase()} {formatUsdCompact(strip.volumeUsd, numberLocale)}
        </span>
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("liquidity")}</span>
        <span className={styles.metricValue} translate="no">
          {formatUsdCompact(strip.liquidityUsd, numberLocale)}
        </span>
        <span className={styles.metricSub}>
          {word("inPools")}
          {updated ? ` · ${word("updated").toLowerCase()} ${updated} UTC` : ""}
        </span>
      </div>
    </div>
  );
}

/** The sources, one click deep, at the foot of the list. */
export function StockSources({ locale, catalogueDown = false, strip = null }: { locale: WorkspaceLocale; catalogueDown?: boolean; /** With the strip, the foot also says which issuer catalogue did not answer and what was served instead. */ strip?: StockStrip | null }) {
  const word = wordsFor(locale);
  const down = strip?.cataloguesDown ?? [];
  const issuerName = (issuer: "xstocks" | "prestocks"): string => (issuer === "xstocks" ? "xStocks" : "PreStocks");
  return (
    <details className={styles.sources}>
      <summary>
        <Info size={14} weight="bold" aria-hidden="true" />
        {word("sources")}
      </summary>
      <div className={styles.sourcesBody}>
        <p>{word("srcToken")}</p>
        <p>{word("srcReference")}</p>
        <p>{word("srcUnits")}</p>
        <p>{word("srcTagOnly")}</p>
        <p>{word("srcPreIpo")}</p>
        <p>{word("srcDeviation")}</p>
        <p>{word("srcNotAdvice")}</p>
        {catalogueDown ? <p>{word("catalogueDown")}</p> : null}
        {down.map((entry) => (
          <p key={entry.issuer}>
            {issuerName(entry.issuer)} — {entry.stale ? word("catalogueStale") : word("catalogueMissing")}.
          </p>
        ))}
      </div>
    </details>
  );
}
