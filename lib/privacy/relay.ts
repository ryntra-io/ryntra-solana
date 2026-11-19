/**
 * The relay's rules, without Next: which upstream a path reaches, which RPC methods pass, which headers cross.
 *
 * Two upstreams, both Helius devnet and nothing else: `rpc` — Solana JSON-RPC; `spr` — the Privacy Rings indexer and
 * prover under `/v1/spr`. The key goes into the upstream address only (`?api-key=`): with the `apiKey` parameter the
 * prover's enclave answers 401. Nothing here reads a body beyond the RPC method name; prover bodies are encrypted to the
 * enclave and pass as bytes.
 */

export const RELAY_HOST = 'devnet.helius-rpc.com';

export type RelayTarget = 'rpc' | 'spr' | 'policy';

/**
 * The prover's signed policy for devnet, as the SDK pins it (`SignedTeePolicy.forNetwork('devnet')`). The site's
 * content policy keeps the browser on its own origin, so the relay hands this file over as is; it is signed by keys the
 * SDK pins, so a relay could not change it unnoticed.
 */
export const POLICY_URL = 'https://d3gbdb0egjwcw9.cloudfront.net/tee-policy/devnet.json';

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

/** The upstream address for a relay path, or null when the path is not one the relay serves. */
export function upstreamUrl(target: string, segments: readonly string[], search: string, apiKey: string): URL | null {
  if (!apiKey) return null;
  if (target === 'rpc') {
    if (segments.length) return null;
    const url = new URL(`https://${RELAY_HOST}/`);
    url.searchParams.set('api-key', apiKey);
    return url;
  }
  if (target === 'policy') return segments.length ? null : new URL(POLICY_URL);
  if (target !== 'spr') return null;
  if (!segments.every((part) => SEGMENT.test(part))) return null;
  const url = new URL(`https://${RELAY_HOST}/v1/spr${segments.length ? `/${segments.join('/')}` : ''}`);
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
