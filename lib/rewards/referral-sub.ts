/**
 * A link's sub-ID — the partner's own tag for where a link was posted (`/r/<code>?s=x-thread`), kept from the first
 * open to the binding (Ryntra Partners R3). Its shape only, so the edge (`middleware.ts`) can read it too.
 *
 * Short, plain and never a person: letters, digits, `-` and `_`, at most 32. Anything else is dropped — the link
 * still works, it just carries no sub-ID. It names a place a partner chose, so it is shown to that partner and to
 * nobody else, and it never decides who is paid.
 */
export const REFERRAL_SUB_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** The query parameter a link carries its sub-ID in. */
export const REFERRAL_SUB_PARAM = "s";

export function normalizeReferralSub(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return REFERRAL_SUB_PATTERN.test(value) ? value : null;
}
