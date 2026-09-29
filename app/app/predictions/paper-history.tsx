"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { orderStateWord, orderTone } from "./account-card";
import { pct, shares, timeShort, usd } from "./format";
import styles from "./predictions.module.css";
import { usePaperAccount } from "./use-paper-account";
import { venueName, wordsFor } from "./words";

/**
 * Paper operations in History (`RYN-PREDICTIONS-001` item 18): every paper
 * order as Ryntra recorded it — the market, the outcome, the amount, the
 * price the provider filled at, the state the provider reported — under its
 * own heading and with the word *Paper* on every row, so the real timeline
 * above and the simulated one here are never read as one. A guest sees
 * nothing; a wallet without paper orders sees one sentence.
 */
export function PaperHistorySection({ locale }: { locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const account = usePaperAccount();
  if (account.state.status !== "ready" || !account.state.account) return null;
  const orders = account.state.account.orders.filter((o) => o.state !== "reviewed");
  return (
    <section className={styles.page} aria-labelledby="paper-history-title" style={{ marginTop: "var(--ry-s4)" }}>
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <h2 id="paper-history-title" style={{ margin: 0, fontSize: "var(--ry-fs-dense)", fontWeight: 700, color: "var(--ry-text)" }}>
            {locale === "uk" ? "Paper-операції · Прогнози" : "Paper operations · Predictions"}
          </h2>
          <p className={styles.tagline}>{locale === "uk" ? "Симульовані ордери на ринках прогнозів. Не входять у реальну історію гаманця." : "Simulated orders on prediction markets. Not part of the wallet's real history."}</p>
        </div>
        <div className={styles.actions}>
          <Link className="rw-btn" href="/app/predictions" prefetch={false}>
            {word("title")}
          </Link>
        </div>
      </header>
      <div className={styles.card}>
        {orders.length === 0 ? (
          <p className={styles.muted} style={{ padding: "var(--ry-s4)" }}>
            {word("noOrders")}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{locale === "uk" ? "Час" : "When"}</th>
                  <th>{word("market")}</th>
                  <th>{locale === "uk" ? "Тип" : "Type"}</th>
                  <th>{word("amount")}</th>
                  <th>{word("buysAt")}</th>
                  <th>{word("orderState")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const filled = order.execution?.orders.find((o) => o.executionPrice != null) ?? null;
                  return (
                    <tr key={order.quoteId}>
                      <td style={{ textAlign: "left" }}>{timeShort(order.submittedAt ?? order.createdAt, locale)}</td>
                      <th scope="row">
                        <Link href={`/app/predictions/${encodeURIComponent(order.eventId)}`} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
                          {order.question}
                        </Link>
                        <br />
                        <small style={{ color: "var(--ry-muted)", fontWeight: 500 }}>
                          {order.outcomeLabel}
                          {order.review.venues.length ? ` · ${order.review.venues.map(venueName).join(" + ")}` : ""}
                        </small>
                      </th>
                      <td>
                        <span className={styles.stateChip}>{locale === "uk" ? "Paper · прогноз" : "Paper · prediction"}</span>
                      </td>
                      <td>{order.side === "buy" ? usd(order.requested) : `${shares(order.requested)} sh`}</td>
                      <td>{pct(filled?.executionPrice ?? order.review.figures.probability, 1)}</td>
                      <td>
                        <span className={styles.stateChip} data-tone={orderTone(order.state)}>
                          {orderStateWord(order.state, word)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
