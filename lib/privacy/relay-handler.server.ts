/**
 * One call of Ryntra's relay to Helius, without Next (`app/api/v1/privacy/[network]/[target]/[[...path]]/route.ts` is
 * its door): the route names the served network and its key, this decides and forwards. Its deps — the upstream fetch,
 * the Guard store, the instance's limiter and the clock — come in, so the whole call is tested as it runs.
 *
 * In order, and nothing reaches Helius or the store before every check:
 * 1. a browser call from this site (`sameSite`), within the instance's own floor (`limiter`); on strict networks an IPv6
 *    address counts by its /64 — one machine holds a whole /64;
 * 2. `session` — the page's relay session token (`relay-session.server.ts`), handed out here; on strict networks only to
 *    a browser that has proved a wallet with its own signature (`walletProof`), and the token names that wallet: no proof — 401, a session store that does not answer — 503;
 * 3. a path the relay serves (`upstreamUrl`) with its method;
 * 4. strict networks (mainnet, `strictRelay`): a live session token of a proven wallet, or 401;
 * 5. strict networks: under `spr`, the SDK's own routes only (`sprRouteRefusal`), or 404;
 * 6. the body: its size (on strict networks `strictBodyCap`), and for RPC the rules — the open ones on devnet
 *    (`rpcAllowed`), the strict ones on mainnet (`relay-strict.ts`: one call, the ring's transactions, accounts and
 *    programs only); on strict networks the body that goes on is the one rebuilt from what was checked, an RPC call's or
 *    an indexer query's, never the bytes as they came;
 * 7. the shared limit (`relay-limit.server.ts`): counted only now, so a refused call writes no row — on strict networks
 *    against the address and the session's wallet, a proof besides against the prover's own ceiling; no count — 503;
 * 8. Helius; on strict networks an account read's answer goes back only when every account in it is the ring's.
 *
 * It builds nothing and signs nothing; no body is logged or kept.
 */

import type { WalletProofRead } from '../account/wallet-session.ts';
import type { GuardStore } from '../guard/store.ts';
import { clientIp, rateLimitHeaders, type FixedWindowLimiter, type RateLimitDecision } from '../http-control.ts';
import { networkOf } from '../vault/identity.ts';
import type { PrivateNetwork } from './network.ts';
import { MAX_ANSWER_BYTES, MAX_BODY_BYTES, RELAY_SESSION_HEADER, passInHeaders, passOutHeaders, rpcAllowed, sameSite, strictRelay, upstreamUrl } from './relay.ts';
import { RELAY_LIMIT, consumeRelayQuotas, relayBuckets, type RelayBucket } from './relay-limit.server.ts';
import { answerAllowed, isProofCall, sprRouteRefusal, strictBodyCap, strictIndexerBody, strictRpcCheck } from './relay-strict.ts';
import { issueRelaySession, relaySessionWallet, verifyRelaySession } from './relay-session.server.ts';

export type RelayDeps = Readonly<{
  fetch: typeof fetch;
  /** The Guard store; a store that cannot be had is a refusal (503), never a pass. */
  store: () => GuardStore;
  /** The instance's floor in front of the shared count. */
  limiter: FixedWindowLimiter;
  now: () => number;
  /**
   * The wallet this browser proved to Ryntra with the wallet's own signature (`readWalletProofFrom` in `lib/session.ts`:
   * the sign-in or a separate proof, never a link alone). Asked only when a strict network hands out a session.
   */
  walletProof: (request: Request) => Promise<WalletProofRead>;
}>;

export type RelayCall = Readonly<{ network: PrivateNetwork; key: string; target: string; path: readonly string[] }>;

const NO_STORE = { 'cache-control': 'no-store' } as const;

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...headers } });
}

const refusedNoStore = () => empty(503, { 'retry-after': '30' });

/**
 * The page's session. Where the relay is open (devnet) it is handed out as before and never asked for. Where it is strict,
 * only to a proven wallet: the token names it and lives no longer than its proof.
 */
async function session(request: Request, call: RelayCall, deps: RelayDeps, address: string): Promise<Response> {
  const { network, key } = call;
  const nowMs = deps.now();
  if (!strictRelay(network)) return json(issueRelaySession({ key, network, address, nowMs }));
  const read = await deps.walletProof(request).catch((): WalletProofRead => ({ status: 'unavailable' }));
  if (read.status === 'unavailable') return refusedNoStore();
  const proof = read.status === 'ok' && read.proof.chain === 'solana' && read.proof.via !== 'link' ? read.proof : null;
  const untilMs = proof ? Date.parse(proof.expiresAt) : NaN;
  if (!proof || !(untilMs > nowMs)) return json({ error: 'PROVE_WALLET' }, 401);
  try {
    return json(issueRelaySession({ key, network, address, nowMs, wallet: proof.address, untilMs }));
  } catch {
    return json({ error: 'PROVE_WALLET' }, 401);
  }
}

/** A JSON-RPC refusal, as the SDK reads one: the call's own id when it was one call. */
function rpcRefusal(body: unknown, message: string): Response {
  const id = !Array.isArray(body) && typeof body === 'object' && body !== null ? ((body as { id?: unknown }).id ?? null) : null;
  return json({ jsonrpc: '2.0', id, error: { code: -32601, message } });
}

