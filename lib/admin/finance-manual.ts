/**
 * The costs Ryntra pays that no ledger of its own records yet (MET-1) — the bills: RPC and market data, the cloud's
 * workers, signing, delivery (webhooks, Telegram, push), support. Pure and client-safe.
 *
 * Each row is one bill for one month, entered by hand from the bill itself and named by it (`source`); the panel marks
 * every such figure «вручну». A line with no row is «немає даних» — never a zero —, and the contribution margin is then a
 * ceiling (≤). A figure is never estimated here: a row is a bill that was paid, or it is not written.
 *
 * Rows change through a pull request, like every record of the repository; the panel reads them as they are.
 */

/* The model's tokens are not here: the assistant's receipts price every call, and a bill beside them would count them twice. */
export const MANUAL_COST_LINES = ["rpcData", "workers", "signing", "delivery", "support"] as const;
export type ManualCostLine = (typeof MANUAL_COST_LINES)[number];

export type ManualCostEntry = Readonly<{
  line: ManualCostLine;
  /** The month the bill is for, `YYYY-MM`. */
  month: string;
  /** What was paid, in dollars, as decimal text — `"49.00"`. */
  usd: string;
  /** The bill: the provider and its number or link. */
  source: string;
  /** When the row was written, ISO. */
  enteredAt: string;
}>;

/** No bill has been entered yet. */
export const MANUAL_COSTS: readonly ManualCostEntry[] = [];

const MONTH = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const DOLLARS = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;

/** A row's dollars in micros; null when the row is not one this file accepts — then it is not counted, and said so. */
export function manualCostMicros(entry: ManualCostEntry): bigint | null {
  if (!(MANUAL_COST_LINES as readonly string[]).includes(entry.line) || !MONTH.test(entry.month) || !DOLLARS.test(entry.usd) || entry.source.trim() === "") return null;
  const [whole, fraction = ""] = entry.usd.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

/** The first month of Ryntra's fees on Solana — the panel's period starts there (as the growth budget's does). */
export const MANUAL_FIRST_MONTH = "2026-09";

/** Every month from `MANUAL_FIRST_MONTH` to the month of `now`, `YYYY-MM`. */
export function manualMonths(now: string): readonly string[] {
  const months: string[] = [];
  let [year, month] = MANUAL_FIRST_MONTH.split("-").map(Number) as [number, number];
  const last = new Date(Date.parse(now)).toISOString().slice(0, 7);
  while (`${year}-${String(month).padStart(2, "0")}` <= last) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
