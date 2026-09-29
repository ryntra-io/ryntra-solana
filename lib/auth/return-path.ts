/**
 * Where a person goes back to after an identity round-trip.
 *
 * A login callback redirects to a path the product chose before the round
 * trip started, never to a URL a provider or a query string supplied on the
 * way back. The allowlist is the set of first-party application areas; the
 * default is the cabinet. Only a path is kept — no scheme, no host — so an
 * open redirect cannot be smuggled through a callback.
 */
const ALLOWED = /^\/(app|solana|agents|admin)(\/|$|\?|#)/;
const MAX_LENGTH = 512;
/* Whitespace and control characters never belong in a path we redirect to. */
const UNSAFE = /[\s\u0000-\u001f]/;

export const DEFAULT_RETURN_PATH = "/app";
export const DEFAULT_ADMIN_RETURN_PATH = "/admin";
/** Where a recovery link continues: the page that sets a new password. */
export const RESET_PATH = "/app/settings/reset";

export function safeReturnPath(candidate: string | null | undefined, fallback: string = DEFAULT_RETURN_PATH): string {
  if (typeof candidate !== "string") return fallback;
  const value = candidate.trim();
  if (value.length === 0 || value.length > MAX_LENGTH) return fallback;
  /* A protocol-relative or absolute URL never passes: `//evil.example` starts
     with a slash but the second character disqualifies it. */
  if (value.startsWith("//") || value.includes("\\") || UNSAFE.test(value)) return fallback;
  if (!ALLOWED.test(value)) return fallback;
  return value;
}

/** Append a marker the client reads once, without touching the rest of the path. */
export function withAuthMarker(path: string, marker: "ok" | "cancel" | "error", reason?: string): string {
  const [base, hash] = path.split("#", 2);
  const [pathname, search] = base.split("?", 2);
  const params = new URLSearchParams(search ?? "");
  params.set("auth", marker);
  if (reason) params.set("reason", reason.replace(/[^a-z0-9_]/gi, "").slice(0, 40));
  else params.delete("reason");
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
