"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import { OPERATION_PRODUCTS, type OperationProduct, type OperationRecord, type OperationStatus, type OperationVerification } from "@/lib/analytics/operations";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "./analytics.module.css";
import { formatAgo, formatDateTime, formatUsd } from "../format";

/**
 * Every operation, whole — the admin's disclosure of the one projection the
 * public statistics draw. The public page masks the wallet and hides the
 * plan; this table shows the full wallet, the operation id, the provider's
 * request id, the exact fees and their split, the verification state and the
 * reason behind it. Same rows, same figures; nothing here is a second truth.
 */

type Payload = Readonly<{ generatedAt: string; chainReadAt: string | null; chainComplete: boolean | null; operations: readonly OperationRecord[] }>;

const PRODUCT_LABEL: Record<OperationProduct | "ALL", string> = { ALL: "Усі", SWAP: "Swap", SPOT: "Spot", STOCK: "Акції", BRIDGE: "Bridge" };
const STATUS_LABEL: Record<OperationStatus | "ALL", string> = { ALL: "Усі стани", CONFIRMED: "Підтверджено", IN_FLIGHT: "У дорозі", NEEDS_YOU: "Потрібна дія", FAILED: "Не відбулось" };
const VERIFICATION_LABEL: Record<OperationVerification, string> = { VERIFIED: "у ланцюгу", PENDING: "очікує", NOT_ATTRIBUTABLE: "без маркера", NOT_APPLICABLE: "запис провайдера" };
const PROVIDER_LABEL = { JUPITER: "Jupiter", RELAY: "Relay", MAYAN: "Mayan", CIRCLE: "Circle CCTP" } as const;

function statusChip(status: OperationStatus): string {
  if (status === "CONFIRMED") return `${ext.chip} ${ext.chipOk}`;
  if (status === "FAILED") return `${ext.chip} ${ext.chipRisk}`;
  if (status === "NEEDS_YOU") return `${ext.chip} ${ext.chipWarn}`;
  return `${ext.chip} ${ext.chipMuted}`;
}

function verificationChip(verification: OperationVerification): string {
  if (verification === "VERIFIED") return `${ext.chip} ${ext.chipOk}`;
  if (verification === "PENDING") return `${ext.chip} ${ext.chipWarn}`;
  return `${ext.chip} ${ext.chipMuted}`;
}

function amount(text: string | null, symbol: string | null): string {
  if (text === null) return "—";
  return symbol ? `${text} ${symbol}` : text;
}

function actionText(row: OperationRecord): string {
  if (row.side && row.asset) return `${row.side === "BUY" ? "Купівля" : "Продаж"} ${row.asset}`;
  return row.action;
}

