/**
 * The relay's page session: a short-lived token the server signs and the page's SDK client carries on every
 * relay call (`sdk.client.ts`, header `RELAY_SESSION_HEADER`). On mainnet the relay answers nothing without a valid one
 * (`relay-handler.server.ts`); devnet does not ask for it, as before.
 *
 * **A proven wallet's only.** Where the relay is strict, a session is handed out only to a browser that has
 * proved a wallet to Ryntra with that wallet's own signature (`readWalletProofFrom`: its sign-in, or a separate proof —
 * never a wallet merely linked to an account). The token names that wallet, is signed over it, and lives no longer than
 * the proof itself; a token that names no wallet opens nothing there (`unproven`).
 *
 * The token names its network, the moment it runs out and its wallet (`-` where none was asked: devnet), carries a random
 * nonce, and is signed with HMAC-SHA256 over those and the caller's address. A token taken from one address does not open
 * the relay from another, one taken for one network does not open the other, and one past its time opens nothing. The
 * address itself is not in the token.
 *
 * The signing secret is derived from the network's relay key (`relay-key.server.ts`), so no new secret or variable is
 * needed: it never leaves the server, every instance derives the same one, and a new key ends every session.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { PrivateNetwork } from './network.ts';

/** How long a session lives at most; the page asks for the next one a minute before. */
export const RELAY_SESSION_TTL_MS = 10 * 60_000;
/** The clock difference between instances a token's time may carry. */
const SKEW_MS = 60_000;
const VERSION = 'rs2';
const MAC = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{16}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** The wallet field of a session no wallet was asked for. */
const NO_WALLET = '-';

export type RelaySession = Readonly<{ token: string; ttlMs: number }>;
export type RelaySessionVerdict = 'ok' | 'missing' | 'malformed' | 'network' | 'expired' | 'forged' | 'unproven';

function secretOf(key: string, network: PrivateNetwork): Buffer {
  return createHmac('sha256', key).update(`ryntra/privacy-relay/session/v1/${network}`).digest();
}

function macOf(key: string, network: PrivateNetwork, body: string, address: string): string {
  return createHmac('sha256', secretOf(key, network)).update(`${body}|${address}`).digest('base64url');
}

/**
 * A new session for `address` on `network`, signed with that network's relay key. `wallet` — the proven wallet it is
 * handed to; `untilMs` — when that proof runs out: the session never outlives it.
 */
export function issueRelaySession(
  input: Readonly<{ key: string; network: PrivateNetwork; address: string; nowMs: number; wallet?: string | null; untilMs?: number }>,
): RelaySession {
  const { key, network, address, nowMs } = input;
  const wallet = input.wallet ?? null;
  if (!key) throw new Error('relay key missing');
  if (wallet !== null && !WALLET.test(wallet)) throw new Error('relay session wallet unreadable');
  const until = input.untilMs;
  const expires = typeof until === 'number' && Number.isFinite(until) ? Math.min(nowMs + RELAY_SESSION_TTL_MS, Math.floor(until)) : nowMs + RELAY_SESSION_TTL_MS;
  if (expires <= nowMs) throw new Error('relay session proof run out');
  const body = `${VERSION}.${network}.${expires}.${wallet ?? NO_WALLET}.${randomBytes(12).toString('base64url')}`;
  return { token: `${body}.${macOf(key, network, body, address)}`, ttlMs: expires - nowMs };
}

/**
 * Whether `token` is a live session of `address` on `network`. `proven` — the network asks for a proven wallet's
 * session: a token that names none is `unproven`, even when the server signed it.
 */
export function verifyRelaySession(
  input: Readonly<{ token: string | null | undefined; key: string; network: PrivateNetwork; address: string; nowMs: number; proven?: boolean }>,
): RelaySessionVerdict {
  const { token, key, network, address, nowMs } = input;
  if (!token) return 'missing';
  if (!key || token.length > 200) return 'malformed';
  const parts = token.split('.');
  if (parts.length !== 6) return 'malformed';
  const [version, named, expiresText, wallet, nonce, mac] = parts;
  if (version !== VERSION || !/^\d{1,16}$/.test(expiresText) || (wallet !== NO_WALLET && !WALLET.test(wallet)) || !NONCE.test(nonce) || !MAC.test(mac)) return 'malformed';
  if (named !== network) return 'network';
  const expected = Buffer.from(macOf(key, network, parts.slice(0, 5).join('.'), address));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'forged';
  const expires = Number(expiresText);
  if (expires <= nowMs || expires > nowMs + RELAY_SESSION_TTL_MS + SKEW_MS) return 'expired';
  if (input.proven === true && wallet === NO_WALLET) return 'unproven';
  return 'ok';
}

/**
 * The wallet a session names — read only after `verifyRelaySession` said `ok`, so the name is the server's own: the
 * mainnet relay counts its calls against that wallet as well as against the address. Null — a
 * session that names none (devnet's) or no session.
 */
export function relaySessionWallet(token: string | null | undefined): string | null {
  const wallet = token?.split('.')[3];
  return wallet !== undefined && wallet !== NO_WALLET && WALLET.test(wallet) ? wallet : null;
}
