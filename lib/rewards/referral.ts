import { randomBytes } from "node:crypto";

import { z } from "zod";

/**
 * Who invited whom, and the four ways that can go wrong.
 *
 * The graph is two levels deep and never three. `A` invited `B`, `B` invited
 * `C`: when `C` trades, `C` gets cashback, `B` gets Level 1 and `A` gets Level
 * 2. `A`'s own inviter gets nothing, and there is no arrangement of the data
 * that can make them.
 *
 * ## The code is not the account
 *
 * A referral link carries an opaque code, never a database id, a wallet address
 * or anything derived from one. Two reasons, and the second is the load-bearing
 * one: a sequential id tells a stranger how many people are here and lets them
 * walk the set, and an address in a link publishes the inviter's whole on-chain
 * history to everybody they invite. The code is 128 random bits in base32
 * without vowels — no accidental words, no `0`/`O` or `1`/`l` confusion when
 * somebody reads one aloud.
 *
 * ## What binds, and when
 *
 * Opening a link binds nothing. Canon §0.6 and the owner's instruction agree:
 * no registration wall, no automatic wallet prompt, no account created by a
 * click. The code is held until the person proves a wallet through the sign-in
 * this product already has, and the attribution is written then — once.
 */

/* Crockford-style alphabet minus vowels: no words, no ambiguous glyphs. */
const ALPHABET = "0123456789BCDFGHJKLMNPQRSTVWXZ";
const CODE_LENGTH = 12;

export const REFERRAL_CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/** A fresh opaque code. Random, not derived — nothing about the owner leaks. */
export function mintReferralCode(bytes: Uint8Array = randomBytes(16)): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[bytes[index % bytes.length] % ALPHABET.length];
  }
  return code;
}

/** Normalize what a person typed or a link carried. Case and dashes are noise. */
export function normalizeReferralCode(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return REFERRAL_CODE_PATTERN.test(cleaned) ? cleaned : null;
}

export const RewardAccountSchema = z
  .object({
    wallet: z.string().min(32).max(64),
    /** This person's own code, the one their link carries. */
    code: z.string().regex(REFERRAL_CODE_PATTERN),
    /** Who invited them. Null when nobody did, and it never becomes null again. */
    referrer: z.string().min(32).max(64).nullable(),
    referredAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    /**
     * True once this wallet has produced or received any eligible reward.
     *
     * The gate on changing a referrer. Before it, an attribution that arrived
     * late — the link was opened, the wallet proved a day later — can still be
     * written. After it, the graph has already decided who was paid what, and
     * rewriting it would either owe somebody twice or take back money that was
     * already shown as theirs.
     */
    earning: z.boolean(),
    /**
     * How many wallets have confirmed this one as their inviter, and how many
     * sit one level below those.
     *
     * Counted on confirmation rather than derived from reward rows. The first
     * version derived them, which counted only people who had already traded —
     * so somebody who had invited ten people and whose tenth had not swapped
     * yet was shown nothing at all, and the figure disagreed with the thing it
     * is called. Beside `L1 earned` it would also have been redundant: two
     * numbers describing the same set.
     *
     * Kept on the record because the store has no secondary index, and a scan
     * to answer "who chose me" would grow with the whole product. `.default(0)`
     * so a record written before this field existed still reads.
     */
    directReferrals: z.number().int().min(0).default(0),
    level2Referrals: z.number().int().min(0).default(0),
    version: z.number().int().min(0),
  })
  .strict();

export type RewardAccount = z.output<typeof RewardAccountSchema>;

