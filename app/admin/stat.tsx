"use client";

import { ADMIN_METRICS, type MetricId } from "@/lib/admin/metrics";
import type { Cell, CellStatus } from "@/lib/admin/overview";

import styles from "./admin.module.css";
import ext from "./panels.module.css";
import { formatInt, formatPercent, formatUsd } from "./format";

/**
 * A tile is a value and a status, never a value alone. The four non-measured
 * states each have their own words so an operator can tell "measured zero"
 * from "not collected yet" from "the source failed" from "too small a sample".
 */
export const CELL_STATUS_LABEL: Record<Exclude<CellStatus, "measured">, string> = {
  unknown: "немає даних",
  not_collected: "не збирається",
  unavailable: "джерело недоступне",
  insufficient: "замало даних",
  none: "—",
};

export type StatFormat = "int" | "percent" | "hours" | "usd";

export function cellText(cell: Cell, format: StatFormat = "int"): string {
  if (cell.status !== "measured" || typeof cell.value !== "number") {
    return cell.status === "measured" ? "немає даних" : CELL_STATUS_LABEL[cell.status];
  }
  if (format === "percent") return formatPercent(cell.value);
  if (format === "usd") return formatUsd(cell.value);
  if (format === "hours") {
    if (cell.value < 1) return "< 1 год";
    if (cell.value < 48) return `${formatInt(cell.value)} год`;
    return `${formatInt(Math.round(cell.value / 24))} дн`;
  }
  return formatInt(cell.value);
}

export function Stat({
  cell,
  label,
  format = "int",
  metric,
}: {
  cell: Cell;
  label: string;
  format?: StatFormat;
  metric?: MetricId;
}) {
  const known = cell.status === "measured" && typeof cell.value === "number";
  const definition = metric ? ADMIN_METRICS[metric] : null;
  const suffix =
    known && typeof cell.n === "number"
      ? ` · n=${formatInt(cell.n)}`
      : cell.status === "insufficient" && typeof cell.n === "number"
        ? ` · n=${formatInt(cell.n)}`
        : "";
  return (
    <div className={styles.stat} data-status={cell.status} data-metric={metric}>
      <b
        className={`${styles.statValue} ${known ? "" : styles.statUnknown}`}
        title={definition ? `${definition.rule}. ${definition.window}, ${definition.timezone}.` : undefined}
      >
        {cellText(cell, format)}
      </b>
      <span className={styles.statLabel}>
        {label}
        {suffix ? <span className={ext.statSuffix}>{suffix}</span> : null}
        {cell.period ? <span className={ext.statSuffix}> · тиждень {cell.period}</span> : null}
      </span>
    </div>
  );
}

/** Legacy numeric tile, kept for surfaces that still pass a plain number. */
export function PlainStat({ value, label }: { value: number | undefined; label: string }) {
  const cell: Cell = typeof value === "number" ? { value, status: "measured" } : { value: undefined, status: "unknown" };
  return <Stat cell={cell} label={label} />;
}

/**
 * The card's definitions, one disclosure deep. Reachable is the honesty
 * requirement; printed at rest never was.
 */
export function MetricDefinitions({ ids, label = "Як рахуємо" }: { ids: readonly MetricId[]; label?: string }) {
  return (
    <details className={ext.defs}>
      <summary className={ext.defsSummary}>{label}</summary>
      <dl className={ext.defsList}>
        {ids.map((id) => {
          const d = ADMIN_METRICS[id];
          return (
            <div key={id} className={ext.defsItem}>
              <dt>
                {d.label} <span className={ext.defsUnit}>{unitLabel(d.unit)}</span>
              </dt>
              <dd>
                <span>{d.rule}.</span>
                <span className={ext.defsMeta}>
                  Джерело: {d.source}. Вікно: {d.window}, {d.timezone}. Дедуплікація: {d.dedup}.
                  {d.denominator !== "—" ? ` Знаменник: ${d.denominator}.` : ""} Покриття: {d.coverage}. Свіжість: {d.freshness}.
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

function unitLabel(unit: (typeof ADMIN_METRICS)[MetricId]["unit"]): string {
  switch (unit) {
    case "accounts":
      return "акаунти";
    case "logins":
      return "входи";
    case "events":
      return "події";
    case "threads":
      return "треди";
    case "hours":
      return "години";
    case "rate":
      return "частка";
    case "rows":
      return "рядки";
    case "addresses":
      return "адреси";
    case "deliveries":
      return "доставки";
    case "clicks":
      return "кліки";
    case "services":
      return "сервіси";
    case "wallets":
      return "гаманці";
    case "trades":
      return "угоди";
    case "usd":
      return "USD";
    default:
      return "";
  }
}
