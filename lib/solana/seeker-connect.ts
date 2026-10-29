/**
 * Seeker Connect — what the rest of Ryntra needs to know about it, without
 * the package itself.
 *
 * Seeker Connect is Solana Mobile's Wallet Standard wallet for a web page open
 * in the browser on a Seeker phone: it launches the phone's own wallet through
 * Mobile Wallet Adapter and carries the session over a Nostr relay. To this
 * product it is one more wallet beside Phantom, Solflare and Backpack — found
 * by the same registry, asked for the same `solana:signTransaction`.
 *
 * This file holds no `window` and imports nothing from the package, so the
 * server (the CSP in `next.config.ts`) and the browser read the same relay and
 * the same name. The package is loaded only in the browser, and only on
 * Android, by `seeker-connect.client.ts`.
 */

/** The name the package registers under (`SeekerConnectWalletName`). */
export const SEEKER_CONNECT_WALLET = "Seeker Connect";

/**
 * The network the registration asks for. Seeker Connect ignores the `chain` of
 * each call and replays the one it was registered with, so this is the only
 * network a Seeker signature is ever for; `wallet.client.ts` refuses a request
 * for any other rather than let the two disagree in silence.
 */
export const SEEKER_CHAIN = "solana:mainnet";

/**
 * The Nostr relay that carries the session — ciphertext only, end to end
 * between this page and the wallet. Primal's public relay until the operator
 * accepts Solana Mobile's terms for `relay.solanamobile.com` on the quickstart
 * page and sets `NEXT_PUBLIC_SEEKER_RELAY_DOMAIN`; nothing here assumes them.
 */
export const DEFAULT_SEEKER_RELAY_DOMAIN = "relay.primal.net";

/**
 * Solana Mobile's own relay — the target.
 * Only the CSP names it: the page uses it once the operator, having accepted the
 * terms on the quickstart page, sets `NEXT_PUBLIC_SEEKER_RELAY_DOMAIN` to it.
 */
export const SOLANA_MOBILE_SEEKER_RELAY_DOMAIN = "relay.solanamobile.com";

/* A bare host: letters, digits and hyphens in dot-separated labels, no scheme,
   no port, no path. Anything else would end up in the CSP header verbatim. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * The relay host, from the variable when it names one, else the default.
 *
 * A value with a scheme (`wss://…`) is the one mistake the package's own docs
 * warn about — the SDK adds `wss://` itself — so it is taken off rather than
 * failed on; any other malformed value falls back to the default instead of
 * reaching the header.
 */
export function seekerRelayDomain(raw: string | undefined | null = process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN): string {
  const value = (raw ?? "").trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return HOST.test(value) ? value : DEFAULT_SEEKER_RELAY_DOMAIN;
}

/** The CSP `connect-src` source for the relay. */
export function seekerRelayOrigin(raw?: string | null): string {
  return `wss://${seekerRelayDomain(raw)}`;
}

/**
 * Every relay the CSP allows: Primal's (the default) and Solana Mobile's (the
 * target) always, so switching the variable needs no header change, and the
 * one the variable names if it is a third. WebSocket only.
 */
export function seekerRelayCspSources(raw?: string | null): string {
  const hosts = new Set([DEFAULT_SEEKER_RELAY_DOMAIN, SOLANA_MOBILE_SEEKER_RELAY_DOMAIN, seekerRelayDomain(raw)]);
  return [...hosts].map((host) => `wss://${host}`).join(" ");
}

/**
 * Whether this browser is on Android — the only place a Seeker wallet can
 * answer. Elsewhere Seeker Connect is not registered at all, so a computer's
 * list stays Phantom, Solflare and Backpack, exactly as before.
 */
export function isAndroidUserAgent(userAgent: string | undefined | null): boolean {
  return /\bAndroid\b/i.test(userAgent ?? "");
}

export const SEEKER_FAILURE_CODES = [
  "association-failed",
  "authorization-declined",
  "request-declined",
  "session-closed",
  "cancelled",
  "wallet-error",
] as const;
export type SeekerFailureCode = (typeof SEEKER_FAILURE_CODES)[number];

/**
 * The `SeekerConnectError` code of a failure, read by shape rather than by
 * `instanceof`, so nothing outside the browser module has to import the
 * package. A plain `Error` — the package's own misuse errors — has no code.
 */
export function seekerFailureCode(failure: unknown): SeekerFailureCode | null {
  if (typeof failure !== "object" || failure === null) return null;
  const { name, code } = failure as { name?: unknown; code?: unknown };
  if (name !== "SeekerConnectError" || typeof code !== "string") return null;
  return (SEEKER_FAILURE_CODES as readonly string[]).includes(code) ? (code as SeekerFailureCode) : null;
}

/**
 * The text a Mobile Wallet Adapter wallet signed, without the signature on its
 * end.
 *
 * MWA's `sign_messages` answers with the message and the 64-byte signature
 * appended, and Seeker Connect hands that through as `signedMessage`. The
 * server verifies the exact sign-in text it issued, so the bytes it receives
 * must be that text: when the answer is precisely the message followed by the
 * signature, the message is what was signed. Anything else is passed on as it
 * came and the server decides — this never makes a signature valid, it only
 * stops a valid one from being sent in the wrong shape.
 */
