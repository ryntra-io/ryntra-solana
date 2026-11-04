/**
 * The discount on Ryntra's fee for a person a partner brought (CITY-182).
 *
 * The rate is the fee table's, less the partner programme's discount, rounded down to a whole basis point — always in
 * the person's favour, never above what the table charges. It is decided once, when the order the wallet will sign is
 * built, and travels as that order's own fee: the bytes, the simulation's proof of the fee, the Review and the receipt
 * all read the one rate, so nothing downstream can drift from it.
 *
 * Who brought whom is the Rewards line's record, read only through its own calls (`readRewardAccount`, `referrerAt`):
 * an inviter bound at or before the moment of the trade, who is not the wallet itself, and — should the terms ever
 * keep a person with a partner for a number of days — still inside those days. A record that cannot be read gives no
 * discount; the Review then states the full rate before anything is signed.
 *
 * The switch is `city/lib/partners/discount.ts`: off, nobody gets a discount and the fee is the table's.
 */

import { DISCOUNT_ENV, discountOn } from "../../city/lib/partners/discount.ts";
import { PARTNER_TERMS, type PartnerTerms } from "../../city/lib/partners/terms.ts";
import type { GuardStore } from "../guard/store.ts";
import { readRewardAccount } from "../rewards/ledger.ts";
import { referrerAt, type RewardAccount } from "../rewards/referral.ts";

export { discountedFeeBps } from "./fee-policy.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export function refereeDiscountInForce(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return discountOn(env[DISCOUNT_ENV]);
}

/** The discount, in basis points of Ryntra's fee, this wallet's record earns at `at`; 0 when it earns none. */
export function refereeDiscountBps(
  args: Readonly<{ wallet: string; account: Pick<RewardAccount, "referrer" | "referredAt" | "previousReferrer" | "previousReferredAt"> | null; at: string; terms?: PartnerTerms }>,
): number {
  const terms = args.terms ?? PARTNER_TERMS;
  const discount = terms.refereeDiscountBps;
  if (discount === null || discount <= 0 || terms.attribution === null) return 0;
  const inviter = referrerAt(args.account, args.at);
  if (!inviter || inviter === args.wallet) return 0;
  if (typeof terms.attribution === "number") {
    /* The inviter in force at `at` is the current one or the one before a change; each is dated by its own binding. */
    const since = inviter === args.account?.referrer ? args.account.referredAt : args.account?.previousReferredAt;
    const sinceMs = since ? Date.parse(since) : Number.NaN;
    if (!Number.isFinite(sinceMs) || Date.parse(args.at) - sinceMs >= terms.attribution * DAY_MS) return 0;
  }
  return Math.min(discount, 10_000);
}

/**
 * The discount the person behind `wallet` gets on a trade built now, read from the Rewards record. Off, or the record
 * unreadable: 0.
 */
export async function readRefereeDiscountBps(
  store: GuardStore,
  wallet: string,
  deps: Readonly<{ env?: Readonly<Record<string, string | undefined>>; now?: () => Date; read?: typeof readRewardAccount }> = {},
): Promise<number> {
  if (!refereeDiscountInForce(deps.env)) return 0;
  try {
    const account = await (deps.read ?? readRewardAccount)(store, wallet);
    return refereeDiscountBps({ wallet, account, at: (deps.now ?? (() => new Date()))().toISOString() });
  } catch {
    return 0;
  }
}