/** The shared count against every bucket of the call; its refusal is the relay's refusal. */
async function sharedLimit(deps: RelayDeps, network: PrivateNetwork, buckets: readonly RelayBucket[], local: RateLimitDecision): Promise<RateLimitDecision | null> {
  let store: GuardStore;
  try {
    store = deps.store();
  } catch {
    return null;
  }
  const answer = await consumeRelayQuotas(store, { network, buckets, nowMs: deps.now() });
  if (answer.kind === 'counted') return answer.decision;
  if (answer.kind === 'local') return local;
  return null;
}

/** A rebuilt body as the bytes that go. */
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text));

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function relayCall(request: Request, call: RelayCall, deps: RelayDeps): Promise<Response> {
  const { network, key, target, path } = call;
  const self = new URL(request.url);
  if (!sameSite(request.headers)) return empty(403);
  const strict = strictRelay(network);
  const ip = clientIp(request.headers);
  // On strict networks an IPv6 address counts by its /64: one machine holds a whole /64, a key per address would hand it
  // a limit per address. Devnet counts as before.
  const address = strict ? networkOf(ip) : ip;
  const local = deps.limiter.consume(address);
  if (!local.allowed) return empty(429, rateLimitHeaders(local));

  if (target === 'session') {
    if (path.length) return empty(404);
    if (request.method !== 'GET') return empty(405);
    return session(request, call, deps, address);
  }

  const upstream = upstreamUrl(target, [...path], self.search, key, network);
  if (!upstream) return empty(404);
  if ((target === 'rpc' && request.method !== 'POST') || (target === 'policy' && request.method !== 'GET')) return empty(405);
  const token = request.headers.get(RELAY_SESSION_HEADER);
  if (strict && verifyRelaySession({ token, key, network, address, nowMs: deps.now(), proven: true }) !== 'ok') return empty(401);
  // Under `spr`, the SDK's own routes only: nothing else Helius serves there is reached with Ryntra's key.
  if (strict && target === 'spr' && sprRouteRefusal(request.method, path, self.search)) return empty(404);

  let body: ArrayBuffer | undefined;
  /* On strict networks, the body that goes on: rebuilt from what was checked, so Helius reads what the relay read. */
  let forward: Uint8Array<ArrayBuffer> | undefined;
  let parsed: unknown = null;
  let calls: readonly unknown[] | null = null;
  if (request.method === 'POST') {
    const cap = strict ? strictBodyCap(target, path) : MAX_BODY_BYTES;
    // The size is checked before the body is read, and again after (a body may come without a length).
    if (Number(request.headers.get('content-length') ?? 0) > cap) return empty(413);
    try {
      body = await request.arrayBuffer();
    } catch {
      return empty(400);
    }
    if (body.byteLength > cap) return empty(413);
    if (target === 'rpc') {
      parsed = parseJson(body);
      if (strict) {
        const check = strictRpcCheck(parsed);
        if (!check.ok) return rpcRefusal(parsed, 'Not served here.');
        calls = check.calls;
        forward = utf8(check.body);
      } else if (!rpcAllowed(parsed)) {
        return rpcRefusal(parsed, 'Method not served here.');
      }
    } else if (strict && target === 'spr' && path.length === 1) {
      // An indexer query: the SDK's own shape and the method its path names, rebuilt.
      parsed = parseJson(body);
      const query = strictIndexerBody(path[0], parsed);
      if (query === null) return rpcRefusal(parsed, 'Not served here.');
      forward = utf8(query);
    }
  }

  // Counted only now: a call refused above never writes a row in the store. On strict networks against the
  // address and the session's wallet, a proof besides against the prover's own ceiling.
  const buckets = strict ? relayBuckets({ address, wallet: relaySessionWallet(token), proof: isProofCall(request.method, target, path) }) : [{ subject: address, limit: RELAY_LIMIT.limit }];
  const rate = await sharedLimit(deps, network, buckets, local);
  if (!rate) return refusedNoStore();
  if (!rate.allowed) return empty(429, rateLimitHeaders(rate));

  const outgoing = passInHeaders(request.headers);
  if (forward !== undefined) outgoing.set('content-type', 'application/json');
  const answer = await deps.fetch(upstream, { method: request.method, headers: outgoing, body: forward ?? body, cache: 'no-store', signal: AbortSignal.timeout(55_000) }).catch(() => null);
  if (!answer) return empty(502);
  const headers = passOutHeaders(answer.headers);
  for (const [name, value] of Object.entries(rateLimitHeaders(rate))) headers.set(name, value);
  if (Number(answer.headers.get('content-length') ?? 0) > MAX_ANSWER_BYTES) return empty(502);
  let bytes: ArrayBuffer;
  try {
    bytes = await answer.arrayBuffer();
  } catch {
    // The answer broke off on its way (a reset, the timeout): Helius gave nothing whole to hand back.
    return empty(502);
  }
  if (bytes.byteLength > MAX_ANSWER_BYTES) return empty(502);
  if (calls && !answerAllowed(calls, new Uint8Array(bytes))) return rpcRefusal(parsed, 'Account not served here.');
  return new Response(bytes, { status: answer.status, headers });
}
