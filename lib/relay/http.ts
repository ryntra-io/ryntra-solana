/**
 * The headers every Relay call carries, in one place.
 *
 * Pure and client-safe: it formats whatever key it is handed and reads no
 * environment of its own. `api-key.server.ts` is the only module that resolves
 * one, and only a server route calls it — so a browser bundle can import this
 * file and still have no way to obtain a credential to put in it.
 *
 * Relay authenticates with `x-api-key`, not a bearer token. The header is omitted
 * entirely rather than sent empty when no key is configured, because an empty
 * `x-api-key` is a malformed credential where an absent one is an anonymous call,
 * and the two fail differently: `/quote` and `/currencies/v2` still answer an
 * anonymous call, `/requests/v3` refuses one.
 */

export type RelayAuth = Readonly<{ apiKey?: string | null }>;

/** `accept`, whatever else the call needs, and the key when there is one. */
export function relayHeaders(auth: RelayAuth = {}, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", ...extra };
  const key = typeof auth.apiKey === "string" ? auth.apiKey.trim() : "";
  if (key.length > 0) headers["x-api-key"] = key;
  return headers;
}

/** The JSON-body variant, so no call site has to remember `content-type`. */
export function relayJsonHeaders(auth: RelayAuth = {}): Record<string, string> {
  return relayHeaders(auth, { "content-type": "application/json" });
}
