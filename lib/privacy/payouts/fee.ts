/**
 * Ryntra's fee on a private payout: the same private transfer's extra output, to Ryntra's own private address — no
 * transaction of its own, no signature more. Like every recipient of a ring transfer, the fee's address is written in
 * the open as its output's owner tag; its amount is hidden (`scripts/privacy/payouts-offline.mjs`, P2).
 *
 * They are server settings, not numbers in code:
 * - `RYNTRA_PRIVATE_PAYOUT_FEE_BPS` — basis points of what a transfer pays, a whole number from 1 to
 *   `PAYOUT_FEE_MAX_BPS`;
 * - `RYNTRA_PRIVATE_PAYOUT_FEE_TO` — Ryntra's private address the fee goes to; it must have a private balance turned on,
 *   as every recipient of a ring transfer must.
 * Both set and readable — the fee is charged. Either unset or unreadable — no fee output is added, and the line before
 * the signature says «No Ryntra fee»: a rate without an address, or a typo, never charges by surprise. The page reads
 * them on the server (`app/(terminal)/money/page.tsx`) and hands the screen the rate and the address, nothing else.
 *
 * Only private transfers carry it: a link and an open payment have no second output of their own.
 */

export type FeeRule = Readonly<{
  /** Basis points of what a transfer pays. */
  bps: number;
  /** Ryntra's private address the fee goes to; null — no fee output at all. */
  to: string | null;
  /** The most one transfer pays in fee, in the coin's smallest units; null — no cap. */
  cap: bigint | null;
}>;

/** What the server settings say, as the page hands it to the screen: plain, so it crosses from server to browser. */
export type PayoutFeeSetting = Readonly<{ bps: number; to: string | null }>;

export const PAYOUT_FEE_ENV = Object.freeze({ bps: 'RYNTRA_PRIVATE_PAYOUT_FEE_BPS', to: 'RYNTRA_PRIVATE_PAYOUT_FEE_TO' });

/** The highest rate the setting accepts — 10 %. Anything above reads as a mistake and charges nothing. */
export const PAYOUT_FEE_MAX_BPS = 1_000;

export const NO_PAYOUT_FEE: PayoutFeeSetting = Object.freeze({ bps: 0, to: null });

/** Until then none. */
export const PAYOUT_FEE_CAP: bigint | null = null;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The fee as the server's settings set it: both readable, or no fee at all. */
export function payoutFeeSetting(env: Readonly<Record<string, string | undefined>>): PayoutFeeSetting {
  const rate = env[PAYOUT_FEE_ENV.bps]?.trim() ?? '';
  const to = env[PAYOUT_FEE_ENV.to]?.trim() ?? '';
  const bps = /^\d{1,5}$/.test(rate) ? Number(rate) : 0;
  if (!(bps > 0 && bps <= PAYOUT_FEE_MAX_BPS) || !ADDRESS.test(to)) return NO_PAYOUT_FEE;
  return { bps, to };
}

/** The rule this screen pays by: the setting it was handed, none without one. */
export function payoutFee(setting: PayoutFeeSetting = NO_PAYOUT_FEE): FeeRule {
  return { bps: setting.bps, to: setting.to, cap: PAYOUT_FEE_CAP };
}

/** Whether the rule charges anything at all. */
export function chargesFee(rule: FeeRule): boolean {
  return Boolean(rule.to) && rule.bps > 0;
}

/** The rate as a person reads it, in per cent: 20 → «0.2», 25 → «0.25», 100 → «1». */
export function feePercent(bps: number): string {
  return String(Math.round(bps) / 100);
}

/** The fee on `sum`: rounded down, capped; 0 while there is no rate or no address to pay it to. */
export function feeOf(sum: bigint, rule: FeeRule): bigint {
  if (!rule.to || !(rule.bps > 0) || sum <= 0n) return 0n;
  const fee = (sum * BigInt(Math.round(rule.bps * 100))) / 1_000_000n;
  return rule.cap !== null && fee > rule.cap ? rule.cap : fee;
}
