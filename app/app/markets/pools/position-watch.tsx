"use client";

import Link from "next/link";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatAmount, formatPercent, formatUsdMoney, toneOf } from "@/app/solana/workspace/spot/spot-format";
import type { PositionView } from "@/lib/liquidity/catalog/positions";
import { entryMatches, positionResult, rebalanceAdvice, typedEntry, type PositionEntry, type RebalanceAdvice } from "@/lib/liquidity/catalog/track";

import { formatPoolPrice } from "./pool-format";
import { parseDeposit } from "./pool-simulator";
import { saveEntry } from "./position-entries";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

/** A sum with its sign; one that rounds to zero cents carries none. */
export const signedUsd = (value: number, numberLocale: string): string => {
  const cents = Math.round(value * 100);
  return `${cents < 0 ? "−" : cents > 0 ? "+" : ""}${formatUsdMoney(Math.abs(cents) / 100, numberLocale)}`;
};

/** Why a position shows no result: no entry, an entry the position no longer matches, or no prices. */
function missingWord(position: PositionView, entry: PositionEntry | null): "watchNoEntryShort" | "watchMismatch" | "watchUnpriced" {
  if (!entry) return "watchNoEntryShort";
  return entryMatches(position, entry) ? "watchUnpriced" : "watchMismatch";
}

export function adviceOf(position: PositionView): RebalanceAdvice {
  /* A position read before SOL-2b carried no price: it still says out of range, without the distance. */
  return rebalanceAdvice({ rangeState: position.rangeState, lower: position.lower, upper: position.upper, price: position.price ?? null });
}

/**
 * Under a position in a list (SOL-2b): its divergence loss and net result against the entry, or the one line that says
 * the entry is missing; then, when the price nears an edge or has left the range, what that asks of the person.
 */
