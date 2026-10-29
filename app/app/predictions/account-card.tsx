"use client";

import { EmptyState } from "@ryntra/core/ui";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import type { PredictionOrderRecord } from "@/lib/predictions/paper";

import { BotCheck } from "./bot-check";
import { pct, shares, timeShort, usd } from "./format";
import styles from "./predictions.module.css";
import type { usePaperAccount } from "./use-paper-account";
import { outcomeLabel, venueName, wordsFor } from "./words";
import { usePredictionsPaths } from "./surface";

type Account = ReturnType<typeof usePaperAccount>;

/**
 * A guest's one way in: the app's own «Connect wallet» (the same button and
 * the header's panel as every page), or — with a wallet already held but not
 * signed in on this site — the one signature that proves it.
 */
export function ConnectAction({ account, locale, block = false }: { account: Account; locale: WorkspaceLocale; block?: boolean }) {
  const word = wordsFor(locale);
  // A wallet held but not signed in here (or signed in for another): one signature, not a second wallet.
  if (account.address) {
    return (
      <button type="button" className={`rw-btn rw-btn--primary${block ? ` ${styles.blockButton}` : ""}`} onClick={() => void account.prove()}>
        {word("linkAction")}
      </button>
    );
  }
  return <ConnectWalletButton block={block} />;
}

/**
 * The paper account, in one card: the link state as the server states it —
 * enable with one wallet signature, sign again when the provider session
 * expired, disabled — and, once enabled, the paper balance, the positions and
 * the orders as the provider holds them. Paper throughout; nothing here is
 * the real portfolio and the word says so on every figure.
 */
