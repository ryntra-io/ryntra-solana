/**
 * How Relay names the chains this product already names.
 *
 * Relay identifies every chain by a number, including Solana, which it gives
 * the synthetic id 792703809 because Solana has no EIP-155 chain id. That
 * number is not derivable from anything: it was read from
 * `https://api.relay.link/chains` on 2026-09-09, along with the fact that
 * Robinhood Chain is 4663 with `depositEnabled: true`, its native currency is
 * ETH, and its only ERC-20 solver currency is USDG at six decimals.
 *
 * This module is the one place that translation lives, and it is deliberately
 * total in one direction only: every `SwapNetwork` has a Relay id, but a Relay
 * id is turned back into a network by lookup, so a chain Relay adds tomorrow
 * cannot appear in this product by accident.
 *
 * Nothing here is a statement that a lane is open to a person. That is
 * `lane-state.ts`; this file only records what the provider calls things.
 */

import type { SwapNetwork } from "../swap/catalog.ts";

export const RELAY_API_ORIGIN = "https://api.relay.link";

/** Robinhood Chain's EVM id, as its own documentation and Relay both state it. */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * Relay's id for Solana. Not an EIP-155 chain id and not a Wormhole id — a
 * number Relay assigns; read from its chain list, never computed.
 */
export const RELAY_SOLANA_CHAIN_ID = 792703809;

export const RELAY_CHAIN_IDS: Readonly<Record<SwapNetwork, number>> = {
  solana: RELAY_SOLANA_CHAIN_ID,
  base: 8453,
  ethereum: 1,
  arbitrum: 42_161,
  optimism: 10,
  polygon: 137,
  bnb: 56,
  robinhood: ROBINHOOD_CHAIN_ID,
};

/**
 * How Relay names an asset: the contract on an EVM chain, the mint on Solana,
 * and a zero address for the chain's own coin — except on Solana, where the
 * native coin is the System Program id rather than a run of zeroes. Both were
 * read off accepted quotes; guessing either produces a 400 with a validation
 * message that names the field and not the reason.
 */
export const RELAY_EVM_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
export const RELAY_SOLANA_NATIVE_ADDRESS = "11111111111111111111111111111111";

export function relayNativeAddress(network: SwapNetwork): string {
  return network === "solana" ? RELAY_SOLANA_NATIVE_ADDRESS : RELAY_EVM_NATIVE_ADDRESS;
}

/** The network behind a Relay chain id, or null for one this product does not serve. */
export function swapNetworkOfRelayChain(chainId: number): SwapNetwork | null {
  for (const [network, id] of Object.entries(RELAY_CHAIN_IDS) as readonly (readonly [SwapNetwork, number])[]) {
    if (id === chainId) return network;
  }
  return null;
}

/**
 * What a wallet must be told to add Robinhood Chain, because no wallet ships
 * with it configured.
 *
 * The RPC is Robinhood's own public endpoint, which its documentation marks
 * rate-limited and not for production — correct for a one-off
 * `wallet_addEthereumChain`, where it is only ever used by the person's own
 * wallet and never by this server.
 */
export const ROBINHOOD_CHAIN_WALLET_PARAMS = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
} as const;

export function robinhoodExplorerTxUrl(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

/** Where a person opens a Relay order to read it at the provider itself. */
export function relayRequestUrl(requestId: string): string {
  return `https://relay.link/transaction/${requestId}`;
}
