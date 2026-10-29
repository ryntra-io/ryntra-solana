"use client";

import { ArrowSquareOut, CaretDown } from "@phosphor-icons/react";
import { Block, Skeleton } from "@ryntra/core/ui";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchSurvivalResponse } from "@/lib/api/v1/contract";
import { survivalRateBps } from "@/lib/core/launch/survival-stats";

import { coreLang, Unread } from "../launch-blocks";
import { explorerUrl, formatBps } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

const API_HEADERS = { "X-Ryntra-API": "1" } as const;

/**
 * «Виживання ринків Ryntra» (SOL-L3): of people's markets at least 7, 30 and 90 days old, how many lived to that day —
 * someone other than the creator and Ryntra traded them in the week before — each with the transaction that proves it,
 * by the definition said under the figures. A week not read is counted apart, never as quiet. Ryntra's own launches
 * are not on this public board (B15); the open API counts them apart.
 */
export function SurvivalBlock({ locale, network }: { locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet" }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const [survival, setSurvival] = useState<LaunchSurvivalResponse | "reading" | "failed">("reading");

  const read = useCallback(async () => {
    setSurvival((before) => (typeof before === "object" ? before : "reading"));
    const answer = await fetch("/api/v1/launch/survival", { headers: API_HEADERS, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LaunchSurvivalResponse) : null))
      .catch(() => null);
    setSurvival((before) => answer ?? (typeof before === "object" ? before : "failed"));
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  if (survival === "reading") {
    return (
      <Block title={word("survTitle")} titleAs="h2" icon="chart-column" lang={lang} id="launch-survival" aria-busy="true">
        <Skeleton lines={3} label={word("survTitle")} />
      </Block>
    );
  }
  if (survival === "failed") return <Unread text={word("survFailed")} again={word("readAgain")} onAgain={() => void read()} lang={lang} />;

  const people = survival.markets.filter((market) => !market.own);
  const proven = people.filter((market) => market.outcomes.some((outcome) => outcome.state !== "young"));
  return (
    <Block title={word("survTitle")} titleAs="h2" icon="chart-column" lang={lang} id="launch-survival">
      <div className={styles.blockStack}>
        <div className={styles.survGrid}>
          {survival.horizons.map((horizon) => {
            const tally = horizon.people;
            const rate = survivalRateBps(tally);
            return (
              <div key={horizon.days} className={styles.survCell}>
                <span className={styles.survDays}>{word("survDays", { n: horizon.days })}</span>
                {tally.eligible === 0 ? (
                  <span className={styles.cellSub}>{word("survNoneYet")}</span>
                ) : (
                  <>
                    <span className={styles.survFigure}>{rate === null ? "—" : formatBps(Math.round(rate / 100) * 100, locale)}</span>
                    <span className={styles.cellSub}>{word("survLived", { alive: tally.alive, decided: tally.alive + tally.quiet })}</span>
                    {tally.unread ? <span className={styles.cellUnread} title={word("survRateUnread")}>{word("survUnread", { n: tally.unread })}</span> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className={styles.cellSub}>{word("survDef")}</p>
        {survival.horizons.some((horizon) => horizon.people.unread > 0) ? <p className={styles.cellSub}>{word("survRateUnread")}</p> : null}
        {!survival.ownWalletsComplete ? <p className={styles.unread}>{word("survOwnUnread")}</p> : null}
        {!survival.listedAll ? <p className={styles.cellSub}>{word("survListedNewest")}</p> : null}
        {proven.length ? (
          <details className={styles.details}>
            <summary className={styles.summary}>
              {word("survProofs")} <CaretDown size={14} aria-hidden className={styles.caret} />
            </summary>
            <div className={styles.survTableWrap}>
              <table className={styles.survTable}>
                <thead>
                  <tr>
                    <th scope="col">{word("colToken")}</th>
                    {survival.horizons.map((horizon) => (
                      <th key={horizon.days} scope="col">
                        {word("survDays", { n: horizon.days })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proven.map((market) => (
                    <tr key={market.token}>
                      <th scope="row">
                        <a className={styles.markLink} href={`/app/launch/${market.token}`}>
                          ${market.symbol}
                        </a>
                      </th>
                      {market.outcomes.map((outcome) => (
                        <td key={outcome.days}>
                          {outcome.proof ? (
                            <a className={styles.markLink} href={explorerUrl(network, "tx", outcome.proof.signature)} target="_blank" rel="noreferrer noopener">
                              {word("survState_alive")} <ArrowSquareOut size={12} aria-hidden />
                            </a>
                          ) : (
                            <span className={outcome.state === "unread" ? styles.cellUnread : styles.cellSub}>{word(`survState_${outcome.state}` as LaunchWordKey)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
        <p className={styles.hint}>
          {word("survOwn")} {word("survApi")}{" "}
          <a className={styles.markLink} href="/api/v1/launch/survival" target="_blank" rel="noreferrer noopener" translate="no">
            /api/v1/launch/survival
          </a>
        </p>
      </div>
    </Block>
  );
}
