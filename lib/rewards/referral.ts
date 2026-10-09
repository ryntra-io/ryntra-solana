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
 * Opening a link binds nothing by itself. No registration wall, no automatic wallet prompt, no
 * account created by a click. The code is held in the
 * browser, and the attribution is written on its own the first time that
 * browser proves a wallet — no button to find (08.10: two
 * friends never saw the old «Confirm»). It can be changed once, while the
 * window below is open; the inviter before the change keeps what settled
 * before it.
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

/**
 * Normalize what a person typed or a link carried. Case and dashes are noise.
 *
 * A whole link is accepted too — `ryntra.io/r/<code>`, with or without the
 * scheme, a trailing slash, a `?to=` or a card path after it. Friends paste
 * what they were sent, and what they were sent is usually the link; answering
 * "code not found" to the very thing the inviter copied is the kind of wall
 * that makes people stop. Only the segment after `/r/` is read, and it still
 * has to be a code.
 */
export function normalizeReferralCode(value: string): string | null {
  const linked = /(?:^|\/)r\/([^/?#\s]+)/i.exec(value.trim());
  const cleaned = (linked ? linked[1] : value).trim().toUpperCase().replace(/[\s-]/g, "");
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
    /**
     * The inviter before the one change a wallet may make, and since when they
     * were it. Kept so an operation that settled before the change — recorded
     * late, or retried — still pays the inviter it belonged to
     * (`referrerAt`). Null until a change happens.
     */
    previousReferrer: z.string().min(32).max(64).nullable().default(null),
    previousReferredAt: z.string().datetime({ offset: true }).nullable().default(null),
    /** How many times the inviter was changed: 0 or 1, never more. */
    referrerChanges: z.number().int().min(0).max(1).default(0),
    createdAt: z.string().datetime({ offset: true }),
    /**
     * True once this wallet has produced or received any eligible reward.
     *
     * The gate on adding a referrer, together with `earningSince`. Before the
     * first earning an attribution can always be written; for seven days after
     * it one still can, and it pays the inviter only on what settles after the
     * binding. Past that, the wallet's inviter question is closed.
     */
    earning: z.boolean(),
    /**
     * When this wallet first earned — its own first trade, or a friend's trade
     * that paid it — which is when the seven-day window to add an inviter
     * starts (`referralBindWindow`).
     *
     * Null on a wallet that has not earned, and on a record that was already
     * earning before this field existed: for those the moment is recovered
     * from the wallet's own oldest reward or Points row the first time
     * somebody asks, never guessed as "now", because "now" would hand a
     * months-old earner a fresh window.
     */
    earningSince: z.string().datetime({ offset: true }).nullable().default(null),
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

/** How long after the first earning an inviter can still be added. */
export const REFERRAL_BIND_WINDOW_DAYS = 7;
const REFERRAL_BIND_WINDOW_MS = REFERRAL_BIND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type ReferralBindWindow = Readonly<{
  /** May an inviter be added at `now`? */
  open: boolean;
  /**
   * The last moment one may be: null while the wallet has not earned (no
   * deadline yet) and when the first earning cannot be dated (closed).
   */
  until: string | null;
}>;

/**
 * The window in which a wallet may still take an inviter.
 *
 * Before the first earning there is no deadline. After it, seven days — for a
 * link opened before that first trade and for a code typed in during those
 * seven days alike, because both are the same deliberate act: the person sees
 * who invited them and confirms. A link opened after the first trade is that
 * same act too. Nothing earned before the binding moves:
 * `referralLevelsAt` pays an inviter only on operations settled after it.
 *
 * A wallet that is earning but whose first earning cannot be dated is closed,
 * not open: fail-closed is the only safe reading of "we do not know".
 */
export function referralBindWindow(
  account: Pick<RewardAccount, "earning" | "earningSince"> | null,
  now: string,
): ReferralBindWindow {
  if (!account?.earning) return { open: true, until: null };
  const since = account.earningSince ? Date.parse(account.earningSince) : Number.NaN;
  const at = Date.parse(now);
  if (!Number.isFinite(since) || !Number.isFinite(at)) return { open: false, until: null };
  const until = since + REFERRAL_BIND_WINDOW_MS;
  return { open: at <= until, until: new Date(until).toISOString() };
}

/**
 * What `earningSince` becomes when an accrual writes a wallet's record.
 *
 * Used by both writers — money rewards and Points — so the two cannot drift.
 * `at` is when the operation settled, not when this write runs: a retry hours
 * later must not push the window forward. An earlier operation recorded late
 * moves the moment back, never forward. A record already earning without a
 * moment stays without one here; `ensureEarningSince` dates it from its rows.
 */
export function nextEarningSince(
  owner: Pick<RewardAccount, "earning" | "earningSince">,
  earnsNow: boolean,
  at: string,
): string | null {
  if (!earnsNow) return owner.earningSince;
  if (!Number.isFinite(Date.parse(at))) return owner.earningSince;
  if (owner.earning && !owner.earningSince) return null;
  if (!owner.earningSince) return at;
  return Date.parse(at) < Date.parse(owner.earningSince) ? at : owner.earningSince;
}

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
  /** The one change of inviter has already been made. */
  "ALREADY_CHANGED",
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
    /** When the confirmation happens — the seven-day window is measured to it. */
    now: string;
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
  if (!referralBindWindow(args.account, args.now).open) {
    return {
      ok: false,
      code: "ALREADY_EARNING",
      reason: `This wallet started earning more than ${REFERRAL_BIND_WINDOW_DAYS} days ago, so an inviter can no longer be added.`,
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

/**
 * Who invited this wallet at a moment: the inviter since `referredAt`, the one
 * before the change between `previousReferredAt` and that, nobody before.
 */
export function referrerAt(
  account: Pick<RewardAccount, "referrer" | "referredAt" | "previousReferrer" | "previousReferredAt"> | null,
  settledAt: string,
): string | null {
  const at = Date.parse(settledAt);
  if (!account || !Number.isFinite(at)) return null;
  if (account.referrer && account.referredAt && Date.parse(account.referredAt) <= at) return account.referrer;
  if (account.previousReferrer && account.previousReferredAt && Date.parse(account.previousReferredAt) <= at) return account.previousReferrer;
  return null;
}

/** Delayed bookkeeping uses the graph that existed at settlement. A later
 * invitation — or a later change of inviter — cannot acquire an operation that
 * already happened. `parent` must be the account of `referrerAt(trader)`. */
export function referralLevelsAt(trader: RewardAccount | null, parent: RewardAccount | null, settledAt: string) {
  const l1 = referrerAt(trader, settledAt);
  if (!l1) return { l1: null, l2: null };
  const l2 = parent?.wallet === l1 ? referrerAt(parent, settledAt) : null;
  if (!l2 || l2 === trader?.wallet || l2 === l1) return { l1, l2: null };
  return { l1, l2 };
}

/**
 * May this wallet change its inviter to that one? Once, inside the window.
 *
 * Pure, beside `decideReferralBind`, for the same reason. The same inviter
 * again is not a change and is fine; the rest is the bind rules — not
 * yourself, not a cycle — plus the two limits of a change.
 */
export function decideReferralChange(
  args: Readonly<{
    wallet: string;
    referrer: string | null;
    account: RewardAccount;
    referrerChain: readonly string[];
    now: string;
  }>,
): ReferralBindDecision {
  if (!args.referrer) return { ok: false, code: "UNKNOWN_CODE", reason: "That referral link does not belong to anybody." };
  if (args.referrer === args.wallet) return { ok: false, code: "SELF_REFERRAL", reason: "A wallet cannot invite itself." };
  if (args.account.referrer === args.referrer) return { ok: true };
  if (args.account.referrerChanges >= 1) {
    return { ok: false, code: "ALREADY_CHANGED", reason: "This wallet has already changed its inviter once." };
  }
  if (!referralBindWindow(args.account, args.now).open) {
    return { ok: false, code: "ALREADY_EARNING", reason: `This wallet started earning more than ${REFERRAL_BIND_WINDOW_DAYS} days ago, so its inviter is final.` };
  }
  if (args.referrerChain.includes(args.wallet)) {
    return { ok: false, code: "CYCLE", reason: "That would make two wallets invite each other." };
  }
  return { ok: true };
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
 * When the carried code was taken (epoch milliseconds), beside it. First touch
 * holds for `REFERRAL_FIRST_TOUCH_MS`: a link opened within that time does not
 * replace the code (a redirect cannot take a binding that is about to happen);
 * after it, a fresh link from a friend wins over a stale one the person no
 * longer remembers. A code without this cookie is treated as stale.
 */
export const REFERRAL_COOKIE_AT = "rref_at";
export const REFERRAL_FIRST_TOUCH_MS = 24 * 60 * 60 * 1000;

/** Does a carried code still hold against a newly opened link? */
export function carriedCodeHolds(carriedAt: string | null | undefined, nowMs: number): boolean {
  const at = Number(carriedAt);
  return Number.isFinite(at) && at > 0 && at <= nowMs && nowMs - at < REFERRAL_FIRST_TOUCH_MS;
}

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
