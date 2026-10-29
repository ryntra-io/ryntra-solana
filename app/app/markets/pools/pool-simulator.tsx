"use client";

import { useCallback, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatAmount, formatPercent, formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import type { LiquidityPoolKind } from "@/lib/liquidity/catalog/model";
import { binsSpanPct, movedPrice, simulateBins, simulateRange } from "@/lib/liquidity/catalog/simulate";

import { NetSimulator } from "./lp-net";
import { formatPoolPrice } from "./pool-format";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

const MOVES = [-50, -20, -5, 5, 20, 50, 100] as const;
/** A new DLMM position spans at most 70 bins: 34 each side and the active one. */
const MAX_SIDE_BINS = 34;
const DEFAULT_SIDE_BINS = 10;

/**
 * «У пулі чи просто тримати»: a deposit, a price move, and for DLMM how wide
 * the bins reach — then what the position would hold against the same tokens
 * kept in the wallet, before fees, and the fees it would take to break even.
 * Values are in USD at Y's price now (held still), else in Y. Below it, the
 * same deposit and range under the person's assumptions: the net of a position
 * after fees, divergence, the network and Ryntra's entry share (SOL-2b).
 */
export function PoolSimulator({
  locale,
  kind,
  price,
  binStepBps,
  min,
  max,
  xSymbol,
  ySymbol,
  yPriceUsd,
  tvlUsd = null,
  volume24hUsd = null,
  feePct = null,
  protocolSharePct = null,
}: {
  locale: WorkspaceLocale;
  kind: LiquidityPoolKind;
  price: number | null;
  binStepBps: number | null;
  min: number | null;
  max: number | null;
  xSymbol: string;
  ySymbol: string;
  yPriceUsd: number | null;
  /** For the net (SOL-2b): the pool's TVL and a day's volume (USD), a trade's fee and the protocol's share of it (percent). */
  tvlUsd?: number | null;
  volume24hUsd?: number | null;
  feePct?: number | null;
  protocolSharePct?: number | null;
}) {
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  /* One simulator on a page: fixed ids — the frame's own ids drift between server and browser, so useId here would too. */
  const id = "pool-sim";
  const [deposit, setDeposit] = useState("1000");
  const [move, setMove] = useState(-20);
  const [side, setSide] = useState(DEFAULT_SIDE_BINS);
  const usd = yPriceUsd !== null && yPriceUsd > 0;

  const result = useMemo(() => {
    const amount = parseDeposit(deposit, locale);
    const next = price === null ? null : movedPrice(price, move);
    if (price === null || next === null || !Number.isFinite(amount) || amount <= 0) return null;
    const value = usd ? amount / yPriceUsd! : amount;
    const sim =
      kind === "dlmm" && binStepBps
        ? simulateBins({ binStepBps, price, nextPrice: next, below: side, above: side, value })
        : simulateRange({ min, max, price, nextPrice: next, value });
    return sim ? { sim, next } : null;
  }, [deposit, locale, move, side, price, kind, binStepBps, min, max, usd, yPriceUsd]);

  const amount = parseDeposit(deposit, locale);
  const depositUsd = usd && Number.isFinite(amount) && amount > 0 ? amount : null;
  /* The range's reach from the price, as the net's time in range reads it. */
  const reach = useMemo((): Readonly<{ down: number | null; up: number | null }> => {
    if (price === null) return { down: null, up: null };
    /* The outer bins have a width of their own: half a step past each, as the active bin trades across its own. */
    if (kind === "dlmm" && binStepBps) return binsSpanPct(binStepBps, side + 0.5);
    return { down: min !== null && min > 0 ? Math.max(0, (1 - min / price) * 100) : null, up: max !== null && Number.isFinite(max) ? Math.max(0, (max / price - 1) * 100) : null };
  }, [price, kind, binStepBps, side, min, max]);
  const divergenceAt = useCallback(
    (percent: number): number | null => {
      const next = price === null ? null : movedPrice(price, percent);
      if (price === null || next === null || depositUsd === null || !usd) return null;
      const value = depositUsd / yPriceUsd!;
      const sim = kind === "dlmm" && binStepBps ? simulateBins({ binStepBps, price, nextPrice: next, below: side, above: side, value }) : simulateRange({ min, max, price, nextPrice: next, value });
      return sim ? sim.difference * yPriceUsd! : null;
    },
    [price, depositUsd, usd, yPriceUsd, kind, binStepBps, side, min, max],
  );

  if (price === null) return <p className={styles.note}>{word("simNoPrice")}</p>;
  const money = (y: number): string => (usd ? formatUsdMoney(y * yPriceUsd!, numberLocale) : `${formatAmount(y, numberLocale)} ${ySymbol}`);
  const span = kind === "dlmm" && binStepBps ? binsSpanPct(binStepBps, side) : null;

  return (
    <div className={styles.sim}>
      <div className={styles.simInputs}>
        <label className={styles.simField} htmlFor={`${id}-deposit`}>
          <span>
            {word("simDeposit")}, {usd ? "USD" : ySymbol}
          </span>
          <input
            id={`${id}-deposit`}
            inputMode="decimal"
            value={deposit}
            onChange={(event) => setDeposit(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 16))}
            autoComplete="off"
          />
        </label>
        <div className={styles.simField}>
          <label htmlFor={`${id}-move`}>
            {xSymbol} {word("simMove")}: <strong>{formatPercent(move, numberLocale)}</strong>
          </label>
          <input id={`${id}-move`} type="range" min={-90} max={300} step={1} value={move} aria-valuetext={formatPercent(move, numberLocale)} onChange={(event) => setMove(Number(event.target.value))} />
          <div className={styles.simMoves} role="group" aria-label={word("simMove")}>
            {MOVES.map((m) => (
              <button key={m} type="button" className={styles.order} aria-pressed={move === m} onClick={() => setMove(m)}>
                {formatPercent(m, numberLocale).replace(",00", "").replace(".00", "")}
              </button>
            ))}
          </div>
        </div>
        {kind === "dlmm" && binStepBps ? (
          <div className={styles.simField}>
            <label htmlFor={`${id}-bins`}>
              {word("simWidth")}: <strong>{side}</strong> · {word("simReach")} +{formatAmount(span?.up ?? null, numberLocale, 1)}% / −{formatAmount(span?.down ?? null, numberLocale, 1)}%
            </label>
            <input id={`${id}-bins`} type="range" min={0} max={MAX_SIDE_BINS} step={1} value={side} onChange={(event) => setSide(Number(event.target.value))} />
          </div>
        ) : null}
      </div>

      {result ? (
        <div className={styles.simOut} aria-live="polite">
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>{word("simHold")}</dt>
              <dd>{money(result.sim.hold)}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{word("simPool")}</dt>
              <dd>{money(result.sim.pool)}</dd>
              <span className={styles.factNote}>
                {formatAmount(result.sim.holds.x, numberLocale)} {xSymbol} · {formatAmount(result.sim.holds.y, numberLocale)} {ySymbol}
              </span>
            </div>
            <div className={styles.fact} data-tone={result.sim.difference < 0 ? "down" : "up"}>
              <dt>{word("simDiff")}</dt>
              <dd>
                {result.sim.difference < 0 ? "−" : "+"}
                {money(Math.abs(result.sim.difference)).replace("−", "")} · {formatPercent(result.sim.differencePct, numberLocale)}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>{word("simBreakEven")}</dt>
              <dd>{result.sim.breakEvenFees > 0 ? money(result.sim.breakEvenFees) : "—"}</dd>
              {result.sim.breakEvenFees === 0 ? <span className={styles.factNote}>{word("simAhead")}</span> : null}
            </div>
          </dl>
          {!result.sim.inRange ? <p className={styles.positionWarn}>{word("simOut")}</p> : null}
          <p className={styles.sourcesLine}>
            {formatPoolPrice(price, numberLocale)} → {formatPoolPrice(result.next, numberLocale)} {ySymbol} · {kind === "dlmm" ? word("simAssume") : word("simAssumeRange")}
          </p>
        </div>
      ) : (
        <p className={styles.note}>{word("simNoAmount")}</p>
      )}
      {usd ? (
        <NetSimulator
          locale={locale}
          depositUsd={depositUsd}
          tvlUsd={tvlUsd}
          volume24hUsd={volume24hUsd}
          feePct={feePct}
          protocolSharePct={protocolSharePct}
          down={reach.down}
          up={reach.up}
          divergenceAt={divergenceAt}
        />
      ) : (
        <p className={styles.note}>{word("netNoData")}</p>
      )}
    </div>
  );
}

/** A typed sum in the page's language: in English a comma groups thousands («1,000.50»); in Ukrainian it is the decimal mark («1 000,5»). */
export function parseDeposit(text: string, locale: WorkspaceLocale): number {
  const bare = text.replace(/\s/g, "");
  const normalized = locale === "uk" ? bare.replace(/\./g, bare.includes(",") ? "" : ".").replace(",", ".") : bare.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
