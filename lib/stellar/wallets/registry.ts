import type { StellarNetwork } from "../network.ts";
import type { StellarWalletAdapter, StellarWalletCapability, StellarWalletNetwork } from "./adapter.ts";
import type { StellarWalletState } from "./states.ts";

/**
 * Which wallets exist, and whether the one connected is on the right network.
 *
 * The registry is a list rather than a single import so that adding Stellar
 * Wallets Kit, a smart-account adapter or anything else is an entry here and a
 * new file — never a change to a product surface. Today it holds one.
 */

export type WalletRegistryEntry = Readonly<{
  id: string;
  name: string;
  /** Where to get it, for the not-installed state. */
  installUrl: string;
  /** Loaded on demand so no wallet package is in a bundle until it is used. */
  load: () => Promise<StellarWalletAdapter>;
}>;

export const STELLAR_WALLETS: readonly WalletRegistryEntry[] = [
  {
    id: "freighter",
    name: "Freighter",
    installUrl: "https://www.freighter.app/",
    load: async () => (await import("./freighter.client.ts")).freighterAdapter,
  },
];

export function walletEntry(id: string): WalletRegistryEntry {
  const found = STELLAR_WALLETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown Stellar wallet: ${id}. Register it in wallets/registry.ts.`);
  return found;
}

export function supports(adapter: StellarWalletAdapter, capability: StellarWalletCapability): boolean {
  return adapter.capabilities.includes(capability);
}

/**
 * Whether the wallet is on the network an action was prepared for.
 *
 * Compares **passphrases, never names**. A network's name is a label a wallet
 * chooses; the passphrase is what a signature is computed over. A wallet on
 * mainnet will sign a transaction built for testnet without complaint, and the
 * signature will be perfectly valid — over the wrong network. That is the
 * mistake this function exists to make impossible, so it is the only comparison
 * it performs.
 */
export function networkMatches(
  wallet: StellarWalletNetwork | null,
  expected: StellarNetwork,
): boolean {
  return wallet !== null && wallet.networkPassphrase === expected.passphrase;
}

/**
 * The connection state, resolved from facts rather than tracked by hand.
 *
 * Derived instead of stored because a hand-maintained `connected` flag and a
 * wallet that changed network behind the tab's back disagree silently, and the
 * disagreement is only visible at the moment someone signs.
 */
export function resolveState(input: {
  installed: boolean;
  address: string | null;
  walletNetwork: StellarWalletNetwork | null;
  expected: StellarNetwork;
  busy?: "connecting" | "signing" | null;
}): StellarWalletState {
  if (input.busy === "connecting") return "CONNECTING";
  if (input.busy === "signing") return "SIGNING";
  if (!input.installed) return "NOT_INSTALLED";
  if (!input.address) return "AVAILABLE";
  if (!networkMatches(input.walletNetwork, input.expected)) return "WRONG_NETWORK";
  return "CONNECTED";
}