export function WatchLines({ position, entry, locale, numberLocale }: { position: PositionView; entry: PositionEntry | null; locale: WorkspaceLocale; numberLocale: string }) {
  const word = poolsWords(locale);
  const result = positionResult(position, entry);
  const advice = adviceOf(position);
  const page = `/app/markets/pools/${position.pool}/position/${position.address}`;
  return (
    <>
      {result ? (
        <dl className={styles.positionFacts} data-pools="watch">
          <div data-tone={toneOf(result.divergence)}>
            <dt>{word("watchDivergence")}</dt>
            <dd>
              {signedUsd(result.divergence, numberLocale)} · {formatPercent(result.divergencePct, numberLocale)}
            </dd>
          </div>
          <div data-tone={toneOf(result.net)}>
            <dt>{word("watchNet")}</dt>
            <dd>
              {signedUsd(result.net, numberLocale)} · {formatPercent(result.netPct, numberLocale)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className={styles.positionLine} data-pools="watch-missing">
          {word(missingWord(position, entry))}
          {missingWord(position, entry) === "watchUnpriced" ? null : (
            <>
              {" · "}
              <Link href={page} className={styles.manageLink} prefetch={false}>
                {word("watchSetEntry")} →
              </Link>
            </>
          )}
        </p>
      )}
      {advice.kind === "near_edge" ? (
        <p className={styles.positionLine} data-pools="near-edge">
          {advice.edge === "upper" ? word("nearEdgeUpper") : word("nearEdgeLower")} {formatAmount(advice.leftPct, numberLocale, 1)}%
        </p>
      ) : null}
      {advice.kind === "out" ? (
        <p className={styles.positionWarn} data-pools="rebalance">
          {position.kind === "dlmm" ? word("rebalanceSuggest") : word("rebalanceSuggestShort")} ·{" "}
          <Link href={`${page}?rebalance=1`} className={styles.manageLink} prefetch={false}>
            {word("rebalanceOpen")} →
          </Link>
        </p>
      ) : null}
    </>
  );
}

/**
 * A position's own page (SOL-2b): the result against the entry, the entry itself — recorded by Ryntra or typed here —
 * and, out of range, the rebalance as two signed steps: withdraw here, then open the same width around the price.
 */
export function PositionWatch({
  position,
  entry,
  owner,
  locale,
  onWithdrawAll,
  withdrawOpen,
}: {
  position: PositionView;
  entry: PositionEntry | null;
  owner: string;
  locale: WorkspaceLocale;
  /** Turns the page's own withdraw form to «all»: the first step, through its Review and signature. */
  onWithdrawAll: () => void;
  /** The withdraw form is closed now (the gate, a lock): the step is shown but not offered. */
  withdrawOpen: boolean;
}) {
  const word = poolsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const result = positionResult(position, entry);
  const advice = adviceOf(position);
  const [editing, setEditing] = useState(false);
  const [typedX, setTypedX] = useState("");
  const [typedY, setTypedY] = useState("");
  const [bad, setBad] = useState(false);
  const id = "pools-entry";

  /* In the page's language: in English a comma groups thousands, in Ukrainian it is the decimal mark. Empty — zero. */
  const parse = (text: string): number => (text.trim() === "" ? 0 : parseDeposit(text, locale));
  function save() {
    const entered = typedEntry(parse(typedX), parse(typedY), Date.now());
    if (!entered) {
      setBad(true);
      return;
    }
    saveEntry(owner, position.address, entered);
    setBad(false);
    setEditing(false);
  }

  return (
    <section className={styles.actionStack} data-pools="position-watch" lang={lang} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.watchTitle}>
        {word("watchTitle")}
      </h2>
      {result ? (
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{word("watchHold")}</dt>
            <dd>{formatUsdMoney(result.hold, numberLocale)}</dd>
            <span className={styles.factNote}>
              {formatAmount(entry!.x, numberLocale)} {position.x.symbol} · {formatAmount(entry!.y, numberLocale)} {position.y.symbol}
            </span>
          </div>
          <div className={styles.fact} data-tone={toneOf(result.divergence)}>
            <dt>{word("watchDivergence")}</dt>
            <dd>
              {signedUsd(result.divergence, numberLocale)} · {formatPercent(result.divergencePct, numberLocale)}
            </dd>
            <span className={styles.factNote}>{word("watchDivergenceNote")}</span>
          </div>
          <div className={styles.fact}>
            <dt>{word("watchFees")}</dt>
            <dd>{formatUsdMoney(result.fees, numberLocale)}</dd>
            <span className={styles.factNote}>{word("watchFeesNote")}</span>
          </div>
          <div className={styles.fact} data-tone={toneOf(result.net)}>
            <dt>{word("watchNet")}</dt>
            <dd>
              {signedUsd(result.net, numberLocale)} · {formatPercent(result.netPct, numberLocale)}
            </dd>
            <span className={styles.factNote}>{word("watchNetNote")}</span>
          </div>
          {result.sinceDeposit !== null ? (
            <div className={styles.fact} data-tone={toneOf(result.sinceDeposit)}>
              <dt>{word("watchSince")}</dt>
              <dd>{signedUsd(result.sinceDeposit, numberLocale)}</dd>
              <span className={styles.factNote}>{word("watchSinceNote")}</span>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className={styles.note} data-pools="watch-missing">
          {entry ? word(missingWord(position, entry)) : word("watchNoEntry")}
        </p>
      )}
      {entry ? <p className={styles.sourcesLine}>{entry.source === "ryntra" ? word("watchEntryRyntra") : word("watchEntryTyped")}</p> : null}

      {editing ? (
        <div className={styles.actionStack} role="group" aria-labelledby={`${id}-entry`}>
          <span id={`${id}-entry`} className={styles.rangeLine}>
            {word("watchEntryTitle")}
          </span>
          <div className={styles.entryFields}>
            <div className={styles.simField}>
              <label htmlFor={`${id}-x`}>{position.x.symbol}</label>
              <input id={`${id}-x`} inputMode="decimal" autoComplete="off" placeholder="0" value={typedX} onChange={(event) => setTypedX(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 24))} />
            </div>
            <div className={styles.simField}>
              <label htmlFor={`${id}-y`}>{position.y.symbol}</label>
              <input id={`${id}-y`} inputMode="decimal" autoComplete="off" placeholder="0" value={typedY} onChange={(event) => setTypedY(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 24))} />
            </div>
          </div>
          {bad ? <span className={styles.fieldWarn} role="alert">{word("watchEntryBad")}</span> : null}
          <div className={styles.simMoves}>
            <button type="button" className={styles.order} onClick={save}>
              {word("watchEntrySave")}
            </button>
            <button type="button" className={styles.inlineAction} onClick={() => setEditing(false)}>
              {word("back2")}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.simMoves}>
          <button
            type="button"
            className={styles.inlineAction}
            onClick={() => {
              setTypedX(entry ? String(entry.x) : "");
              setTypedY(entry ? String(entry.y) : "");
              setEditing(true);
            }}
          >
            {word("watchSetEntry")}
          </button>
          {entry ? (
            <button type="button" className={styles.inlineAction} onClick={() => saveEntry(owner, position.address, null)}>
              {word("watchEntryForget")}
            </button>
          ) : null}
        </div>
      )}

      {advice.kind === "near_edge" ? (
        <p className={styles.positionWarn} data-pools="near-edge">
          {advice.edge === "upper" ? word("nearEdgeUpper") : word("nearEdgeLower")} {formatAmount(advice.leftPct, numberLocale, 1)}%
        </p>
      ) : null}
      {advice.kind === "out" ? <Rebalance advice={advice} position={position} locale={locale} onWithdrawAll={onWithdrawAll} withdrawOpen={withdrawOpen} /> : null}
    </section>
  );
}

