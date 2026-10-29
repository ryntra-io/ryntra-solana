import styles from "./spot.module.css";

/**
 * The attribution the sources' terms ask for — the price and the market's figures are Jupiter's, the candles
 * GeckoTerminal's — once on the page (B16): under the chart on a desk, beside the chart's own line of its source and
 * age; on a phone at the foot of «Про токен», so the candles keep the row.
 */
export function SourcesLine({ place }: { place: "chart" | "about" }) {
  return (
    <p className={`${styles.chartSources} ${place === "about" ? styles.aboutSources : ""}`} data-chart-sources={place}>
      <a href="https://jup.ag" target="_blank" rel="noreferrer noopener" translate="no">
        Powered by Jupiter
      </a>
      <span aria-hidden="true">·</span>
      <a href="https://www.geckoterminal.com" target="_blank" rel="noreferrer noopener" translate="no">
        Powered by GeckoTerminal
      </a>
    </p>
  );
}
