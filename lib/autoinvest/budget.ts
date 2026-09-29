/**
 * «Бюджет місяця» — the person's own ceiling for every rule's purchases in a
 * calendar month (canon v5.1 §4.1, В19; `RYN-INVEST-SIMPLE-001`, session 4).
 *
 * **Only proof counts** (canon B.5). The month's spend is read from History:
 * a purchase made under a rule's reminder (`origin.rule`) whose receipt
 * settled counts the USDC that left the wallet; one signed and not settled
 * yet counts as spent until its outcome is known — an unknown purchase is
 * never room for another; a failed one moved no money and counts nothing. A
 * reminder nobody bought counts nothing either, and a purchase made outside
 * the rules is not the rules' spend.
 *
 * **The month is the person's.** From the 1st at 00:00 to the next 1st at
 * 00:00 on the budget's own clock (an IANA zone); a purchase counts in the
 * month it was signed in.
 *
 * **What is left decides.** A rule's purchase is reminded of only when it
 * fits what is left; one that does not is held — «Бюджет вичерпано» — and the
 * rules stand until the 1st. Ryntra never raises a ceiling or a sum itself.
 *
 * Pure: the clock, the rows and the ceiling are arguments.
 */

import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { wallClockAt, zonedInstant } from "./schedule.ts";

export type BudgetMonth = Readonly<{ startMs: number; endMs: number; key: string }>;

/** The calendar month an instant falls in, on a zone's wall clock: its first instant, the next month's first instant, and «2026-09». */
export function budgetMonth(nowMs: number, timeZone: string): BudgetMonth {
  const wall = wallClockAt(nowMs, timeZone);
  const next = wall.month === 12 ? { year: wall.year + 1, month: 1 } : { year: wall.year, month: wall.month + 1 };
  return {
    startMs: zonedInstant(wall.year, wall.month, 1, 0, 0, timeZone),
    endMs: zonedInstant(next.year, next.month, 1, 0, 0, timeZone),
    key: `${wall.year}-${String(wall.month).padStart(2, "0")}`,
  };
}

const cents = (usd: number): number => Math.round(usd * 100) / 100;

/** USDC that left the wallet on a row, in dollars; null where the row does not say. */
export function usdcOutOf(row: SolanaWalletAction): number | null {
  const out = row.out;
  if (!out || out.mint !== SOLANA_MAINNET_USDC_MINT || !/^\d+$/.test(out.amountRaw)) return null;
  return Number(BigInt(out.amountRaw)) / 1e6;
}

export type BudgetSpend = Readonly<{ spentUsd: number; unknownUsd: number }>;

/**
 * What the rules spent in a month: settled purchases, and signed ones whose
 * outcome is not known yet. A row that states no USDC counts its rule's sum,
 * where the rule is still there to say it.
 */
export function spendInMonth(rows: readonly SolanaWalletAction[], month: BudgetMonth, sumOfRule: (ruleId: string) => number | null = () => null): BudgetSpend {
  let spent = 0;
  let unknown = 0;
  for (const row of rows) {
    const rule = row.origin?.rule;
    if (!rule || row.outcome === "FAILED") continue;
    const at = Date.parse(row.startedAt);
    if (!(at >= month.startMs && at < month.endMs)) continue;
    const usd = usdcOutOf(row) ?? sumOfRule(rule.ruleId) ?? 0;
    if (row.outcome === "DONE") spent += usd;
    else unknown += usd;
  }
  return { spentUsd: cents(spent), unknownUsd: cents(unknown) };
}

/** What is left of a ceiling this month; never below nothing. */
export function remainingOf(capUsd: number, spend: BudgetSpend): number {
  return Math.max(0, cents(capUsd - spend.spentUsd - spend.unknownUsd));
}

/** Whether a purchase of a sum fits what is left — to the cent. */
export function fitsBudget(amountUsd: number, remainingUsd: number): boolean {
  return amountUsd <= remainingUsd + 0.005;
}
