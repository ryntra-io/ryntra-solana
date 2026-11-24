/**
 * Loads the Privacy Rings SDK bundle once per page (`public/privacy/`, built by `scripts/privacy/vendor-sdk.mjs`) and
 * makes one client that reaches Helius on the private balance's network only through Ryntra's relay. Nothing loads
 * until a screen with the private balance open asks for it.
 *
 * Every relay call carries the page's relay session token (`relay-keeper.ts`): asked of the relay once, again a minute
 * before it runs out, and once more when the relay refuses the one held — never again for a session the relay would not
 * give, until the page proves a wallet. Mainnet's relay answers nothing without it and gives it only to a
 * wallet the browser proved to Ryntra (`proveForRelay`, one signed message before a step the person starts); devnet does
 * not ask, so a token the relay did not give leaves the call as it was.
 */

import { proveWallet } from '../../city/lib/trade/proof.ts';
import { PRIVATE_NET, PRIVATE_RELAY, PRIVATE_SDK_URL, privateNetwork } from './network.ts';
import { relayKeeper, type RelayKeeper } from './relay-keeper.ts';
import { POLICY_URLS, RELAY_SESSION_HEADER, SUBSCRIPTION_URLS, strictRelay } from './relay.ts';
import type { Ctx, Spr } from './flows.ts';

let ready: Promise<Ctx> | null = null;
let keeper: RelayKeeper | null = null;

function keeperOf(origin: string): RelayKeeper {
  keeper ??= relayKeeper({ fetch: (input, init) => fetch(input, init), now: () => Date.now(), sessionUrl: `${origin}${PRIVATE_RELAY.session}` });
  return keeper;
}

/** The page proved a wallet: the next relay call asks for a session afresh, with that proof. */
export function forgetRelaySession(): void {
  keeper?.forget();
}

/**
 * Before a step the person starts: where the relay serves a proven wallet only, the wallet proves itself to Ryntra once —
 * one signed message, never a transaction, nothing asked when the proof is already here — and the relay is asked for a
 * session afresh. Where it does not (devnet), nothing is asked.
 */
export async function proveForRelay(connection: Readonly<{ wallet: string; address: string }> | null): Promise<'ok' | 'declined' | 'failed'> {
  if (!strictRelay(PRIVATE_NET)) return 'ok';
  if (!connection) return 'failed';
  const proof = await proveWallet(connection).catch(() => null);
  if (!proof) return 'failed';
  if (!proof.ok) return proof.state === 'declined' ? 'declined' : 'failed';
  forgetRelaySession();
  return 'ok';
}

/** A body that can be sent twice: none, text or bytes — not a stream. */
function resendable(body: BodyInit | null | undefined): boolean {
  return body == null || typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer;
}

export function loadPrivate(): Promise<Ctx> {
  if (!privateNetwork()) return Promise.reject(new Error('private balance is shut'));
  ready ??= (async () => {
    const sdk: Spr = await import(/* webpackIgnore: true */ PRIVATE_SDK_URL);
    await sdk.initializePoseidon();
    const origin = window.location.origin;
    const policy = POLICY_URLS[PRIVATE_NET];
    const relayRoot = `${origin}/api/v1/privacy/`;
    const session = keeperOf(origin);
    const client = await sdk.createSprClient({
      solanaRpcUrl: `${origin}${PRIVATE_RELAY.rpc}`,
      // Subscriptions are not used: the SDK confirms by polling the relay.
      solanaRpcSubscriptionsUrl: SUBSCRIPTION_URLS[PRIVATE_NET],
      indexerUrl: `${origin}${PRIVATE_RELAY.spr}`,
      proverUrl: `${origin}${PRIVATE_RELAY.spr}`,
      proverTee: sdk.SignedTeePolicy.forNetwork(PRIVATE_NET),
      // Every call stays on this site: the prover's signed policy too comes through the relay, with the page's session.
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const to = url === policy ? `${origin}${PRIVATE_RELAY.policy}` : url;
        if (input instanceof Request || !to.startsWith(relayRoot)) return fetch(url === policy ? to : input, init);
        return session.call((token) => {
          const headers = new Headers(init?.headers);
          if (token) headers.set(RELAY_SESSION_HEADER, token);
          return fetch(to, { ...init, headers });
        }, resendable(init?.body));
      },
    });
    return { sdk, client };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
