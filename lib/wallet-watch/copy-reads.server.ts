/**
 * The production side of the copies' day ceiling (`./run.ts` `CopyReads`): one instance spends at most
 * `RYNTRA_AGENT_COPY_DAILY_CREDITS` credits a calendar day (UTC; 60 000 unless set) reading wallets that are copied on
 * paper and followed by nobody — on the mainnet node, Helius's in production. The same day budget as the coin page's
 * scans (`../spot/day-budget.ts`): counted in the process, a bound, not a meter; a new day starts from nothing.
 *
 * Reads only: it signs nothing and sends nothing.
 */

import { dayBudget, dayCeilingOf } from "../spot/day-budget.ts";
import type { CopyReads } from "./run.ts";

export const COPY_DAILY_ENV = "RYNTRA_AGENT_COPY_DAILY_CREDITS";
/* Eight quiet leaders a day at the worst price of a call (10 credits, one read every pass); the lead's review of #1966. */
export const COPY_DAILY_CREDITS = 60_000;

type Env = Readonly<Record<string, string | undefined>>;

const day = dayBudget();

/** The copies' reads under the day's ceiling of this deployment. */
export function copyReads(env: Env = process.env): CopyReads {
  const ceiling = dayCeilingOf(env[COPY_DAILY_ENV], COPY_DAILY_CREDITS);
  return {
    allows: (credits, nowMs) => day.allows(credits, ceiling, nowMs),
    spend: (credits, nowMs) => day.spend(credits, nowMs),
  };
}

/** What the copies' reads spent in this instance today — for the lead's check of the credits. */
export function copyReadsSpent(nowMs: number = Date.now()): number {
  return day.spent(nowMs);
}
