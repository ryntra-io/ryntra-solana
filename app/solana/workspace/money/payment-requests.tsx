"use client";

import { useEffect, useState } from "react";
import { Block } from "@ryntra/core/ui";

import { StatusChip, type RiskTone } from "@/app/shell/status-chip";
import { displayAmount } from "@/lib/solana/amounts";

import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./payment-requests.module.css";

/** One of this wallet's payment links, as `/api/pay/requests` lists it. */
type Row = Readonly<{
  id: string;
  status: "AWAITING" | "PAID" | "EXPIRED" | "CHECKING" | "UNKNOWN";
  note: "UNDERPAID" | "WRONG_TOKEN" | "OVERPAID" | null;
  token: Readonly<{ symbol: string; decimals: number }>;
  amount: Readonly<{ display: string }> | null;
  description: string | null;
  createdAt: string;
  url: string;
  /** What arrived in the requested token so far, every payment summed (FIX-PAY-1). */
  received: Readonly<{ raw: string; feeWithheldRaw: string | null }> | null;
}>;

type Read = Readonly<{ state: "loading" } | { state: "ready"; rows: readonly Row[] } | { state: "failed" }>;

const STATUS: Readonly<Record<Row["status"], Readonly<{ en: string; uk: string; tone: RiskTone | null }>>> = {
  PAID: { en: "Paid", uk: "Оплачено", tone: "verified" },
  AWAITING: { en: "Waiting", uk: "Чекає", tone: null },
  EXPIRED: { en: "Expired", uk: "Минув", tone: null },
  CHECKING: { en: "Checking", uk: "Перевіряємо", tone: "unknown" },
  UNKNOWN: { en: "Not known yet", uk: "Ще невідомо", tone: "unknown" },
};

/* A mismatch the creator must see in the row itself, not behind a bare «Оплачено» (SEC-1, FIX-PAY-1). */
const NOTED: Readonly<Record<NonNullable<Row["note"]>, Readonly<{ en: string; uk: string; tone: RiskTone | null }>>> = {
  OVERPAID: { en: "Paid · more than asked", uk: "Оплачено · більше, ніж просили", tone: "verified" },
  UNDERPAID: { en: "Paid in part", uk: "Оплачено частково", tone: "unknown" },
  WRONG_TOKEN: { en: "Another token arrived", uk: "Надійшов інший токен", tone: "unknown" },
};

const PAID_TWICE = { en: "Paid · more than once", uk: "Оплачено · більше одного разу", tone: "verified" } as const;

function chipOf(row: Row) {
  if (row.note === "OVERPAID" && row.status === "PAID") return row.amount === null ? PAID_TWICE : NOTED.OVERPAID;
  if (row.note && row.note !== "OVERPAID" && row.status !== "PAID") return NOTED[row.note];
  return STATUS[row.status] ?? STATUS.UNKNOWN;
}

/**
 * «Запити на оплату» beside «Отримати» (B18; decision 58: payment links and Solana Pay live in «Гроші»): the links this
 * wallet asked money with — what for, how much, and where each stands — read from the wallet's own list on the server
 * (`GET /api/pay/requests`, behind the wallet's proof), so the requests made on a phone are here too. «Оплачено» comes
 * only from the request's own reference seen on chain (`lib/pay`), never from a balance. A row opens the payment page.
 *
 * Without the wallet's proof the list cannot be read and the block says so in one line: the request form's own button
 * is the sign-in, and a second one here would be the same press twice.
 */
export function PaymentRequests({ address, proven, version }: { address: string; proven: boolean; version: number }) {
  const { locale } = useSolanaI18n();
  const uk = locale === "uk";
  const [read, setRead] = useState<Read>({ state: "loading" });

  useEffect(() => {
    if (!proven) return undefined;
    let live = true;
    setRead({ state: "loading" });
    void fetch(`/api/pay/requests?address=${encodeURIComponent(address)}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { ok?: boolean; rows?: readonly Row[] } | null) => {
        if (!live) return;
        setRead(payload?.ok && Array.isArray(payload.rows) ? { state: "ready", rows: payload.rows } : { state: "failed" });
      })
      .catch(() => {
        if (live) setRead({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, [address, proven, version]);

  const title = uk ? "Запити на оплату" : "Payment requests";
  if (!proven) {
    return (
      <Block title={title} icon="receipt" lang={uk ? "uk" : "en"} data-payment-requests="">
        <p className={styles.empty}>{uk ? "Твої запити з'являться тут після входу гаманцем." : "Your requests appear here once you sign in with your wallet."}</p>
      </Block>
    );
  }
  const rows = read.state === "ready" ? read.rows.slice(0, 5) : [];
  return (
    <Block title={title} icon="receipt" lang={uk ? "uk" : "en"} loading={read.state === "loading"} data-payment-requests="">
      {read.state === "failed" ? (
        <p className={styles.empty}>{uk ? "Запити зараз не вдалося прочитати." : "Your requests could not be read right now."}</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{uk ? "Запитів ще немає — створи перший у «Запит на оплату»." : "No requests yet — make the first under “Request a payment”."}</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => {
            const status = chipOf(row);
            /* An open request says what came, so a bare «Оплачено» never hides a token's dust. */
            const arrived = row.received && (row.note !== null || row.amount === null) ? `${uk ? "Надійшло" : "Arrived"} ${displayAmount(row.received.raw, row.token.decimals)} ${row.token.symbol}` : null;
            return (
              <li key={row.id}>
                <a className={styles.row} href={row.url} target="_blank" rel="noreferrer">
                  <span className={styles.what}>
                    <span className={styles.amount} translate="no">
                      {row.amount ? `${row.amount.display} ${row.token.symbol}` : `${row.token.symbol} · ${uk ? "будь-яка сума" : "any amount"}`}
                    </span>
                    {row.description ? <span className={styles.note}>{row.description}</span> : null}
                    {arrived ? <span className={styles.note} translate="no">{arrived}</span> : null}
                  </span>
                  {status.tone ? (
                    <StatusChip family="risk" tone={status.tone}>
                      {uk ? status.uk : status.en}
                    </StatusChip>
                  ) : (
                    <StatusChip family="descriptor">{uk ? status.uk : status.en}</StatusChip>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}
