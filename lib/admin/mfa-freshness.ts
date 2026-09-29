/**
 * How recently did an identity session actually pass its second factor?
 *
 * `aal2` is a level, not a moment. A Supabase session keeps it for as long as
 * it lives, so treating «currently aal2» as «just verified» hands a browser
 * left open overnight the same standing as somebody who typed a code a second
 * ago — and the fresh-code rule on sensitive admin actions exists precisely to
 * tell those two apart. Supabase records every authentication method with its
 * own timestamp; the TOTP entry is the one that answers this question.
 *
 * Kept apart from the rest of the admin auth module so the rule can be tested
 * on its own, with no store, no client and no cookies.
 */
export const MFA_FRESH_S = 15 * 60;

export type AuthenticationMethod = { method: string; timestamp: number };

/** The most recent second-factor authentication, in epoch milliseconds. */
export function totpVerifiedAtMs(methods: readonly AuthenticationMethod[] | undefined | null): number | null {
  if (!methods?.length) return null;
  const stamps = methods
    .filter((m) => typeof m?.method === "string" && /totp|mfa/i.test(m.method))
    /* Supabase reports seconds; everything else here is milliseconds. */
    .map((m) => (typeof m.timestamp === "number" && Number.isFinite(m.timestamp) ? m.timestamp * 1000 : NaN))
    .filter((n) => Number.isFinite(n));
  return stamps.length ? Math.max(...stamps) : null;
}

/** A second factor counts as fresh for `MFA_FRESH_S` and not a second longer. */
export function mfaIsFresh(atMs: number | null, now: number = Date.now()): boolean {
  return atMs !== null && now >= atMs && now - atMs <= MFA_FRESH_S * 1000;
}
