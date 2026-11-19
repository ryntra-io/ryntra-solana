/**
 * Loads the Privacy Rings SDK bundle once per page (`public/privacy/`, built by `scripts/privacy/vendor-sdk.mjs`) and
 * makes one client that reaches Helius devnet only through Ryntra's relay. Nothing loads until a screen with the private
 * balance open asks for it.
 */

import { PRIVATE_RELAY, PRIVATE_SDK_URL, privateNetwork } from './network.ts';
import { POLICY_URL } from './relay.ts';
import type { Ctx, Spr } from './flows.ts';

let ready: Promise<Ctx> | null = null;

export function loadPrivate(): Promise<Ctx> {
  if (!privateNetwork()) return Promise.reject(new Error('private balance is shut'));
  ready ??= (async () => {
    const sdk: Spr = await import(/* webpackIgnore: true */ PRIVATE_SDK_URL);
    await sdk.initializePoseidon();
    const origin = window.location.origin;
    const client = await sdk.createSprClient({
      solanaRpcUrl: `${origin}${PRIVATE_RELAY.rpc}`,
      // Subscriptions are not used: the SDK confirms by polling the relay.
      solanaRpcSubscriptionsUrl: 'wss://api.devnet.solana.com',
      indexerUrl: `${origin}${PRIVATE_RELAY.spr}`,
      proverUrl: `${origin}${PRIVATE_RELAY.spr}`,
      proverTee: sdk.SignedTeePolicy.forNetwork('devnet'),
      // Every call stays on this site: the prover's signed policy too comes through the relay.
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return fetch(url === POLICY_URL ? `${origin}${PRIVATE_RELAY.policy}` : input, init);
      },
    });
    return { sdk, client };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
