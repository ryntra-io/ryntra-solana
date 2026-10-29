/**
 * The short link a launched token is shared by (SOL-L1e): `ryntra.io/t/<first 8 letters of the mint>`, and with a
 * referral code `ryntra.io/t/<8>/<code>` — Ukrainian at `/uk/t/…`.
 *
 * Why not the token's page itself: robots.txt closes `/app/` to crawlers, and X reads robots.txt before it draws a
 * card, so a link to `/app/launch/<mint>` — or to `/r/<code>?to=…`, whose redirect lands there — is posted bare. The
 * short address is open: a link preview (X, Telegram and the rest) is answered there with the token's card, and a
 * person is sent on at once through the referral route `/r/<code>`, which stays the Growth line's and is only called.
 *
 * Pure: the page, the launch's form and the route all build and read the same address.
 */

export const LAUNCH_SHORT_PATH = "/t";

/** Letters of the mint in the short address: 58⁸ ≈ 1,3 · 10¹⁴ — two launches sharing them is not a case Launch meets. */
export const LAUNCH_SHORT_CHARS = 8;

/** A short address's token part: the mint's first letters, or the whole mint (32–44) — base58, nothing else. */
export const LAUNCH_SHORT_SLUG = /^[1-9A-HJ-NP-Za-km-z]{8,44}$/;

export function launchShortSlug(mint: string): string {
  return mint.slice(0, LAUNCH_SHORT_CHARS);
}

/** `/t/<8>` or `/t/<8>/<code>`. */
export function launchShortPath(mint: string, code: string | null): string {
  return `${LAUNCH_SHORT_PATH}/${launchShortSlug(mint)}${code ? `/${code}` : ""}`;
}

/**
 * Where the short address sends a person: the token's page — through the referral route when there is a code and the
 * route lands on the page it names (`REFERRAL_ROUTE_FOLLOWS_TO`), so the code is remembered on the way.
 */
export function launchReferralPath(mint: string, code: string | null, followsTo: boolean): string {
  const page = `/app/launch/${mint}`;
  /* The page is a path of base58 letters and slashes — legal in a query as it is. */
  return followsTo && code ? `/r/${code}?to=${page}` : page;
}

/** The same link in the reader's language: a short address gets its `/uk` twin; any other link is left as it is. */
export function localizedShareLink(link: string, locale: "en" | "uk"): string {
  if (locale !== "uk") return link;
  try {
    const url = new URL(link);
    if (!url.pathname.startsWith(`${LAUNCH_SHORT_PATH}/`)) return link;
    url.pathname = `/uk${url.pathname}`;
    return url.toString();
  } catch {
    return link;
  }
}
