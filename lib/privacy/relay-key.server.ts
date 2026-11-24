/**
 * The relay's Helius key for each network — the variables' names only. A value is read on the server at the moment of
 * each call and never leaves it: no log, no answer, no page, no build.
 *
 * - devnet — `HELIUS_DEVNET_API_KEY`, the key the relay has used since 21.11;
 * - mainnet — `HELIUS_PRIVACY_MAINNET_API_KEY`, a key of its own: not the site's mainnet RPC key, so the private balance's
 *   reads and proofs are counted, limited and revoked apart from every other page.
 *
 * The private balance's routes are open on a network only when the build's flag names it and, for mainnet, this
 * server holds its key now (`openNetwork`). Without the key `mainnet` is shut — as it was before this file.
 */

import { privateNetwork, type PrivateNetwork } from './network.ts';

export const RELAY_KEY_ENV: Readonly<Record<PrivateNetwork, string>> = Object.freeze({
  devnet: 'HELIUS_DEVNET_API_KEY',
  mainnet: 'HELIUS_PRIVACY_MAINNET_API_KEY',
});

export type ServerEnv = Readonly<Record<string, string | undefined>>;

/** A network's key on this server, trimmed; '' when it is not set. */
export function relayKey(network: PrivateNetwork, env: ServerEnv = process.env): string {
  return env[RELAY_KEY_ENV[network]]?.trim() ?? '';
}

/** The network the private balance's routes serve now: the build's flag, and — for mainnet — its key on this server. */
export function openNetwork(env: ServerEnv = process.env, flag: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_PRIVATE): PrivateNetwork | null {
  return privateNetwork(flag, relayKey('mainnet', env) !== '');
}

/**
 * The network and key a relay path is served with, or null — 404: the flag is shut, the path names another network
 * than the flag's, or the network's key is not on this server.
 */
export function servedNetwork(requested: string, env: ServerEnv = process.env, flag: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_PRIVATE): Readonly<{ network: PrivateNetwork; key: string }> | null {
  const network = openNetwork(env, flag);
  if (!network || network !== requested) return null;
  const key = relayKey(network, env);
  return key ? { network, key } : null;
}
