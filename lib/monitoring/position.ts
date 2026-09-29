import { positionOf } from "../plans/position.ts";
import { matchedExitResult, matchedExitRows, planResultFor } from "../plans/results.ts";
import type { TradingPlanRecord } from "../plans/store.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";

/**
 * Whether a trading plan is watched (canon v5.0 §11; RYN-FIRST-SCREEN-001,
 * S3): an active plan, for its entry rules; a plan whose buy settled, as a
 * position, for its loss limit — until the position the plan's own results
 * add up to is closed. The results are the ones Results reads: the plan's
 * declared executions and, where no other plan names the mint, the sales of
 * the same mint History holds after the entry (`matchedExitRows`); a partial
 * sale leaves the rest watched. A draft, a cancelled or an expired plan is
 * not watched. `competing` is how many other plans of the wallet name the
 * same mint: with any, a sale cannot be paired, and the position is watched
 * on — a missed warning costs more than a spare one.
 */
export function planIsWatched(record: TradingPlanRecord, status: string, rows: readonly SolanaWalletAction[], competing: number, nowMs: number): boolean {
  if (status === "active") return true;
  if (status !== "executed") return false;
  const declared = record.executions.map((execution) => planResultFor(record, execution, rows.find((row) => row.signature === execution.signature) ?? null, nowMs));
  const matched = matchedExitRows(record, rows, competing).map((row) => matchedExitResult(record, row, nowMs));
  return positionOf([...declared, ...matched]).state !== "closed";
}

/** How many of the wallet's other plans name this plan's mint. */
export function competingOf(records: readonly TradingPlanRecord[], record: TradingPlanRecord): number {
  return records.filter((other) => other.id !== record.id && other.asset.mint === record.asset.mint).length;
}
