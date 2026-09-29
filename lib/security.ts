import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison for secrets (headers, webhook params). Both sides are
 * SHA-256-digested first so the timingSafeEqual inputs are ALWAYS equal-length — no early
 * return on length mismatch, so not even the secret's length leaks through timing.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Token from an `Authorization: Bearer <token>` header value, else null. Scheme is case-insensitive. */
export function bearerToken(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m ? m[1] : null;
}

/**
 * True when the Authorization header carries a Bearer token equal (constant-time) to one of
 * the given secrets. Secrets travel in headers, never URLs — query strings end up in access
 * logs, CDN caches and browser history; headers don't.
 */
export function authorizedBearer(
  authorization: string | null | undefined,
  ...secrets: (string | null | undefined)[]
): boolean {
  const token = bearerToken(authorization);
  if (!token) return false;
  let ok = false;
  for (const secret of secrets) if (safeEqual(token, secret)) ok = true;
  return ok;
}

/**
 * FAIL-LOUD auth decision for Bearer-protected routes. The four outcomes are deliberately
 * distinct so a broken monitor can never look healthy:
 *   public          — NO credentials presented at all (route decides if that's allowed)
 *   authorized      — valid Bearer
 *   unauthorized    — Authorization header PRESENT but wrong/empty, or no server secret set
 *                     (a missing secret locks the route, it never opens it)
 *   legacy-rejected — a query-string key was presented; NEVER accepted (even alongside a valid
 *                     Bearer) so a half-migrated client fails visibly and gets fixed
 */
export type BearerAuthDecision = "public" | "authorized" | "unauthorized" | "legacy-rejected";

export function decideBearerAuth(
  input: { authorization: string | null; legacyKeyPresent: boolean },
  ...secrets: (string | null | undefined)[]
): BearerAuthDecision {
  if (input.legacyKeyPresent) return "legacy-rejected";
  if (input.authorization == null) return "public";
  return authorizedBearer(input.authorization, ...secrets) ? "authorized" : "unauthorized";
}

/** Standard migration error body for legacy-rejected — says HOW to fix, never echoes a secret. */
export const LEGACY_KEY_ERROR =
  "query-string keys are not accepted; send the secret as an Authorization: Bearer header";

/**
 * FAIL-CLOSED decision for the Telegram webhook secret-token header
 * (`x-telegram-bot-api-secret-token`). Unlike the GET Bearer decider, the webhook has no
 * "public" mode — it ALWAYS requires the shared secret:
 *   unconfigured — the server secret is unset/empty → route must refuse (503), never accept
 *                  an unauthenticated update (the old `if (SECRET && …)` fail-OPEN is the bug)
 *   authorized   — header equals the secret (constant-time)
 *   unauthorized — secret is set but the header is missing/empty/wrong
 */
export type WebhookAuthDecision = "unconfigured" | "authorized" | "unauthorized";

export function decideWebhookSecret(
  header: string | null | undefined,
  secret: string | null | undefined
): WebhookAuthDecision {
  if (typeof secret !== "string" || secret.length === 0) return "unconfigured";
  return safeEqual(header, secret) ? "authorized" : "unauthorized";
}

/**
 * State-changing browser requests must come from this exact origin. Browsers normally send
 * Origin on POST; Fetch Metadata is the fallback for older same-origin clients.
 */
export function mutationOriginAllowed(
  requestUrl: string,
  origin: string | null,
  secFetchSite: string | null
): boolean {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    return false;
  }
  if (origin !== null) {
    try {
      return new URL(origin).origin === requestOrigin;
    } catch {
      return false;
    }
  }
  return secFetchSite === "same-origin";
}

/**
 * Magic links may open from Telegram Web, but only a user-activated top-level document
 * navigation may exchange a credential. Images, fetches and silent redirects fail closed.
 */
export function loginNavigationAllowed(
  secFetchSite: string | null,
  secFetchMode: string | null,
  secFetchUser: string | null,
  secFetchDest: string | null
): boolean {
  const documentNavigation = secFetchMode === "navigate" && secFetchDest === "document";
  if (!documentNavigation) return false;
  if (secFetchSite === "same-origin") return true;
  return (
    (secFetchSite === "none" || secFetchSite === "cross-site") &&
    secFetchUser === "?1"
  );
}

/** GET logout is allowed only from this application, with Referer as an old-browser fallback. */
export function logoutNavigationAllowed(
  requestUrl: string,
  secFetchSite: string | null,
  referer: string | null
): boolean {
  if (secFetchSite === "same-origin") return true;
  if (secFetchSite !== null || referer === null) return false;
  try {
    return new URL(referer).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