export const ReferralCodeRecordSchema = z
  .object({
    code: z.string().regex(REFERRAL_CODE_PATTERN),
    wallet: z.string().min(32).max(64),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ReferralCodeRecord = z.output<typeof ReferralCodeRecordSchema>;

export const REFERRAL_REFUSALS = [
  "SELF_REFERRAL",
  "UNKNOWN_CODE",
  "ALREADY_REFERRED",
  "ALREADY_EARNING",
  "CYCLE",
] as const;

export type ReferralRefusalCode = (typeof REFERRAL_REFUSALS)[number];

export type ReferralBindDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: ReferralRefusalCode; reason: string }>;

/**
 * May this wallet be recorded as invited by that one?
 *
 * Pure, and separate from the write, because these are the rules somebody will
 * want to read without also reading a store adapter.
 *
 * `chain` is the referrer's own ancestry as far as it is known — the referrer,
 * then the referrer's referrer. Two entries is enough to refuse every cycle a
 * two-level graph can hold: `A -> B -> A` needs one, `A -> B -> C -> A` cannot
 * exist because `C`'s payout never looks past `A`.
 */
export function decideReferralBind(
  args: Readonly<{
    wallet: string;
    referrer: string | null;
    account: RewardAccount | null;
    referrerChain: readonly string[];
  }>,
): ReferralBindDecision {
  if (!args.referrer) return { ok: false, code: "UNKNOWN_CODE", reason: "That referral link does not belong to anybody." };
  if (args.referrer === args.wallet) {
    return { ok: false, code: "SELF_REFERRAL", reason: "A wallet cannot invite itself." };
  }
  if (args.account?.referrer) {
    return args.account.referrer === args.referrer
      ? { ok: true }
      : { ok: false, code: "ALREADY_REFERRED", reason: "This wallet already has an inviter, and an inviter does not change." };
  }
  if (args.account?.earning) {
    return {
      ok: false,
      code: "ALREADY_EARNING",
      reason: "This wallet has already earned rewards, so its inviter is settled.",
    };
  }
  if (args.referrerChain.includes(args.wallet)) {
    return { ok: false, code: "CYCLE", reason: "That would make two wallets invite each other." };
  }
  return { ok: true };
}

/**
 * The two levels that get paid, from the trader's own account record.
 *
 * `l2` is deliberately read from the *referrer's* record rather than walked
 * further: one hop from the trader, one hop from the inviter, and then it
 * stops. A third level cannot be produced by this function under any input,
 * which is stronger than a rule that says it should not be.
 */
export function referralLevels(
  trader: RewardAccount | null,
  referrerAccount: RewardAccount | null,
): Readonly<{ l1: string | null; l2: string | null }> {
  const l1 = trader?.referrer ?? null;
  if (!l1) return { l1: null, l2: null };
  const l2 = referrerAccount?.referrer ?? null;
  /* A graph that has somehow closed on itself pays nobody twice. */
  if (!l2 || l2 === trader?.wallet || l2 === l1) return { l1, l2: null };
  return { l1, l2 };
}

/** Delayed bookkeeping uses the graph that existed at settlement. A later
 * invitation cannot acquire an operation that already happened. */
export function referralLevelsAt(trader: RewardAccount | null, parent: RewardAccount | null, settledAt: string) {
  const at = Date.parse(settledAt);
  if (!Number.isFinite(at) || !trader?.referredAt || Date.parse(trader.referredAt) > at) return { l1: null, l2: null };
  const ancestor = parent?.referredAt && Date.parse(parent.referredAt) <= at ? parent : null;
  return referralLevels(trader, ancestor);
}

/**
 * The cookie `/r/<code>` leaves behind.
 *
 * It lives here rather than in the route because a Next route file may export
 * only its handlers and route config — anything else fails the generated type
 * check — and because two modules need the name: the one that sets it and the
 * one that spends it.
 */
export const REFERRAL_COOKIE = "rref";

/**
 * A wallet as it is shown to somebody who is not its owner.
 *
 * Four characters from each end. An inviter's address is not a secret — it is
 * on every explorer — but printing it in full inside somebody else's product
 * hands a new arrival their inviter's entire trading history as an opening
 * gesture, and nothing about confirming an invitation needs that. Four and four
 * is enough for a person to recognise an address they were given and not enough
 * to be a directory.
 *
 * Deliberately not reversible and deliberately not a lookup key: masking
 * happens on the server, and the full address never reaches the browser of
 * anybody but its owner.
 */
export function maskWallet(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** A referral code, shown the same way for the same reason. */
export function maskCode(code: string): string {
  if (code.length <= 9) return code;
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
}

/** The public link a person copies. One shape, so it is never invented twice. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${code}`;
}
