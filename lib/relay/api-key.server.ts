/**
 * Ryntra's Relay API key — server only, and read from the environment only here.
 *
 * Split from every module that calls Relay for the same reason
 * `service-fee.server.ts` is split from `service-fee.ts`: the quote, currency and
 * status modules are imported by surfaces a browser loads, and a module a browser
 * may import is not a module that reads the environment. Those modules take the
 * key as an ordinary dependency; only a server route resolves one.
 *
 * ## Why this is a prerequisite rather than an improvement
 *
 * `GET /requests/v3` refuses an anonymous call outright — the bare request answers
 * `400 FST_ERR_VALIDATION: headers must have required property 'x-api-key'`. That
 * endpoint is where the fill amount and `paidAppFees` are read, so Activity's
 * actual output and every Rewards accrual depend on it. Its predecessor
 * `/requests/v2` states its own sunset in-band and has had its rate limit reduced
 * in stages since 2026-09-01.
 *
 * Relay additionally requires the key on `POST /quote` whenever the body carries a
 * `referrer`. Ryntra sends no referrer, so quotes still answer unauthenticated —
 * but they are sent with the key when there is one, because per-key request
 * history is the whole reason the Dashboard can tell production apart from a
 * preview deploy.
 *
 * ## The shape of the configuration
 *
 * **One environment variable name, a different value per deployment.** Vercel
 * scopes a value to Production, Preview or Development, so a single name carries
 * a different key in each without any code choosing between them. A second name
 * for previews would be a branch that can be got wrong.
 *
 * The value is a credential: never prefixed `NEXT_PUBLIC_`, never logged, never
 * returned to a client, and never included in an error message. Nothing in this
 * file stringifies it, and `describeRelayApiKey` exists so a diagnostic can say
 * whether a key is configured without saying what it is.
 */

/** The one canonical name. Deployment-scoped values, not deployment-scoped names. */
export const RELAY_API_KEY_ENV = "RYNTRA_RELAY_API_KEY" as const;

/**
 * The configured key, or `null` when there is none.
 *
 * Whitespace is trimmed because an environment value pasted through a dashboard
 * routinely arrives with a trailing newline, and an empty string degrades to
 * "unconfigured" rather than being sent as a key Relay would reject.
 */
export function resolveRelayApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[RELAY_API_KEY_ENV];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether a key is configured, in a form that is safe to log or to render.
 *
 * Deliberately returns no part of the key — not a prefix, not a suffix, not a
 * length. A support surface needs to know that authentication is set up, and
 * there is no question it answers that a fragment of the credential would answer
 * better.
 */
export function describeRelayApiKey(env: NodeJS.ProcessEnv = process.env): "CONFIGURED" | "UNCONFIGURED" {
  return resolveRelayApiKey(env) === null ? "UNCONFIGURED" : "CONFIGURED";
}