export function OperationsPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<OperationProduct | "ALL">("ALL");
  const [status, setStatus] = useState<OperationStatus | "ALL">("ALL");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/analytics/operations", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${response.status}`);
        return;
      }
      setPayload((await response.json()) as Payload);
      setError(null);
    } catch {
      setError("Сховище не відповіло.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (payload?.operations ?? []).filter((row) => (product === "ALL" || row.product === product) && (status === "ALL" || row.status === status)),
    [payload, product, status],
  );
  const counts = useMemo(() => {
    const all = payload?.operations ?? [];
    return {
      confirmed: all.filter((row) => row.status === "CONFIRMED").length,
      open: all.filter((row) => row.status === "IN_FLIGHT" || row.status === "NEEDS_YOU").length,
      verified: all.filter((row) => row.verification === "VERIFIED").length,
      unmarked: all.filter((row) => row.status === "CONFIRMED" && row.verification === "NOT_ATTRIBUTABLE").length,
    };
  }, [payload]);

  return (
    <section className={`${styles.card} ${biz.feedCard}`} aria-labelledby="ops-title">
      <div className={styles.cardHead}>
        <h2 id="ops-title" className={styles.cardTitle}>Операції</h2>
        <InfoControl label="Що тут">
          <p>
            Кожна операція з реєстру — та сама проєкція, що й публічна сторінка Stats, тільки без маскування: повний
            гаманець, id операції, запит провайдера, точні комісії та їхній поділ, стан перевірки в ланцюгу і причина.
            Рахуються лише підтверджені; рядок у дорозі або невдалий видно, але він не є обсягом.
          </p>
        </InfoControl>
        <span className={styles.cardNote}>
          {payload ? `${counts.confirmed} підтверджених · ${counts.verified} у ланцюгу · ${counts.unmarked} без маркера · ${counts.open} відкритих` : "—"}
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => void load()} disabled={loading} aria-label="Перечитати">
          <ArrowsClockwise size={16} weight="bold" aria-hidden />
        </button>
      </div>
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>Спробувати ще раз</button>
        </div>
      ) : null}
      <div className={ext.filters}>
        <div className={ext.filterChips} role="group" aria-label="Продукт">
          {(["ALL", ...OPERATION_PRODUCTS] as const).map((option) => (
            <button key={option} type="button" className={ext.filterChip} aria-pressed={product === option} onClick={() => setProduct(option)}>
              {PRODUCT_LABEL[option]}
            </button>
          ))}
        </div>
        <div className={ext.filterChips} role="group" aria-label="Стан">
          {(["ALL", "CONFIRMED", "IN_FLIGHT", "NEEDS_YOU", "FAILED"] as const).map((option) => (
            <button key={option} type="button" className={ext.filterChip} aria-pressed={status === option} onClick={() => setStatus(option)}>
              {STATUS_LABEL[option]}
            </button>
          ))}
        </div>
        {payload?.chainReadAt ? (
          <span className={ext.subtle}>
            ланцюг прочитано {formatAgo(payload.chainReadAt)}
            {payload.chainComplete === false ? " · частково" : ""}
          </span>
        ) : null}
      </div>
      {!payload && !error ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження операцій">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}
      {payload && rows.length === 0 ? <p className={ext.emptyLine}>За цим фільтром операцій немає.</p> : null}
      {rows.length > 0 ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Операції">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Коли</th>
                <th scope="col">Продукт</th>
                <th scope="col">Гаманець</th>
                <th scope="col">Дія</th>
                <th scope="col" className={styles.cellNum}>Обсяг</th>
                <th scope="col" className={styles.cellNum}>Комісія</th>
                <th scope="col">Стан</th>
                <th scope="col">Ланцюг</th>
                <th scope="col">Доказ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = open === row.id;
                return (
                  <OperationRows key={row.id} row={row} expanded={expanded} onToggle={() => setOpen(expanded ? null : row.id)} />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function OperationRows({ row, expanded, onToggle }: { row: OperationRecord; expanded: boolean; onToggle: () => void }) {
  const at = row.confirmedAt ?? row.startedAt;
  return (
    <>
      <tr>
        <td title={formatDateTime(at)}>
          <button type="button" className={ext.rowButton} aria-expanded={expanded} onClick={onToggle}>
            {formatAgo(at)}
          </button>
        </td>
        <td>{PRODUCT_LABEL[row.product]}<span className={ext.subtle}> · {PROVIDER_LABEL[row.provider]}</span></td>
        <td>
          <code className={styles.mono} title={row.wallet}>{`${row.wallet.slice(0, 6)}…${row.wallet.slice(-4)}`}</code>
          {row.internal ? <> <span className={biz.internalTag}>internal</span></> : null}
        </td>
        <td>{actionText(row)}</td>
        <td className={styles.cellNum}>{row.usd === null ? <span className={styles.cellMuted}>без USD</span> : formatUsd(row.usd)}</td>
        <td className={styles.cellNum}>
          {row.fee?.collected ? amount(row.fee.gross, row.fee.symbol) : <span className={styles.cellMuted}>{row.fee ? "не взято" : "—"}</span>}
        </td>
        <td><span className={statusChip(row.status)}>{STATUS_LABEL[row.status]}</span></td>
        <td><span className={verificationChip(row.verification)}>{VERIFICATION_LABEL[row.verification]}</span></td>
        <td>
          {row.links.length ? row.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" className={ext.subtle}>{link.label} ↗ </a>
          )) : "—"}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={9}>
            <dl className={ext.kv}>
              <div><dt>Id операції</dt><dd className={biz.opsMono}>{row.id}</dd></div>
              <div><dt>Гаманець</dt><dd className={biz.opsMono}>{row.wallet}</dd></div>
              <div><dt>Сплачено</dt><dd>{row.out ? amount(row.out.amount ?? row.out.amountRaw, row.out.symbol ?? row.out.mint) : "—"}</dd></div>
              <div><dt>Отримано</dt><dd>{row.in ? amount(row.in.amount ?? row.in.amountRaw, row.in.symbol ?? row.in.mint) : "—"}</dd></div>
              <div><dt>Обсяг</dt><dd>{row.usd === null ? "без USD" : `${formatUsd(row.usd)} · ${row.usdBasis === "PAR" ? "за номіналом" : "оцінка провайдера"}`}</dd></div>
              <div>
                <dt>Комісія</dt>
                <dd>
                  {row.fee
                    ? row.fee.collected
                      ? `${amount(row.fee.gross, row.fee.symbol)}${row.fee.basisPoints !== null ? ` · ${(row.fee.basisPoints / 100).toFixed(2)}%` : ""} · Ryntra ${amount(row.fee.ryntra, row.fee.symbol)} · провайдер ${row.fee.providerRaw ?? "—"} raw`
                      : `не взято (${row.fee.state ?? "NOT_COLLECTED"})${row.fee.note ? ` — ${row.fee.note}` : ""}`
                    : "на рядку комісії немає"}
                </dd>
              </div>
              <div><dt>Провайдер · запит</dt><dd className={biz.opsMono}>{PROVIDER_LABEL[row.provider]} · {row.providerRef ?? "—"}</dd></div>
              <div><dt>Підпис</dt><dd className={biz.opsMono}>{row.signature ?? "—"}</dd></div>
              {row.sourceTx || row.destinationTx ? <div><dt>Джерело · призначення</dt><dd className={biz.opsMono}>{row.sourceTx ?? "—"} · {row.destinationTx ?? "—"}</dd></div> : null}
              <div><dt>Квитанція</dt><dd className={biz.opsMono}>{row.receiptHash ?? "—"}</dd></div>
              <div><dt>План</dt><dd className={biz.opsMono}>{row.plan ? `${row.plan.planId} v${row.plan.version} · ${row.plan.reviewId}` : "—"}</dd></div>
              <div><dt>Почато · підтверджено</dt><dd>{formatDateTime(row.startedAt)} · {formatDateTime(row.confirmedAt)}</dd></div>
              <div><dt>Перевірка в ланцюгу</dt><dd>{VERIFICATION_LABEL[row.verification]}{row.verificationNote ? ` — ${row.verificationNote}` : ""}</dd></div>
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}
