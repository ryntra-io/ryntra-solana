"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantCreditOrder, AssistantCreditOrderResponse, AssistantCreditOrdersResponse, AssistantCreditPackage, AssistantCreditPurchase, AssistantCredits } from "@/lib/api/v1/contract";
import { explorerTxUrl } from "@/lib/solana/explorer";

import styles from "./ryn.module.css";
import type { RynWord } from "./ryn-words";

/**
 * Buying credits for USDC (AI-12) inside the «Кредити» fold: four packages; a
 * chosen one opens an order paid on the payment page the product already has
 * (`/pay/<id>` — a QR for a phone camera, a wallet in the browser). The order
 * is read again every few seconds until the chain says it is paid; the
 * credits are added by the server once, and the receipt stays under the order.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const POLL_MS = 5_000;
/** After the order's window the page keeps reading a little longer — a payment signed at the last second still lands. */
const POLL_AFTER_MS = 5 * 60_000;

type Word = (w: RynWord) => string;
type Unit = (n: number) => string;

const fill = (template: string, values: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

function live(order: AssistantCreditOrder, nowMs: number): boolean {
  if (order.status === "paid") return false;
  return nowMs < Date.parse(order.expiresAt) + POLL_AFTER_MS;
}

/** One read of an order picked from the list — the server reads the chain for it whatever its age. */
async function readOne(id: string): Promise<AssistantCreditOrderResponse | null> {
  try {
    const response = await fetch(`/api/v1/assistant/credits/orders/${encodeURIComponent(id)}`, { headers: HEADERS, credentials: "same-origin", cache: "no-store" });
    return response.ok ? ((await response.json()) as AssistantCreditOrderResponse) : null;
  } catch {
    return null;
  }
}

export function CreditsBuy({ locale, word, unit, purchase, onCredits }: { locale: WorkspaceLocale; word: Word; unit: Unit; purchase: AssistantCreditPurchase | null; onCredits: (credits: AssistantCredits) => void }) {
  const tag = locale === "uk" ? "uk-UA" : "en-GB";
  const number = useCallback((n: number) => new Intl.NumberFormat(tag).format(n), [tag]);
  const [orders, setOrders] = useState<readonly AssistantCreditOrder[] | null>(null);
  const [current, setCurrent] = useState<AssistantCreditOrder | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const credited = useRef<Map<string, number>>(new Map());

  const take = useCallback(
    (order: AssistantCreditOrder, credits: AssistantCredits) => {
      setCurrent((shown) => (shown && shown.id === order.id ? order : shown));
      setOrders((list) => (list ? list.map((entry) => (entry.id === order.id ? order : entry)) : list));
      /* The figures moved only when credits were added: then the balance above and the price line follow. */
      if (credited.current.get(order.id) !== order.credited) {
        credited.current.set(order.id, order.credited);
        onCredits(credits);
      }
    },
    [onCredits],
  );

  /* The receipts: read once when the fold shows this part (the server reads the chain for orders still open). */
  const available = purchase?.available ?? false;
  useEffect(() => {
    if (!available) return;
    let alive = true;
    void fetch("/api/v1/assistant/credits/orders", { headers: HEADERS, credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<AssistantCreditOrdersResponse>) : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        if (!alive) return;
        for (const order of body.orders) credited.current.set(order.id, order.credited);
        setOrders(body.orders);
        onCredits(body.credits);
        const open = body.orders.find((order) => order.status !== "paid" && live(order, Date.now()));
        if (open) setCurrent(open);
      })
      .catch(() => {
        if (alive) setOrders([]);
      });
    return () => {
      alive = false;
    };
  }, [available, onCredits]);

  /* The order on screen: its QR, and a read every few seconds while a payment may still arrive. */
  const currentId = current?.id ?? null;
  const currentPage = current?.payPage ?? null;
  const polling = current ? live(current, Date.now()) : false;
  useEffect(() => {
    if (!currentPage) {
      setQr(null);
      return;
    }
    let alive = true;
    void import("qrcode")
      .then((module) => module.default.toDataURL(currentPage, { errorCorrectionLevel: "M", margin: 1, width: 360 }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [currentPage]);

  useEffect(() => {
    if (!currentId || !polling) return;
    let alive = true;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/v1/assistant/credits/orders/${encodeURIComponent(currentId)}`, { headers: HEADERS, credentials: "same-origin", cache: "no-store" });
        if (!response.ok || !alive) return;
        const body = (await response.json()) as AssistantCreditOrderResponse;
        if (alive) take(body.order, body.credits);
      } catch {
        /* The next tick asks again; the card keeps what it last knew. */
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [currentId, polling, take]);

  const buy = useCallback(
    async (pkg: AssistantCreditPackage) => {
      if (busy) return;
      setBusy(pkg.id);
      setError(null);
      try {
        const response = await fetch("/api/v1/assistant/credits/orders", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ package: pkg.id, locale: locale === "uk" ? "uk" : "en" }) });
        if (!response.ok) {
          const code = ((await response.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
          setError(code === "RATE_LIMITED" ? word("orderLimit") : code === "CAPABILITY_UNAVAILABLE" ? word("buyClosed") : word("orderFailed"));
          return;
        }
        const body = (await response.json()) as AssistantCreditOrderResponse;
        credited.current.set(body.order.id, body.order.credited);
        setCurrent(body.order);
        setOrders((list) => [body.order, ...(list ?? []).filter((entry) => entry.id !== body.order.id)].slice(0, 10));
      } catch {
        setError(word("orderFailed"));
      } finally {
        setBusy(null);
      }
    },
    [busy, locale, word],
  );

  if (!purchase) return null;
  if (!purchase.available) {
    return (
      <section className={styles.section}>
        <h4 className={styles.briefPart}>{word("buyTitle")}</h4>
        <p className={styles.muted}>{word("buyClosed")}</p>
      </section>
    );
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", hour12: false });
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const statusLine = (order: AssistantCreditOrder): string => {
    switch (order.status) {
      case "paid":
        return fill(word("orderPaid"), { credited: number(order.credited), unit: unit(order.credited) });
      case "underpaid":
        return fill(word("orderUnderpaid"), { received: order.received.display, usdc: order.amount.display, credited: number(order.credited) });
      case "checking":
        return word("orderChecking");
      case "expired":
        return word("orderExpired");
      case "awaiting":
        return fill(word("orderAwaiting"), { time: time(order.expiresAt) });
    }
  };
  const shortStatus: Readonly<Record<AssistantCreditOrder["status"], RynWord>> = { paid: "statusPaid", underpaid: "statusUnderpaid", checking: "statusChecking", expired: "statusExpired", awaiting: "statusAwaiting" };
  /* Every recent order, an expired one too: opening it reads it again, so a late payment is never out of reach. */
  /* The pay page asks the full price until the order's 15 minutes run out: offered only while nothing has arrived yet. */
  const payable = current !== null && (current.status === "awaiting" || current.status === "checking") && Date.now() < Date.parse(current.expiresAt);
  const past = (orders ?? []).filter((order) => order.id !== current?.id).slice(0, 6);

  return (
    <section className={styles.section} id="credits-buy" aria-labelledby="credits-buy-title">
      <h4 className={styles.briefPart} id="credits-buy-title">
        {word("buyTitle")}
      </h4>
      <div className={styles.buyPackages} role="group" aria-label={word("buyTitle")}>
        {purchase.packages.map((pkg) => (
          <button key={pkg.id} type="button" className={styles.buyPackage} onClick={() => void buy(pkg)} disabled={busy !== null} aria-busy={busy === pkg.id} data-active={current?.package.id === pkg.id && current.status !== "paid" ? "true" : undefined}>
            <span className={styles.buyPrice}>${pkg.usdc}</span>
            <span className={styles.buyCredits}>
              {number(pkg.credits)} {unit(pkg.credits)}
            </span>
            {pkg.bonusPercent > 0 ? <span className={styles.buyBonus}>+{pkg.bonusPercent} %</span> : null}
          </button>
        ))}
      </div>
      <p className={styles.briefMeta}>{fill(word("buyNote"), { treasury: purchase.treasury?.abbreviated ?? "" })}</p>
      <div aria-live="polite">
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {current ? (
        <div className={styles.buyOrder} data-status={current.status}>
          {payable && qr ? (
            // A data URI drawn in the browser from the payment page's address; nothing for next/image to optimize.
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.buyQr} src={qr} alt={word("orderScan")} width={168} height={168} />
          ) : null}
          <div className={styles.buyOrderBody}>
            <p className={styles.buyOrderTitle}>{fill(word("orderPay"), { usdc: current.amount.display, credits: number(current.package.credits), unit: unit(current.package.credits) })}</p>
            <p className={styles.buyStatus} data-status={current.status} role="status">
              {statusLine(current)}
            </p>
            {current.wrongToken ? <p className={styles.error}>{word("orderWrong")}</p> : null}
            {payable ? (
              <>
                <a className="rw-btn rw-btn--primary" href={current.payPage} target="_blank" rel="noopener noreferrer">
                  {word("orderOpen")}
                  <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
                </a>
                {qr ? <p className={`${styles.briefMeta} ${styles.buyScanHint}`}>{word("orderScan")}</p> : null}
              </>
            ) : null}
            {current.payments.length > 0 ? <Receipt order={current} word={word} unit={unit} number={number} when={when} /> : null}
          </div>
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className={styles.marksLegend}>
          <summary>{word("buyRecent")}</summary>
          <ul className={styles.creditsEntries}>
            {past.map((order) => (
              <li key={order.id} className={styles.creditsEntry}>
                <button
                  type="button"
                  className={styles.buyPast}
                  onClick={() => {
                    setCurrent(order);
                    void readOne(order.id).then((body) => body && take(body.order, body.credits));
                  }}
                >
                  {order.amount.display} USDC · {word(shortStatus[order.status])}
                </button>
                <span className={styles.muted}>{when(order.createdAt)}</span>
                <span className={styles.creditsAmount} data-sign={order.credited > 0 ? "plus" : "minus"}>
                  {order.credited > 0 ? `+${number(order.credited)}` : "0"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Receipt({ order, word, unit, number, when }: { order: AssistantCreditOrder; word: Word; unit: Unit; number: (n: number) => string; when: (iso: string) => string }) {
  return (
    <details className={styles.marksLegend} open={order.status === "paid"}>
      <summary>{word("orderReceipt")}</summary>
      <dl className={styles.buyReceipt}>
        <div>
          <dt>{word("receiptPaid")}</dt>
          <dd>{order.received.display} USDC</dd>
        </div>
        <div>
          <dt>{word("receiptCredits")}</dt>
          <dd>
            +{number(order.credited)} {unit(order.credited)}
          </dd>
        </div>
        <div>
          <dt>{word("receiptTo")}</dt>
          <dd translate="no" title={order.treasury.address}>
            {order.treasury.abbreviated}
          </dd>
        </div>
        <div>
          <dt>{word("receiptOrder")}</dt>
          <dd translate="no">{order.id}</dd>
        </div>
        {order.payments.map((payment) => (
          <div key={payment.signature}>
            <dt>{payment.at ? `${word("receiptTx")} · ${when(payment.at)}` : word("receiptTx")}</dt>
            <dd>
              <a href={explorerTxUrl("mainnet", payment.signature)} target="_blank" rel="noopener noreferrer" translate="no">
                {payment.amount} USDC · {payment.signature.slice(0, 4)}…{payment.signature.slice(-4)}
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.briefMeta}>{word("buyRules")}</p>
    </details>
  );
}