function Rebalance({
  advice,
  position,
  locale,
  onWithdrawAll,
  withdrawOpen,
}: {
  advice: Extract<RebalanceAdvice, { kind: "out" }>;
  position: PositionView;
  locale: WorkspaceLocale;
  onWithdrawAll: () => void;
  withdrawOpen: boolean;
}) {
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const token = advice.holds === "x" ? position.x.symbol : position.y.symbol;
  /* DLMM's bins are the position's own and a new range can be drawn; a smooth pool's range is the pool's. */
  const bins = position.kind === "dlmm" && advice.reopen !== null;
  return (
    <div className={styles.rebalance} data-pools="rebalance">
      <h3 className={styles.watchTitle}>{word("rebalanceTitle")}</h3>
      <p className={styles.positionWarn}>
        {advice.price === "above" ? word("rebalanceAbove") : word("rebalanceBelow")} {token} {word("rebalanceEarnsNothing")}
        {advice.pastPct !== null ? ` ${formatAmount(advice.pastPct, numberLocale, 1)}% ${word("rebalancePast")}.` : null}
      </p>
      {bins ? (
        <p className={styles.positionLine}>
          {word("rebalanceSuggest")}: ≈ {formatPoolPrice(advice.reopen!.lower, numberLocale)} – {formatPoolPrice(advice.reopen!.upper, numberLocale)} {position.y.symbol}. {word("rebalanceNearest")}
        </p>
      ) : (
        <p className={styles.positionLine}>{word("rebalanceSuggestRange")}</p>
      )}
      <p className={styles.positionLine}>{word("rebalanceWait")}</p>
      <div className={styles.simMoves}>
        <button type="button" className={styles.step} disabled={!withdrawOpen} aria-describedby={withdrawOpen ? undefined : "pools-rebalance-closed"} onClick={onWithdrawAll}>
          {word("rebalanceStep1")}
        </button>
        {bins ? (
          <Link href={`/app/markets/pools/${position.pool}/add?rebalance=${advice.reopen!.span.toFixed(6)}`} className={styles.step} prefetch={false}>
            {word("rebalanceStep2")}
          </Link>
        ) : (
          <Link href={`/app/markets/pools?q=${encodeURIComponent(`${position.x.symbol} ${position.y.symbol}`)}`} className={styles.step} prefetch={false}>
            {word("rebalanceFind")}
          </Link>
        )}
      </div>
      {withdrawOpen ? null : (
        <p id="pools-rebalance-closed" className={styles.sourcesLine}>
          {word("failClosed")}
        </p>
      )}
      <p className={styles.sourcesLine}>{word("rebalanceSigned")}</p>
    </div>
  );
}
