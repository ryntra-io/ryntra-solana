/**
 * The relay's rules, without Next: which upstream a path reaches, which RPC methods pass, which headers cross.
 *
 * Two upstreams per network, both Helius and nothing else: `rpc` — Solana JSON-RPC; `spr` — the Privacy Rings indexer
 * and prover under `/v1/spr`. The network is the relay's parameter (`/api/v1/privacy/<network>/**`): devnet reaches
 * Helius devnet, mainnet reaches Helius mainnet, each with its own key. The key goes into the upstream address only
 * (`?api-key=`): with the `apiKey` parameter the prover's enclave answers 401. Nothing here reads a body beyond the RPC
 * method name; prover bodies are encrypted to the enclave and pass as bytes.
 *
 * These are the open rules — devnet's. On mainnet, where the key is a paid one, the relay keeps stricter ones on top
 * (`relay-strict.ts`: the SDK's own routes, programs and filters; the ring's transactions and accounts only) and answers
 * nothing without the page's session token (`relay-session.server.ts`) — handed only to a wallet the browser proved to
 * Ryntra, carried in `RELAY_SESSION_HEADER` and never passed on to Helius.
 */

import type { PrivateNetwork } from './network.ts';

/** Helius's host for each network: the same `/v1/spr` base on both (`helius-truth`, §10). */
export const RELAY_HOSTS: Readonly<Record<PrivateNetwork, string>> = Object.freeze({
  devnet: 'devnet.helius-rpc.com',
  mainnet: 'mainnet.helius-rpc.com',
});

/** The devnet host — the relay's first network, named for the line's older callers. */
export const RELAY_HOST = RELAY_HOSTS.devnet;

export type RelayTarget = 'rpc' | 'spr' | 'policy' | 'session';

/** The header the page's SDK client carries its relay session token in (`sdk.client.ts`). Not in `PASS_IN`: it stays here. */
export const RELAY_SESSION_HEADER = 'ryntra-relay-session';

/**
 * Whether a network's relay keeps the strict rules (`relay-strict.ts`) and asks for the page's session token: mainnet,
 * where the key is a paid one. Devnet keeps the open rules below, as before.
 */
export function strictRelay(network: PrivateNetwork): boolean {
  return network === 'mainnet';
}

/**
 * The prover's signed policy for each network, as the SDK pins it (`SignedTeePolicy.forNetwork(<network>)`, the same
 * two addresses in the vendored bundle). The site's content policy keeps the browser on its own origin, so the relay
 * hands this file over as is; it is signed by keys the SDK pins, so a relay could not change it unnoticed.
 */
export const POLICY_URLS: Readonly<Record<PrivateNetwork, string>> = Object.freeze({
  devnet: 'https://d3gbdb0egjwcw9.cloudfront.net/tee-policy/devnet.json',
  mainnet: 'https://d3gbdb0egjwcw9.cloudfront.net/tee-policy/mainnet.json',
});

/** The devnet policy — the relay's first network, named for the line's older callers. */
export const POLICY_URL = POLICY_URLS.devnet;

/** The public websocket the SDK is handed for subscriptions it never opens: it confirms by polling the relay. */
export const SUBSCRIPTION_URLS: Readonly<Record<PrivateNetwork, string>> = Object.freeze({
  devnet: 'wss://api.devnet.solana.com',
  mainnet: 'wss://api.mainnet-beta.solana.com',
});

/** The RPC methods the SDK and the private balance use (read from the SDK's own calls). Anything else is refused. */
export const RPC_METHODS: ReadonlySet<string> = new Set([
  'getAccountInfo',
  'getMultipleAccounts',
  'getBalance',
  'getLatestBlockhash',
  'getSlot',
  'getSignatureStatuses',
  'getProgramAccounts',
  'sendTransaction',
]);

/** `getProgramAccounts` reads the ring's two programs only — the pool and the address registry — never any program. */
export const RING_PROGRAMS: ReadonlySet<string> = new Set(['ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW', 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ']);

/** The most calls one RPC body carries under the open rules (devnet); on mainnet one (`STRICT_MAX_BATCH`). */
export const MAX_BATCH = 8;

/** Request headers the SDK sets that the upstream needs: the enclave's encryption envelope and the prover's mode. */
const PASS_IN = ['content-type', 'accept', 'spr-tee', 'spr-tee-enc', 'spr-tee-ciphertext', 'x-sync', 'x-async'];
/** Response headers the SDK reads back. */
const PASS_OUT = ['content-type', 'spr-tee', 'retry-after'];

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The largest answer the relay hands back: proofs and encrypted outputs are kilobytes, a program's accounts more. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

/** A path segment of the SDK's routes (`attestation`, `prove/<key>`, `status`…): no `..`, nothing that leaves `/v1/spr`. */
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,96}$/;
/** The query the SDK sends: a prover job, an attestation's fresh nonce. Anything else — a key the browser sent too — is dropped. */
const QUERY: Readonly<Record<string, RegExp>> = { jobId: /^[A-Za-z0-9_-]{1,96}$/, nonce: /^[0-9a-fA-F]{2,256}$/ };

/** The upstream address for a relay path on a network, or null when the path is not one the relay serves. */
export function upstreamUrl(target: string, segments: readonly string[], search: string, apiKey: string, network: PrivateNetwork = 'devnet'): URL | null {
  if (!apiKey) return null;
  // Only the table's own two names: a path's word never reaches the object's prototype.
  if (network !== 'devnet' && network !== 'mainnet') return null;
  const host = RELAY_HOSTS[network];
  if (target === 'rpc') {
    if (segments.length) return null;
    const url = new URL(`https://${host}/`);
    url.searchParams.set('api-key', apiKey);
    return url;
  }
  if (target === 'policy') return segments.length ? null : new URL(POLICY_URLS[network]);
  if (target !== 'spr') return null;
  if (!segments.every((part) => SEGMENT.test(part))) return null;
  const url = new URL(`https://${host}/v1/spr${segments.length ? `/${segments.join('/')}` : ''}`);
  const incoming = new URLSearchParams(search);
  for (const [name, rule] of Object.entries(QUERY)) {
    const value = incoming.get(name);
    if (value === null) continue;
    if (!rule.test(value)) return null;
    url.searchParams.set(name, value);
  }
  url.searchParams.set('api-key', apiKey);
  return url;
}

/** Whether every call in a JSON-RPC body (one or a small batch) is a method the relay passes, on what it may read. */
export function rpcAllowed(body: unknown): boolean {
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > MAX_BATCH) return false;
  return calls.every((call) => {
    if (typeof call !== 'object' || call === null) return false;
    const { method, params } = call as { method?: unknown; params?: unknown };
    if (!RPC_METHODS.has(String(method))) return false;
    if (method === 'getProgramAccounts') return Array.isArray(params) && RING_PROGRAMS.has(String(params[0]));
    return true;
  });
}

export function passInHeaders(from: Headers): Headers {
  const out = new Headers();
  for (const name of PASS_IN) {
    const value = from.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

export function passOutHeaders(from: Headers): Headers {
  const out = new Headers();
  for (const name of PASS_OUT) {
    const value = from.get(name);
    if (value !== null) out.set(name, value);
  }
  out.set('cache-control', 'no-store');
  return out;
}

/**
 * A browser call from this site only: the relay is not an open Helius gateway. Every browser marks its own fetches with
 * `Sec-Fetch-Site`; a call without it (a script, curl) is refused, and so is one from another site.
 */
export function sameSite(headers: Headers): boolean {
  return headers.get('sec-fetch-site') === 'same-origin';
}
