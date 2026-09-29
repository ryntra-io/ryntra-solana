/**
 * The public statistics model — what `/stats` shows and `/api/stats` serves.
 *
 * Pure and client-safe: no clock, no store, no `process.env`. Two blocks that
 * are never mixed:
 *
 * - **The ledger** — Ryntra's own confirmed operations, projected by
 *   `lib/analytics/operations.ts`: every operation started through Ryntra,
 *   once, with its executed value, its fee and its verification state. This
 *   is the count the page shows, and it is read live.
 * - **On chain** — the independent witness: the figures anybody can
 *   reproduce from public Solana transactions with the rule in `rule.ts`,
 *   read on a shared ten-minute cache. It verifies the ledger's rows; it
 *   never adds to them. The two are shown as two numbers — *confirmed* and
 *   *attributable on chain* — and the gap between them is stated, not
 *   smoothed.
 *
 * Ryntra's own wallets are counted in and named as such rather than removed:
 * the chain does not know whose wallet is whose, so a figure that quietly
 * dropped them would no longer agree with what the chain shows.
 */

import {
  decimalText,
  filterOperations,
  OPERATION_RANGES,
  projectOperations,
  summarizeOperations,
  toPublicOperation,
  type OperationRange,
  type OperationSource,
  type OperationSummary,
  type PublicOperation,
} from "../analytics/operations.ts";
import type { AttributionRead } from "./chain.server.ts";

export { decimalText };

export type StatsFee = Readonly<{
  mint: string;
  symbol: string;
  decimals: number;
  /** Decimal text in the asset's own units, never rounded away. */
  gross: string;
  /** Ryntra's share after the provider's, or null when the share could not be read. */
  ryntra: string | null;
  operations: number;
}>;

export type StatsOnchain =
  | Readonly<{
      state: "ok";
      ruleVersion: string;
      referralAccount: string;
      tokenAccounts: readonly Readonly<{ address: string; symbol: string }>[];
      updatedAt: string;
      since: string | null;
      lastOperationAt: string | null;
      operations: number;
      wallets: number;
      valued: number;
      unvalued: number;
      volumeUsd: number;
      fees: readonly StatsFee[];
      ryntraSharePercent: number | null;
      coverage: Readonly<{ complete: boolean; signaturesSeen: number; transactionsRead: number; missing: number; truncated: boolean }>;
      /** Operations and wallets Ryntra has marked as its own (testing), counted in the figures above. */
      own: Readonly<{ operations: number; wallets: number }>;
      stocks: Readonly<{ state: "ok"; operations: number; volumeUsd: number; unvalued: number }> | Readonly<{ state: "unavailable" }>;
      sources: readonly string[];
    }>
  | Readonly<{ state: "unavailable"; code: string }>;

export type StatsLedger =
  | Readonly<{
      state: "ok";
      /** Confirmed operations, newest first, the wallet masked; bounded. */
      operations: readonly PublicOperation[];
      /** Totals over every product for each range, from the same rows. */
      summary: Readonly<Record<OperationRange, OperationSummary>>;
      /** How many confirmed operations the ledger holds beyond the rows carried here. */
      truncated: number;
    }>
  | Readonly<{ state: "unavailable" }>;

export type StatsModel = Readonly<{
  generatedAt: string;
  ledger: StatsLedger;
  onchain: StatsOnchain;
  /** A public dashboard, when the deployment names one; absent otherwise. Never a placeholder. */
  dashboardUrl: string | null;
}>;

const KNOWN_SYMBOLS: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

