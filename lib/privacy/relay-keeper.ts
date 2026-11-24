/**
 * The page's relay session, kept for the SDK client (`sdk.client.ts`): one token, asked of the relay once and again a
 * minute before it runs out, carried on every relay call (`RELAY_SESSION_HEADER`). Pure: the fetch and the clock come in.
 *
 * **A failed token is not asked again.** Before, a session the relay would not give was asked for again on
 * every call — twice per call with the retry after 401 — so a page without a proven wallet hammered the session route.
 * Now:
 * - a refused session is remembered: the relay's own «prove the wallet» (401) until the page proves one (`forget`), any
 *   other failure for `RETRY_AFTER_MS`; meanwhile calls go without a token and ask nothing;
 * - a call the relay answers 401 is sent once more only with a token other than the one it carried: one another call has
 *   just brought, or — when the refused token is still the one held — a new one asked once for every call that waits;
 *   a call that went without a token, or whose new token did not come, is not sent again;
 * - asks never run side by side: calls that need a token at once wait for the same answer.
 *
 * A token that came with less than two minutes to live is held for the first half of its life, not a minute short of
 * its end: in a proof's last minute the relay hands out such tokens, and one held to `SESSION_EARLY_MS` would never count
 * as live — every call would ask again.
 *
 * Devnet's relay does not ask for the token, so a session that is not given there changes nothing.
 */

/** The next session is asked for this long before the current one runs out — half its life, for a shorter one. */
export const SESSION_EARLY_MS = 60_000;
/** A session that failed for any reason but «prove the wallet» is not asked again for this long. */
export const RETRY_AFTER_MS = 30_000;
/** A session refused for want of a proven wallet is not asked again until the page proves one — or, at the latest, this. */
export const UNPROVEN_RETRY_MS = 5 * 60_000;

export type RelayKeeperDeps = Readonly<{
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** The relay's session route on the page's own origin. */
  sessionUrl: string;
}>;

export type RelayKeeper = Readonly<{
  /** The token to carry now; null — none (the relay did not give one, and is not asked again yet). */
  token: () => Promise<string | null>;
  /** After the relay refused `used` (401): the token to send once more with, or null — do not send again. */
  renew: (used: string | null) => Promise<string | null>;
  /** The page proved a wallet: drop what is held and what was refused, so the next call asks afresh. */
  forget: () => void;
  /** One relay call: with the token, and once more after a 401 only when `renew` brings another. */
  call: (send: (token: string | null) => Promise<Response>, resendable: boolean) => Promise<Response>;
}>;

export function relayKeeper(deps: RelayKeeperDeps): RelayKeeper {
  let held: Readonly<{ token: string; until: number; early: number }> | null = null;
  let refusedUntil = 0;
  let asking: Promise<string | null> | null = null;

  const live = (at: number) => held !== null && held.until - at > held.early;

  function ask(): Promise<string | null> {
    asking ??= (async () => {
      try {
        const answer = await deps.fetch(deps.sessionUrl, { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
        if (!answer.ok) {
          refusedUntil = deps.now() + (answer.status === 401 ? UNPROVEN_RETRY_MS : RETRY_AFTER_MS);
          return null;
        }
        const given = (await answer.json()) as { token?: unknown; ttlMs?: unknown };
        if (typeof given.token !== 'string' || !given.token || typeof given.ttlMs !== 'number' || !(given.ttlMs > 0)) {
          refusedUntil = deps.now() + RETRY_AFTER_MS;
          return null;
        }
        held = { token: given.token, until: deps.now() + given.ttlMs, early: Math.min(SESSION_EARLY_MS, given.ttlMs / 2) };
        refusedUntil = 0;
        return given.token;
      } catch {
        refusedUntil = deps.now() + RETRY_AFTER_MS;
        return null;
      } finally {
        asking = null;
      }
    })();
    return asking;
  }

  async function token(): Promise<string | null> {
    const at = deps.now();
    if (live(at)) return held!.token;
    if (asking) return asking;
    if (at < refusedUntil) return null;
    return ask();
  }

  async function renew(used: string | null): Promise<string | null> {
    // A call that carried no token was sent while the session is refused: nothing new is asked for it.
    if (used === null) return null;
    if (asking) {
      const next = await asking;
      return next && next !== used ? next : null;
    }
    const at = deps.now();
    // Another call already brought a new token: send with that one, ask nothing.
    if (held && held.token !== used && live(at)) return held.token;
    if (held?.token === used) held = null;
    if (at < refusedUntil) return null;
    const next = await ask();
    return next && next !== used ? next : null;
  }

  function forget(): void {
    held = null;
    refusedUntil = 0;
  }

  async function call(send: (token: string | null) => Promise<Response>, resendable: boolean): Promise<Response> {
    const used = await token();
    const answer = await send(used);
    if (answer.status !== 401 || !resendable) return answer;
    const next = await renew(used);
    return next ? send(next) : answer;
  }

  return { token, renew, forget, call };
}
