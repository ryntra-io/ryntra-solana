/**
 * The two Stellar networks Ryntra reads.
 *
 * One module, because a network is a set of facts that must travel together: a
 * passphrase from one network and an endpoint from another is a silent
 * cross-network read, and the value it returns looks perfectly valid. Every
 * read in this adapter takes a `StellarNetwork` rather than a URL, so that
 * mistake has nowhere to happen.
 *
 * Endpoints and passphrases verified live on 2026-08-13:
 * `getNetwork` returned protocol 27 with `Test SDF Network ; September 2015`
 * on testnet and `Public Global Stellar Network ; September 2015` on mainnet.
 */

export type StellarNetworkId = "stellar:testnet" | "stellar:mainnet";

export type StellarNetwork = Readonly<{
  /** Stable identifier used in every source reference and receipt. */
  id: StellarNetworkId;
  label: string;
  /** The consensus-level identity of the network. Never derived from a URL. */
  passphrase: string;
  /** Live state, simulation and submission. The recommended API. */
  rpcUrl: string;
  /**
   * Curated classic data as JSON.
   *
   * Horizon is nearing end-of-life in favour of Stellar RPC and SDF's own
   * Portfolio APIs, and canon §12 permits it while forbidding it as a
   * long-term sole dependency. It is here because the reads this adapter needs
   * — issuer flags, trustlines, asset statistics — are JSON on Horizon and XDR
   * everywhere else, and XDR is what would force an SDK. Every read records
   * which source answered, so replacing this is a source change.
   */
  horizonUrl: string;
  explorerBase: string;
  /** Testnet is reset periodically; nothing may depend on its state persisting. */
  ephemeral: boolean;
}>;

export const STELLAR_TESTNET: StellarNetwork = {
  id: "stellar:testnet",
  label: "Stellar Testnet",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  explorerBase: "https://stellar.expert/explorer/testnet",
  ephemeral: true,
};

export const STELLAR_MAINNET: StellarNetwork = {
  id: "stellar:mainnet",
  label: "Stellar Mainnet",
  passphrase: "Public Global Stellar Network ; September 2015",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
  explorerBase: "https://stellar.expert/explorer/public",
  ephemeral: false,
};

export const STELLAR_NETWORKS: readonly StellarNetwork[] = [STELLAR_TESTNET, STELLAR_MAINNET];

export function stellarNetwork(id: StellarNetworkId): StellarNetwork {
  const found = STELLAR_NETWORKS.find((network) => network.id === id);
  /* A throw rather than a default. Falling back to one network when the caller
     asked for another is the exact failure this module exists to prevent. */
  if (!found) throw new Error(`Unknown Stellar network: ${id}`);
  return found;
}

/** The source reference recorded on every read, in the shape a receipt stores. */
export function stellarSourceRef(network: StellarNetwork, kind: "rpc" | "horizon", path: string): string {
  return `${network.id}:${kind}:${path}`;
}

export function accountExplorerUrl(network: StellarNetwork, account: string): string {
  return `${network.explorerBase}/account/${account}`;
}

export function assetExplorerUrl(network: StellarNetwork, code: string, issuer: string): string {
  return `${network.explorerBase}/asset/${code}-${issuer}`;
}

/** Where anyone else can look the same transaction up, without Ryntra. */
export function transactionExplorerUrl(network: StellarNetwork, transactionHash: string): string {
  return `${network.explorerBase}/tx/${transactionHash}`;
}
