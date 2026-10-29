/**
 * What a referral code looks like, with no imports — so the address layer (`middleware.ts`, on the edge) can tell
 * a code from noise without loading the rewards ledger (`lib/growth/ref-param.ts`).
 */

/* Crockford-style alphabet minus vowels: no words, no ambiguous glyphs. */
export const REFERRAL_CODE_ALPHABET = "0123456789BCDFGHJKLMNPQRSTVWXZ";
export const REFERRAL_CODE_LENGTH = 12;

export const REFERRAL_CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

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