export function signedMessageText(message: Uint8Array, signedMessage: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signedMessage.length !== message.length + signature.length) return signedMessage;
  for (let index = 0; index < message.length; index++) if (signedMessage[index] !== message[index]) return signedMessage;
  for (let index = 0; index < signature.length; index++) if (signedMessage[message.length + index] !== signature[index]) return signedMessage;
  return message;
}

/**
 * The connection count (SKR-1): how many times «Connect with Seeker» worked,
 * was cancelled, or did not connect — in Ryntra's one event log, the anonymous
 * `events` table `/api/track` already writes for the site's clicks.
 *
 * One event name per outcome, so the admin's 14-day count by name (the same
 * `cta_events_14d` the CTA clicks use) is the counter with nothing new beside
 * it. The person declining in the wallet counts as cancelled: they chose, as
 * when they close the overlay. Everything else that ends without an account —
 * a launch nothing answered, a closed session, a wallet error, a wallet that
 * offered no signing account — did not connect.
 */
export const SEEKER_CONNECT_EVENTS = {
  connected: "seeker_connect_ok",
  cancelled: "seeker_connect_cancelled",
  failed: "seeker_connect_failed",
} as const;
export type SeekerConnectOutcome = keyof typeof SEEKER_CONNECT_EVENTS;
export type SeekerConnectEventName = (typeof SEEKER_CONNECT_EVENTS)[SeekerConnectOutcome];
export const SEEKER_CONNECT_EVENT_NAMES: readonly SeekerConnectEventName[] = Object.values(SEEKER_CONNECT_EVENTS);

export function seekerConnectOutcome(result: Readonly<{ ok: boolean; state?: string }>): SeekerConnectOutcome {
  if (result.ok) return "connected";
  return result.state === "CANCELLED" || result.state === "REFUSED" ? "cancelled" : "failed";
}

/* A path segment kept in the count: a lowercase word, nothing longer than a
   route name. A Solana address (32–44 base58 characters), a mint, an id or a
   ticker never fits, so the count says where — `/app/launch` — never whose. */
const ROUTE_WORD = /^[a-z][a-z-]{1,23}$/;

/** Where the connect happened, cut to its first two route words. */
export function seekerEventPath(pathname: string | null | undefined): string | null {
  const words: string[] = [];
  for (const segment of (pathname ?? "").split("/").filter(Boolean)) {
    if (words.length === 2 || !ROUTE_WORD.test(segment)) break;
    words.push(segment);
  }
  return words.length ? `/${words.join("/")}` : null;
}

export type SeekerConnectEvent = Readonly<{
  name: SeekerConnectEventName;
  /** Why, in the package's own words or the wallet state — a fixed vocabulary, never a message. */
  placement: string | null;
  locale: string | null;
  path: string | null;
  /* No referrer: where the person came from is not the count's business. */
  ref: null;
}>;

/* The wallet states a connect can end in (`WALLET_STATES` in `wallet.client.ts`), as the count writes them. */
const SEEKER_COUNT_STATES = ["unsupported", "no_wallet", "refused", "pending", "failed", "cancelled", "unreachable"] as const;
/** Every reason a Seeker count may carry: the package's codes and the wallet states. Nothing else is stored. */
export const SEEKER_COUNT_REASONS: ReadonlySet<string> = new Set<string>([...SEEKER_FAILURE_CODES, ...SEEKER_COUNT_STATES]);
const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/**
 * The one row a Seeker count may store, from whatever a request carried — the
 * shape both the browser and `/api/track` hold it to, so a crafted request
 * can no more put an address in the log than the page can: the name must be
 * one of the three, the reason one of the fixed vocabulary, the language a
 * language tag, the route its first two words, and there is no referrer.
 * `null` when the name is not a Seeker count.
 */
export function seekerTrackRow(body: Readonly<Record<string, unknown>>): SeekerConnectEvent | null {
  const { name, placement, locale, path } = body;
  if (typeof name !== "string" || !(SEEKER_CONNECT_EVENT_NAMES as readonly string[]).includes(name)) return null;
  return {
    name: name as SeekerConnectEventName,
    placement: typeof placement === "string" && SEEKER_COUNT_REASONS.has(placement) ? placement : null,
    locale: typeof locale === "string" && LOCALE.test(locale) ? locale : null,
    path: typeof path === "string" ? seekerEventPath(path) : null,
    ref: null,
  };
}

/**
 * The one row a Seeker connect writes: the outcome, its code, the language and
 * the route — no address, no key, no message text, nothing about the person.
 */
export function seekerConnectEvent(
  result: Readonly<{ ok: boolean; state?: string; code?: SeekerFailureCode }>,
  where: Readonly<{ pathname?: string | null; locale?: string | null }> = {},
): SeekerConnectEvent {
  const row = seekerTrackRow({
    name: SEEKER_CONNECT_EVENTS[seekerConnectOutcome(result)],
    placement: result.ok ? null : (result.code ?? result.state?.toLowerCase()),
    locale: where.locale,
    path: where.pathname,
  });
  /* The name is one of the three by construction. */
  return row as SeekerConnectEvent;
}
