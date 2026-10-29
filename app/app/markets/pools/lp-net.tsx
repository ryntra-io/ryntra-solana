"use client";

import { useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatAmount, formatPercent, formatUsdMoney, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { simulateNet } from "@/lib/liquidity/catalog/simulate";

import { parseDeposit } from "./pool-simulator";
import { signedUsd } from "./position-watch";
import { poolsWords, type PoolsWord } from "./pools-words";
import styles from "./pools.module.css";

const PERIODS = [1, 7, 30, 90] as const;
const VOLATILITIES = [2, 5, 10, 20] as const;
/** Two transactions (in and out) at the network's base fee and a priority fee — a typed figure the person can change. */
const DEFAULT_GAS_USD = "0.10";
/**
 * A deposit without automation pays Ryntra nothing; the one-time entry share at the class rate belongs to a
 * position with automation, which is SOL-6 and not on the page yet.
 */
const RYNTRA_ENTRY_PCT = 0;

const SCENARIO_WORD: readonly PoolsWord[] = ["netDown", "netStill", "netUp"];

/**
 * «Чистий результат позиції» (SOL-2b): the deposit and the range from the simulator above, and the person's own
 * assumptions — the period, the pool's volume a day, how much the price moves, the network's fees — give three outcomes:
 * the price down by a typical move, still, and up. Fees as the deposit's share of the pool's trading while the price is
 * in the range; less the divergence loss, the network's fees and Ryntra's entry share (0). Never one figure, never a
 * promise.
 */
export function NetSimulator({
  locale,
  depositUsd,
  tvlUsd,
  volume24hUsd,
  feePct,
  protocolSharePct,
  down,
  up,
  divergenceAt,
}: {
  locale: WorkspaceLocale;
  depositUsd: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  feePct: number | null;
  protocolSharePct: number | null;
  /** The range's reach from the price, percent; null — no bound. */
  down: number | null;
  up: number | null;
  /** The position against holding after a move of `percent`, USD, before fees. */
  divergenceAt: (percent: number) => number | null;
}) {
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const id = "pool-net";
  const [days, setDays] = useState<number>(7);
  const [volatility, setVolatility] = useState<number>(5);
  const [volume, setVolume] = useState<string>(volume24hUsd !== null && volume24hUsd > 0 ? String(Math.round(volume24hUsd)) : "");
  const [gas, setGas] = useState<string>(locale === "uk" ? DEFAULT_GAS_USD.replace(".", ",") : DEFAULT_GAS_USD);

  const result = useMemo(() => {
    if (depositUsd === null || tvlUsd === null || feePct === null) return null;
    const volumeUsd = parseDeposit(volume, locale);
    const gasUsd = parseDeposit(gas, locale);
    if (!Number.isFinite(volumeUsd) || !Number.isFinite(gasUsd)) return null;
    return simulateNet({
      depositUsd,
      tvlUsd,
      volumeUsdPerDay: volumeUsd,
      feePct,
      protocolSharePct: protocolSharePct ?? 0,
      volatilityPct: volatility,
      days,
      gasUsd,
      ryntraEntryPct: RYNTRA_ENTRY_PCT,
      down,
      up,
      divergenceAt,
    });
  }, [depositUsd, tvlUsd, feePct, protocolSharePct, volume, gas, volatility, days, down, up, divergenceAt, locale]);

  if (tvlUsd === null || feePct === null) return <p className={styles.note}>{word("netNoData")}</p>;
  const signed = (value: number) => signedUsd(value, numberLocale);

  return (
    <section className={styles.sim} data-pools="net" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={styles.watchTitle}>
        {word("netTitle")}
      </h3>
      <p className={styles.note}>{word("netNotPromise")}</p>
      <div className={styles.netInputs}>
        <div className={styles.simField}>
          <span id={`${id}-days`}>{word("netDays")}</span>
          <div className={styles.simMoves} role="group" aria-labelledby={`${id}-days`}>
            {PERIODS.map((entry) => (
              <button key={entry} type="button" className={styles.order} aria-pressed={days === entry} onClick={() => setDays(entry)}>
                {entry} {word(entry === 1 ? "netDay" : "netDayMany")}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.simField}>
          <span id={`${id}-vol`}>{word("netVolatility")}</span>
          <div className={styles.simMoves} role="group" aria-labelledby={`${id}-vol`}>
            {VOLATILITIES.map((entry) => (
              <button key={entry} type="button" className={styles.order} aria-pressed={volatility === entry} onClick={() => setVolatility(entry)}>
                {entry}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {result ? (
        <div className={styles.simOut} aria-live="polite">
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>{word("netShare")}</dt>
              <dd>{formatAmount(result.share * 100, numberLocale, result.share < 0.0001 ? 6 : 3)}%</dd>
            </div>
            <div className={styles.fact}>
              <dt>{word("netInRange")}</dt>
              <dd>{formatAmount(result.inRange * 100, numberLocale, 0)}%</dd>
            </div>
            <div className={styles.fact}>
              <dt>{word("netFees")}</dt>
              <dd>{formatUsdMoney(result.fees, numberLocale)}</dd>
              <span className={styles.factNote}>{word("netFeesNote")}</span>
            </div>
            <div className={styles.fact}>
              <dt>{word("netGasLine")}</dt>
              <dd>{formatUsdMoney(result.gas, numberLocale)}</dd>
            </div>
            <div className={styles.fact} data-fact="ryntra-entry">
              <dt>{word("netRyntra")}</dt>
              <dd>{formatUsdMoney(result.ryntraEntry, numberLocale)}</dd>
              <span className={styles.factNote}>{word("netRyntraNone")}</span>
            </div>
          </dl>
          <dl className={styles.netScenarios}>
            {result.scenarios.map((scenario, index) => (
              <div key={SCENARIO_WORD[index]} className={styles.fact} data-tone={toneOf(scenario.net)}>
                <dt>
                  {word(SCENARIO_WORD[index]!)} {index === 1 ? null : formatPercent(scenario.movePct, numberLocale)}
                </dt>
                <dd>
                  {word("netResult")} {signed(scenario.net)}
                </dd>
                <span className={styles.factNote}>
                  {word("netIl")} {signed(scenario.divergence)} {word("netLoss")}
                </span>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className={styles.note}>{word("simNoAmount")}</p>
      )}

      {/* An analyst's two figures and the arithmetic behind them, at rest («Реєстр зайвого» M9-money, audit UX-619):
          the period and the typical move stay out in the open because they are the question a person asks; the pool's
          volume a day, the network's fees either way — with the four lines about which rent comes back — and the
          formula are what they ask next, and they were the first thing the block showed. Both figures still drive the
          estimate above; they start from the pool's own past day and the two transactions' own cost. */}
      <details className={styles.details}>
        <summary>{word("netDetails")}</summary>
        <div className={styles.netInputs}>
          <label className={styles.simField} htmlFor={`${id}-volume`}>
            <span>{word("netVolume")}</span>
            <input id={`${id}-volume`} inputMode="decimal" autoComplete="off" value={volume} onChange={(event) => setVolume(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 16))} />
            <span className={styles.factNote}>{word("netVolumeNote")}</span>
          </label>
          <label className={styles.simField} htmlFor={`${id}-gas`}>
            <span>{word("netGas")}</span>
            <input id={`${id}-gas`} inputMode="decimal" autoComplete="off" value={gas} onChange={(event) => setGas(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 12))} />
            <span className={styles.factNote}>{word("netGasNote")}</span>
          </label>
        </div>
        <p className={styles.sourcesLine}>{word("netAssume")}</p>
      </details>
    </section>
  );
}
