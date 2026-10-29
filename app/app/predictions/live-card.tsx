"use client";

import Link from "next/link";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { cancellable } from "@/lib/predictions/order-state";
import type { PredictionOrderRecord } from "@/lib/predictions/paper";
import type { RedeemReceipt } from "@/lib/predictions/redeem";

import { orderStateWord, orderTone } from "./account-card";
import { pct, shares, usd } from "./format";
import styles from "./predictions.module.css";
import { usePredictionsPaths } from "./surface";
import type { LiveData } from "./use-live";
import { outcomeLabel, venueName, wordsFor } from "./words";

type ApiFailure = { error?: { code?: string; message?: string } };

/**
 * The real-money part of the account, drawn only where live trading is open
 * to the wallet: positions and orders with real money, the rest of a working
 * order cancelled with one act, resolved wins collected with one act after
 * seeing exactly what is asked for, and the payout receipts. The money
 * itself (balance, deposit, withdrawal) is the money card above.
 */
export function LiveCard({ live, refresh, locale }: { live: LiveData | null; refresh: () => Promise<void>; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const paths = usePredictionsPaths();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* What the last collect came to, by the provider's own word per leg. */
  const [collected, setCollected] = useState<"sent" | "refused" | null>(null);
  if (!live || live.access.state === "off") return null;
  const account = live.account;
  const orders = (account?.orders ?? []).filter((o) => o.state !== "reviewed").slice(0, 20);
  const positions = account?.positions ?? [];
  const payable = live.redeemable;
  const payableUsd = payable.reduce((sum, r) => sum + r.valueUsd, 0);

  const act = async (key: string, path: string, body: unknown): Promise<unknown> => {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: body === null ? undefined : JSON.stringify(body) });
      if (!response.ok) {
        const failed = ((await response.json().catch(() => null)) ?? {}) as ApiFailure;
        setError(failed.error?.message || word("unavailable"));
        return null;
      }
      return await response.json().catch(() => ({}));
    } catch {
      setError(word("unavailable"));
      return null;
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  return (
    <section className={styles.card} aria-labelledby="pred-live">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-live" className={styles.cardTitle}>
          {word("liveTitle")}
        </h2>
        <span className={styles.paperBadge} data-live="true">
          {word("liveLimit")} {usd(live.access.maxOrderUsd, 0)}
        </span>
      </div>
      {live.access.state === "app_paper" ? <p className={styles.notice} style={{ margin: "var(--ry-s3) var(--ry-s4) 0" }}>{word("liveAppPaper")}</p> : null}
      {account?.providerFailure ? <p className={styles.notice} style={{ margin: "var(--ry-s3) var(--ry-s4) 0" }}>{account.providerFailure.code === "SESSION_EXPIRED" ? word("sessionExpired") : word("unavailable")}</p> : null}
      {error ? <p className={styles.error} role="alert" style={{ margin: "var(--ry-s3) var(--ry-s4) 0" }}>{error}</p> : null}

      {payable.length > 0 ? (
        <div className={styles.cardBody}>
          <p className={styles.note}>{word("collectReview")}</p>
          <ul className={styles.checks}>
            {payable.map((r) => (
              <li key={r.outcomeId} className={styles.check} data-state="pass">
                <i aria-hidden="true">✓</i>
                <span>
                  {r.question} · {outcomeLabel(r.label, locale)}
                </span>
                <b>{usd(r.valueUsd)}</b>
              </li>
            ))}
          </ul>
          <div className={styles.formActions}>
            <button
              type="button"
              className="rw-btn rw-btn--primary"
              disabled={busy !== null}
              onClick={() =>
                void act("collect", "/api/predictions/redeem", { outcomeIds: payable.map((r) => r.outcomeId) }).then((answer) => {
                  const legs = (answer as { receipt?: RedeemReceipt } | null)?.receipt?.legs ?? null;
                  if (!legs) return;
                  setCollected(legs.some((l) => l.status === "submitted" || l.status === "confirmed" || l.status === "unknown") ? "sent" : "refused");
                })
              }
            >
              {busy === "collect" ? word("collecting") : `${word("collect")} · ${usd(payableUsd)}`}
            </button>
          </div>
        </div>
      ) : null}
      {collected === "sent" ? <p className={styles.hint} role="status" style={{ margin: "0 var(--ry-s4)" }}>{word("collectSent")}</p> : null}
      {collected === "refused" ? <p className={styles.error} role="alert" style={{ margin: "0 var(--ry-s4)" }}>{word("collectRefused")}</p> : null}

      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("livePositions")}</h3>
      </div>
      {positions.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("liveNone")}
        </p>
      ) : (
        <div>
          {positions.slice(0, 30).map((position) => (
            <div key={`${position.venueEventId}:${position.question}`} className={styles.positionRow}>
              <p className={styles.positionTitle}>
                <Link href={paths.event(position.eventId ?? position.venueEventId)} prefetch={false}>
                  {position.question}
                </Link>
              </p>
              {position.outcomes.map((o) => (
                <div key={o.label} className={styles.positionFigures}>
                  <b>{outcomeLabel(o.label, locale)}</b>
                  <span>
                    {shares(o.totalSize)} {word("shares").toLowerCase()}
                  </span>
                  <span>
                    {word("avgEntry")} <b>{pct(o.avgEntryPrice)}</b>
                  </span>
                  <span>
                    {word("value")} <b>{usd(o.totalValue)}</b>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("liveOrders")}</h3>
      </div>
      {orders.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("noOrders")}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{word("marketLabel")}</th>
                <th>{word("orderState")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <LiveOrderRow key={order.quoteId} order={order} locale={locale} busy={busy === order.quoteId} disabled={busy !== null} onCancel={() => void act(order.quoteId, `/api/predictions/orders/${encodeURIComponent(order.quoteId)}/cancel`, null)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {live.receipts.length > 0 ? (
        <details className={styles.disclosure}>
          <summary>{word("receipts")}</summary>
          <div className={styles.disclosureBody}>
            {live.receipts.map((r) => (
              <p key={r.redeemId} className={styles.mono}>
                {r.createdAt.replace("T", " ").slice(0, 16)} UTC · {r.legs.map((l) => `${l.status}${l.txHash ? ` ${l.txHash.slice(0, 10)}…` : ""}`).join(" · ")}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function LiveOrderRow({ order, locale, busy, disabled, onCancel }: { order: PredictionOrderRecord; locale: WorkspaceLocale; busy: boolean; disabled: boolean; onCancel: () => void }) {
  const word = wordsFor(locale);
  const paths = usePredictionsPaths();
  const filled = order.execution?.orders.filter((o) => o.actualShares != null) ?? [];
  return (
    <tr>
      <th scope="row">
        <Link href={paths.event(order.eventId)} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
          {order.question}
        </Link>
        <br />
        <small style={{ color: "var(--ry-muted)", fontWeight: 500 }}>
          {outcomeLabel(order.outcomeLabel, locale)} · {order.side === "buy" ? usd(order.requested) : `${shares(order.requested)} sh`}
          {order.review.venues.length > 0 ? ` · ${order.review.venues.map(venueName).join(" + ")}` : ""}
          {filled.length > 0 ? ` · ${filled.map((o) => `${shares(o.actualShares ?? 0)} @ ${pct(o.executionPrice, 1)}`).join(", ")}` : ""}
        </small>
      </th>
      <td>
        <span className={styles.stateChip} data-tone={orderTone(order.state)}>
          {orderStateWord(order.state, word)}
        </span>
        {cancellable(order) ? (
          <button type="button" className="rw-btn" style={{ marginLeft: "var(--ry-s2)" }} disabled={disabled} onClick={onCancel}>
            {busy ? word("cancelling") : word("cancelRest")}
          </button>
        ) : null}
      </td>
    </tr>
  );
}
