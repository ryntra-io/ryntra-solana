import { FEE_POLICY_V2, type FeeFlow } from "../../core/fee-policy.ts";
import { REWARD_MINIMUM_CLAIM_USD_MICROS, USD_MICROS_PER_USD } from "../../rewards/model.ts";
import { RANK_WINDOW_DAYS, REWARD_RANKS, REWARD_RULES_CURRENT } from "../../rewards/rules.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../../swap/service-fee.ts";

/**
 * The figures the Terms of Use state — the service fees, the Rewards split, the claim floor, the rank window — read
 * from the same policy the product charges and accrues with, so the legal text cannot state a rate the ledger does not
 * apply. The same arithmetic the documentation's facts used (`legal.test.mjs` holds the two equal while both stand);
 * it lives here, beside the texts, so a page of the city can carry the Terms without the old documentation's modules.
 */

const bpsToPercent = (bps: number): string => {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0$/, "")}%`;
};

/** A range of rates, «0.1–1%», from the lowest and the highest of the flows named. */
const rangeOf = (flows: readonly FeeFlow[]): string => {
  const rates = flows.map((flow) => FEE_POLICY_V2[flow].bps).filter((bps) => bps > 0);
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  return low === high ? bpsToPercent(low) : `${bpsToPercent(low).replace("%", "")}–${bpsToPercent(high)}`;
};

const TOKEN_FLOWS: readonly FeeFlow[] = ["MEME", "TRENDING", "MAJOR"];
const referralL1ByRank = REWARD_RANKS.map((rank) => REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100);

export const LEGAL_FEES = {
  /** Swap and Spot: from a major's rate to a new token's. */
  swap: rangeOf(TOKEN_FLOWS),
  bridge: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE),
} as const;

export const LEGAL_REWARDS = {
  cashbackPercent: REWARD_RULES_CURRENT.cashbackBps / 100,
  /** The inviter's share, by the inviter's rank: «10–30». */
  referralL1Percent: `${Math.min(...referralL1ByRank)}–${Math.max(...referralL1ByRank)}`,
  referralL2Percent: REWARD_RULES_CURRENT.referralL2Bps / 100,
  claimFloorUsd: Number(REWARD_MINIMUM_CLAIM_USD_MICROS / USD_MICROS_PER_USD),
  rankWindowDays: RANK_WINDOW_DAYS,
} as const;