export function symbolOfMint(mint: string): string {
  return KNOWN_SYMBOLS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function usdFromMicros(micros: string | bigint): number {
  return Number(BigInt(micros)) / 1_000_000;
}

function isoOf(blockTime: number | null): string | null {
  return blockTime === null ? null : new Date(blockTime * 1000).toISOString();
}

export function buildOnchainStats(
  read: AttributionRead,
  args: Readonly<{ stockMints: ReadonlySet<string> | null; internalWallets: ReadonlySet<string> }>,
): StatsOnchain {
  if (!read.ok) return { state: "unavailable", code: read.code };
  const ownWallets = new Set<string>();
  let ownOperations = 0;
  let stockOperations = 0;
  let stockVolume = 0n;
  let stockUnvalued = 0;
  for (const operation of read.operations) {
    if (args.internalWallets.has(operation.taker)) {
      ownOperations += 1;
      ownWallets.add(operation.taker);
    }
    if (args.stockMints && operation.legs.some((leg) => args.stockMints!.has(leg.mint))) {
      stockOperations += 1;
      if (operation.valueUsdMicros === null) stockUnvalued += 1;
      else stockVolume += BigInt(operation.valueUsdMicros);
    }
  }
  return {
    state: "ok",
    ruleVersion: read.ruleVersion,
    referralAccount: read.referralAccount,
    tokenAccounts: read.accounts.map((account) => ({ address: account.address, symbol: symbolOfMint(account.mint) })),
    updatedAt: read.readAt,
    since: read.totals.first ? isoOf(read.totals.first.blockTime) : null,
    lastOperationAt: read.totals.last ? isoOf(read.totals.last.blockTime) : null,
    operations: read.totals.operations,
    wallets: read.totals.wallets,
    valued: read.totals.valued,
    unvalued: read.totals.unvalued,
    volumeUsd: usdFromMicros(read.totals.volumeUsdMicros),
    fees: read.totals.fees.map((fee) => ({
      mint: fee.mint,
      symbol: symbolOfMint(fee.mint),
      decimals: fee.decimals,
      gross: decimalText(fee.grossRaw, fee.decimals),
      ryntra: fee.ryntraRaw === null ? null : decimalText(fee.ryntraRaw, fee.decimals),
      operations: fee.operations,
    })),
    ryntraSharePercent: read.ryntraShareBps === null ? null : read.ryntraShareBps / 100,
    coverage: {
      complete: read.coverage.complete,
      signaturesSeen: read.coverage.signaturesSeen,
      transactionsRead: read.coverage.transactionsRead,
      missing: read.coverage.transactionsMissing,
      truncated: read.coverage.truncated,
    },
    own: { operations: ownOperations, wallets: ownWallets.size },
    stocks: args.stockMints ? { state: "ok", operations: stockOperations, volumeUsd: usdFromMicros(stockVolume), unvalued: stockUnvalued } : { state: "unavailable" },
    sources: read.sources,
  };
}

/** The most recent confirmed operations the public model carries; the totals are over all of them. */
export const PUBLIC_OPERATIONS_LIMIT = 500;

/** The chain read as the projection wants it: the attributed signatures, the moment, the coverage. */
export function chainAttributionOf(read: AttributionRead): OperationSource["chain"] {
  if (!read.ok) return null;
  return { readAt: read.readAt, complete: read.coverage.complete, signatures: new Set(read.operations.map((operation) => operation.signature)) };
}

export function buildLedgerStats(source: OperationSource | null, now: Date): StatsLedger {
  if (!source) return { state: "unavailable" };
  const records = projectOperations(source);
  const confirmed = filterOperations(records, { now, confirmedOnly: true });
  const summary = Object.fromEntries(OPERATION_RANGES.map((range) => [range, summarizeOperations(records, { range, now })])) as Record<OperationRange, OperationSummary>;
  return {
    state: "ok",
    operations: confirmed.slice(0, PUBLIC_OPERATIONS_LIMIT).map(toPublicOperation),
    summary,
    truncated: Math.max(0, confirmed.length - PUBLIC_OPERATIONS_LIMIT),
  };
}

export function buildStatsModel(args: Readonly<{ generatedAt: string; ledger: StatsLedger; onchain: StatsOnchain; dashboardUrl: string | null }>): StatsModel {
  return { generatedAt: args.generatedAt, ledger: args.ledger, onchain: args.onchain, dashboardUrl: args.dashboardUrl };
}
