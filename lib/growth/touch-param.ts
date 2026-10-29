import { REFERRAL_CODE_ALPHABET } from "../rewards/referral-code.ts";

/**
 * What a tagged visit looks like, with no imports beyond a code's alphabet — so the address layer (`middleware.ts`,
 * on the edge, through `ref-param.ts`) can tell a tag from noise without loading the store or a key (Ріст 7).
 *
 * Three tags lead a person to Ryntra: a post code the growth panel issued (`/r/p/<code>`), a friend's link
 * (`/r/<code>`, the Rewards line's own), and UTM parameters on a link somebody else made
 * (`?utm_source=x&utm_medium=social&utm_campaign=…`, MEDIA §12). A contest's link is a post code of the kind
 * «contest». Everything here is shape only: whether a code was issued is the store's question.
 */

/** A post code: seven symbols of the referral alphabet — never twelve, so it is never mistaken for a friend's code. */
export const POST_CODE_LENGTH = 7;
export const POST_CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${POST_CODE_LENGTH}}$`);

/** Case, spaces and dashes are noise, as in a friend's code. */
export function normalizePostCode(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  return POST_CODE_PATTERN.test(cleaned) ? cleaned : null;
}

export type UtmTag = Readonly<{ source: string; medium: string | null; campaign: string | null }>;

/** One UTM value as the panel keeps it: lower case, `a-z 0-9 . _ -`, at most 32 symbols; null when nothing is left. */
export function utmValue(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase().replace(/[\s+]+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  return value.length > 0 ? value : null;
}

/** The UTM tag of an address, or null without `utm_source` — a medium or campaign alone names no source. */
export function utmTagOf(params: URLSearchParams): UtmTag | null {
  const source = utmValue(params.get("utm_source"));
  if (!source) return null;
  return { source, medium: utmValue(params.get("utm_medium")), campaign: utmValue(params.get("utm_campaign")) };
}

/** `x|social|weekly`, `-` for a missing part: one source of the panel. */
export function utmKey(tag: UtmTag): string {
  return `${tag.source}|${tag.medium ?? "-"}|${tag.campaign ?? "-"}`;
}

export function utmFromKey(key: string): UtmTag | null {
  const [source, medium, campaign, extra] = key.split("|");
  if (extra !== undefined || !source || utmValue(source) !== source) return null;
  const part = (value: string | undefined) => (value === undefined || value === "-" ? null : utmValue(value) === value ? value : undefined);
  const m = part(medium);
  const c = part(campaign);
  if (m === undefined || c === undefined) return null;
  return { source, medium: m, campaign: c };
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"] as const;

/** The same address without its UTM parameters — where a tagged visit lands once it is counted. */
export function withoutUtm(params: URLSearchParams): URLSearchParams {
  const rest = new URLSearchParams(params);
  for (const key of UTM_KEYS) rest.delete(key);
  return rest;
}

/**
 * Where a tagged link may land: the Solana product and its site on this same host — the landing (`/`, `/uk…`),
 * `/app…`, `/stats`, `/promo/…` and `/docs…`. Anything else (another site, `//host`, a backslash or a control
 * character, the API, the admin) is refused: a tagged link is never an open redirect. Returns the path with its
 * query, or null.
 */
const LANDING = /^\/(?:$|uk(?:\/|$)|app(?:\/|$)|stats$|promo\/|docs(?:\/|$))/;

export function touchLanding(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > 300) return null;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  let target: URL;
  try {
    target = new URL(path, "https://ryntra.invalid");
  } catch {
    return null;
  }
  if (target.origin !== "https://ryntra.invalid" || !LANDING.test(target.pathname) || target.pathname.includes("/..")) return null;
  return `${target.pathname}${target.search}`;
}
