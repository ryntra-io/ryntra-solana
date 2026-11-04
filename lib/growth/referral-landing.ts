import { normalizeReferralCode } from "../rewards/referral-code.ts";
import { normalizeReferralSub, REFERRAL_SUB_PARAM } from "../rewards/referral-sub.ts";
import { referralDestination } from "./referral-destination.ts";

/**
 * Where a referral link lands a person: the city (Ryntra Partners R3, decision 75 — the old interface is closed and
 * no link leads into it).
 *
 * `/r/<code>` remembers the invitation in the browser and sends the person to `/?invite=<code>&s=<sub-ID>`; the
 * city's friend landing (`city/components/partners/**`) reads the same two parameters with `readInviteLanding`. The
 * parameter is `invite`, not `ref`, on purpose: `?ref=<code>` on any page is what *sends* a person to `/r/<code>`
 * (`ref-param.ts`), so landing on `?ref=` would send them round again.
 *
 * Nothing is bound by landing: the binding is written when the browser proves a wallet (`/api/rewards/referral`).
 * A link that names a page of the product (`?to=`, this site's `/app/**` only — a token from a trade card, a launch
 * from its creator's share link) still lands on that page, which leads into its district of the city; only the old
 * fallback, «Винагороди», is gone.
 */
export const INVITE_LANDING_PARAM = "invite";

export function referralLanding(code: string | null, sub: string | null, base: string): URL {
  const landing = new URL("/", base);
  const normal = code ? normalizeReferralCode(code) : null;
  if (normal) {
    landing.searchParams.set(INVITE_LANDING_PARAM, normal);
    const tag = normalizeReferralSub(sub);
    if (tag) landing.searchParams.set(REFERRAL_SUB_PARAM, tag);
  }
  return landing;
}

/** Where `/r/<code>` sends a person: the product page `?to=` names, when it names one; otherwise the city. */
export function referralTarget(to: string | null, code: string | null, sub: string | null, base: string): URL {
  const page = to ? referralDestination(to, base) : null;
  return page && page.pathname !== "/app/rewards" ? page : referralLanding(code, sub, base);
}

/** The invitation a landing carries, for the city's page: the code and its sub-ID, or null when it carries none. */
export function readInviteLanding(params: Pick<URLSearchParams, "get">): Readonly<{ code: string; sub: string | null }> | null {
  const code = normalizeReferralCode(params.get(INVITE_LANDING_PARAM) ?? "");
  return code ? { code, sub: normalizeReferralSub(params.get(REFERRAL_SUB_PARAM)) } : null;
}