export function AccountCard({ account, locale, compact = false, eventId = null }: { account: Account; locale: WorkspaceLocale; compact?: boolean; /** Filter positions and orders to one event on the detail page. */ eventId?: string | null }) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  const { state, link } = account;

  const head = (
    <div className={styles.cardHead}>
      <h2 className={styles.cardTitle}>{word("accountTitle")}</h2>
    </div>
  );

  if (state.status === "loading") {
    return (
      <section className={styles.card} aria-busy="true">
        {head}
        <div className={styles.skeleton}>
          <span className={styles.bone} />
          <span className={styles.bone} />
        </div>
      </section>
    );
  }

  if (state.status === "guest") {
    // Beside a ticket or on the hub the one way in is the ticket's or the header's: no second card saying the same.
    if (compact) return null;
    return (
      <section className={styles.card} aria-labelledby="pred-account">
        <div className={styles.cardHead}>
          <h2 id="pred-account" className={styles.cardTitle}>
            {word("accountTitle")}
          </h2>
        </div>
        <EmptyState icon="wallet" text={word("accountGuest")} action={<ConnectAction account={account} locale={locale} />} />
      </section>
    );
  }

  if (state.status === "failed" && !state.account) {
    return (
      <section className={styles.card} role="status">
        {head}
        <div className={styles.linkCard}>
          <p className={styles.note}>{word("unavailable")}</p>
          <button type="button" className="rw-btn" onClick={() => void account.refresh()}>
            {word("retry")}
          </button>
        </div>
      </section>
    );
  }

  const data = state.account!;
  const linkState = data.link;

  if (linkState.state !== "active") {
    const expired = linkState.state === "expired";
    return (
      <section className={styles.card}>
        {head}
        <div className={styles.linkCard} aria-live="polite">
          <h3>{expired ? word("expiredTitle") : word("notLinkedTitle")}</h3>
          {/* While the check is shown, its one sentence is the card's text. */}
          {link.status === "challenge" ? null : <p className={styles.note}>{expired ? word("expiredText") : word("notLinkedText")}</p>}
          {linkState.state === "revoked" ? <p className={styles.muted}>{word("revoked")}</p> : null}
          {!linkState.available ? <p className={styles.notice}>{word("linkUnavailable")}</p> : null}
          {link.status === "failed" ? <p className={styles.error}>{link.code === "WALLET_MISMATCH" ? word("walletMismatch") : link.code === "LINK_UNAVAILABLE" ? word("siteNotAllowed") : link.code === "NO_WALLET" ? word("walletFirst") : link.code === "CHALLENGE_FAILED" ? word("botCheckFailed") : link.code === "CHALLENGE_BLOCKED" ? word("botCheckBlocked") : link.code === "PROVIDER_UNAVAILABLE" || link.code === "RATE_LIMITED" ? word("unavailable") : link.code === "REFUSED" ? link.reason : link.reason || word("unavailable")}</p> : null}
          {link.status === "challenge" ? (
            <>
              <p className={styles.notice}>
                <b>{word("botCheckTitle")}.</b> {word("botCheckText")}
              </p>
              <BotCheck key={link.round} siteKey={link.siteKey} locale={locale} onToken={(token) => void account.enable(token)} onFail={account.challengeFailed} />
              <div className={styles.actions}>
                <button type="button" className="rw-btn" onClick={account.cancelChallenge}>
                  {word("cancel")}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <button type="button" className="rw-btn rw-btn--primary" disabled={!linkState.available || link.status === "signing" || link.status === "verifying"} onClick={() => void account.enable()}>
                {link.status === "signing" || link.status === "verifying" ? word("linking") : word("linkAction")}
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const balance = data.balance;
  const positions = eventId ? data.positions.filter((p) => (p.eventId ?? p.venueEventId) === eventId) : data.positions;
  /* A quote that was reviewed and never placed is not an order. */
  const placed = data.orders.filter((o) => o.state !== "reviewed");
  const orders = (eventId ? placed.filter((o) => o.eventId === eventId) : placed).slice(0, compact ? 5 : 20);

  return (
    <section className={styles.card} aria-labelledby="pred-account">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-account" className={styles.cardTitle}>
          {word("accountTitle")}
        </h2>
        <span className={styles.cardHeadEnd}>
          {compact && paths.portfolio ? (
            <Link className={styles.cardLink} href={paths.portfolio} prefetch={false}>
              {word("openPortfolio")} →
            </Link>
          ) : null}
          <span className={styles.stateChip} data-tone="good">
            {word("linked")}
          </span>
        </span>
      </div>
      {data.providerFailure ? <p className={styles.notice} style={{ margin: "var(--ry-s3) var(--ry-s4) 0" }}>{data.providerFailure.code === "SESSION_EXPIRED" ? word("sessionExpired") : word("unavailable")}</p> : null}
      {data.access?.locationBlocked ? (
        <p className={styles.notice} role="status" style={{ margin: "var(--ry-s3) var(--ry-s4) 0" }}>
          {word("locationBlocked")}
        </p>
      ) : null}
      <div className={styles.accountStrip}>
        <Metric label={word("cash")} value={balance ? usd(balance.cashBalance) : "—"} sub={balance ? `${word("balance")} · ${usd(balance.startingBalance, 0)}` : null} />
        <Metric label={word("positionsValue")} value={balance ? usd(balance.positionsValue) : "—"} />
        <Metric label={word("unrealized")} value={balance ? usd(balance.unrealizedPnl) : "—"} tone={balance ? (balance.unrealizedPnl > 0 ? "pos" : balance.unrealizedPnl < 0 ? "neg" : undefined) : undefined} />
        <Metric label={word("realized")} value={balance ? usd(balance.realizedPnl) : "—"} tone={balance ? (balance.realizedPnl > 0 ? "pos" : balance.realizedPnl < 0 ? "neg" : undefined) : undefined} />
      </div>
      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("positions")}</h3>
      </div>
      {positions.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("noPositions")}
        </p>
      ) : (
        <div>
          {positions.slice(0, compact ? 4 : 30).map((position) => (
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
                    {word("current")} <b>{pct(o.currentPrice)}</b>
                  </span>
                  <span>
                    {word("value")} <b>{usd(o.totalValue)}</b>
                  </span>
                  <span className={styles.delta} data-tone={o.unrealizedPnl > 0 ? "pos" : o.unrealizedPnl < 0 ? "neg" : undefined}>
                    {o.unrealizedPnl >= 0 ? "+" : ""}
                    {usd(o.unrealizedPnl)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("orders")}</h3>
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
                {compact ? null : <th>{word("outcome")}</th>}
                <th>{word("amount")}</th>
                {compact ? null : <th>{word("buysAt")}</th>}
                <th>{word("orderState")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.quoteId} order={order} locale={locale} compact={compact} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className={styles.disclosure}>
        <summary>{word("details")}</summary>
        <div className={styles.disclosureBody}>
          <p>
            {word("linkedSince")} {data.link.since ? timeShort(data.link.since, locale) : "—"}
            {data.link.refreshedAt ? ` · ${word("refreshed")} ${timeShort(data.link.refreshedAt, locale)}` : ""}
          </p>
          {!data.link.externalIdLinked && data.link.linkError === "signing_key_missing" ? <p>{word("linkKeyMissing")}</p> : null}
          <p>{word("providerNote")}</p>
          <button type="button" className="rw-btn" onClick={() => void account.disable()}>
            {word("revoke")}
          </button>
        </div>
      </details>
    </section>
  );
}

function Metric({ label, value, sub = null, tone }: { label: string; value: string; sub?: string | null; tone?: "pos" | "neg" }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue} style={tone === "pos" ? { color: "var(--ry-pnl-pos)" } : tone === "neg" ? { color: "var(--ry-pnl-neg)" } : undefined}>
        {value}
      </span>
      {sub ? <span className={styles.metricSub}>{sub}</span> : null}
    </div>
  );
}

export function orderTone(state: PredictionOrderRecord["state"]): "good" | "wait" | "bad" | undefined {
  if (state === "filled") return "good";
  if (state === "partially_filled") return "wait";
  if (state === "submitted") return "wait";
  if (state === "failed" || state === "cancelled" || state === "expired") return "bad";
  return undefined;
}

export function orderStateWord(state: PredictionOrderRecord["state"], word: ReturnType<typeof wordsFor>): string {
  switch (state) {
    case "filled":
      return word("filled");
    case "partially_filled":
      return word("partiallyFilled");
    case "submitted":
      return word("submitted");
    case "failed":
      return word("failed");
    case "cancelled":
      return word("cancelled");
    case "expired":
      return word("expired");
    default:
      return word("review");
  }
}

function OrderRow({ order, locale, compact = false }: { order: PredictionOrderRecord; locale: WorkspaceLocale; compact?: boolean }) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  const filled = order.execution?.orders.find((o) => o.executionPrice != null) ?? null;
  return (
    <tr>
      <th scope="row">
        <Link href={paths.event(order.eventId)} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
          {order.question}
        </Link>
        <br />
        <small style={{ color: "var(--ry-muted)", fontWeight: 500 }}>
          {compact ? `${outcomeLabel(order.outcomeLabel, locale)} · ` : ""}
          {timeShort(order.createdAt, locale)}
          {order.review.venues.length > 0 ? ` · ${order.review.venues.map(venueName).join(" + ")}` : ""}
        </small>
      </th>
      {compact ? null : <td>{outcomeLabel(order.outcomeLabel, locale)}</td>}
      <td>{order.side === "buy" ? usd(order.requested) : `${shares(order.requested)} sh`}</td>
      {compact ? null : <td>{pct(filled?.executionPrice ?? order.review.figures.probability)}</td>}
      <td>
        <span className={styles.stateChip} data-tone={orderTone(order.state)}>
          {orderStateWord(order.state, word)}
        </span>
      </td>
    </tr>
  );
}
