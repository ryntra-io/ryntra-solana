import { isWeekStart, previousWeek, weekRange } from "./weeks.ts";
import { panelWalletsMeasured, sourceTable, walletOrigins, type PanelInputs, type PanelSourceRow } from "./panel.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";

/**
 * The week of the growth panel as CSV, for the «Медіа · Тиждень» session (MEDIA §12): one row per source — visits,
 * the week's new external wallets, how many of them bought by the time of the export, the wallets whose first
 * purchase fell in the week — then the week's totals as named figures. A week is Monday 00:00 UTC to the next
 * Monday (`weeks.ts`); the default is the last full week. Pure: the route reads the inputs.
 */

export const CSV_COLUMNS = [
  "week_start",
  "week_end",
  "row",
  "channel",
  "source",
  "label",
  "detail",
  "visits",
  "new_wallets",
  "bought_since",
  "first_purchases_in_week",
  "known_wallets",
  "value",
] as const;

/** The week an export asks for: a Monday `YYYY-MM-DD`, or the last full week. Null when the ask is not a week. */
export function exportWeek(asked: string | null, now: string): Readonly<{ start: string; end: string }> | null {
  if (!asked) return previousWeek(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) return null;
  const start = `${asked}T00:00:00.000Z`;
  if (!Number.isFinite(Date.parse(start)) || !isWeekStart(start) || Date.parse(start) > Date.parse(now)) return null;
  return weekRange(start);
}

/** A cell as a spreadsheet reads it: quoted when it must be, and never a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isPurchase(action: SolanaWalletAction): boolean {
  return (action.lane === "SWAP" || action.lane === "CROSS_SWAP") && action.outcome === "DONE" && action.network === "mainnet";
}

export function weeklyCsv(input: PanelInputs, week: Readonly<{ start: string; end: string }>): string {
  const nowMs = Date.parse(input.now);
  const endMs = Math.min(Date.parse(week.end), nowMs);
  const end = endMs === nowMs ? input.now : week.end;
  const startMs = Date.parse(week.start);
  const table = sourceTable(input, { start: week.start, end });
  const origins = walletOrigins(input);
  const internal = input.business.internalWallets;

  /* First purchases in the week, by the source of the wallet that made them. */
  const firstPurchase = new Map<string, number>();
  for (const action of input.business.actions) {
    if (!isPurchase(action) || internal.has(action.wallet)) continue;
    const at = Date.parse(action.startedAt);
    const current = firstPurchase.get(action.wallet);
    if (Number.isFinite(at) && (current === undefined || at < current)) firstPurchase.set(action.wallet, at);
  }
  const firstInWeek = new Map<string, number>();
  for (const [wallet, at] of firstPurchase) {
    if (at < startMs || at >= Date.parse(week.end) || at > nowMs) continue;
    const key = origins.get(wallet)?.key ?? "direct";
    firstInWeek.set(key, (firstInWeek.get(key) ?? 0) + 1);
  }
  const firstTotal = [...firstInWeek.values()].reduce((a, b) => a + b, 0);
  const firstTagged = [...firstInWeek.entries()].filter(([key]) => key !== "direct").reduce((a, [, b]) => a + b, 0);

  /* Active investors at the week's end: external wallets with a purchase in the thirty days before it. */
  const aimWallets = new Set<string>();
  for (const action of input.business.actions) {
    if (!isPurchase(action) || internal.has(action.wallet)) continue;
    const at = Date.parse(action.startedAt);
    if (at < endMs && at >= endMs - 30 * 86_400_000) aimWallets.add(action.wallet);
  }

  const startDay = week.start.slice(0, 10);
  const endDay = new Date(Date.parse(week.end) - 1).toISOString().slice(0, 10);
  const lines: string[] = [CSV_COLUMNS.join(",")];
  /* A record that did not read leaves its cells empty — never a zero (the panel's rule 6). */
  const measured = panelWalletsMeasured(input);
  const sourceLine = (row: PanelSourceRow, kind: string, first: number) =>
    [startDay, endDay, kind, row.channel, row.key, row.label, row.detail, row.visits, row.wallets, row.purchased, measured ? first : null, row.known, null].map(csvCell).join(",");
  for (const row of table.rows) lines.push(sourceLine(row, "source", firstInWeek.get(row.key) ?? 0));
  lines.push(sourceLine(table.direct, "source", firstInWeek.get("direct") ?? 0));
  lines.push(sourceLine(table.tagged, "total", firstTagged));
  lines.push(sourceLine(table.all, "total", firstTotal));
  const metric = (name: string, label: string, value: number | null) =>
    lines.push([startDay, endDay, "metric", null, name, label, null, null, null, null, null, null, value].map(csvCell).join(","));
  metric("tagged_visits", "Візити з мітками", table.tagged.visits);
  metric("new_external_wallets", "Нові зовнішні гаманці", table.all.wallets);
  metric("first_purchases", "Перші купівлі тижня", measured ? firstTotal : null);
  metric("aim_week_end", "Активні інвестори місяця на кінець тижня", input.business.sources.actions === "measured" ? aimWallets.size : null);
  return `${lines.join("\r\n")}\r\n`;
}
