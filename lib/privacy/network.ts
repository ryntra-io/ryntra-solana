/**
 * One flag, `NEXT_PUBLIC_RYNTRA_PRIVATE`, read at build time like the terminal's own: `devnet` opens the private
 * balance, the wallet check and the claim page on Solana devnet; any other value — and no value — keeps them shut, and
 * the Portfolio shows its «Soon» block as before.
 *
 * The browser never talks to Helius itself. The SDK's every HTTP call goes to Ryntra's relay under
 * `/api/v1/privacy/devnet/**`, which adds the Helius key server-side (`?api-key=`, the only form the prover accepts)
 * and forwards the bytes. The prover's requests are encrypted to the attested enclave, so the relay sees ciphertext.
 * The person's keys never reach Ryntra's server: the viewing key stays in their browser; the nullifier secret leaves it
 * only inside a proof request, encrypted to Helius's attested enclave, as the ring's proofs require.
 */

export type PrivateNetwork = 'devnet';

/** The network the private balance runs on, or null while it is shut. */
export function privateNetwork(value: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_PRIVATE): PrivateNetwork | null {
  return value === 'devnet' ? 'devnet' : null;
}

/** The wallet chain every private transaction is signed for. */
export const PRIVATE_CHAIN = 'solana:devnet';

/** The SDK bundle (`scripts/privacy/vendor-sdk.mjs`); fetched only by a page where the private balance is open. */
export const PRIVATE_SDK_URL = '/privacy/spr-0.9.0-alpha.mjs';

/** The bundle's sha256, file as committed; the line's test recomputes it, `vendor-sdk.mjs` prints it when it builds. */
export const PRIVATE_SDK_SHA256 = '828cca05bde086460a6222fb7d65dede4abe8a17fb9fe8c155b648b61121e737';

/** Ryntra's relay to Helius devnet: Solana RPC, and the ring's indexer and prover. */
export const PRIVATE_RELAY = Object.freeze({
  rpc: '/api/v1/privacy/devnet/rpc',
  spr: '/api/v1/privacy/devnet/spr',
  policy: '/api/v1/privacy/devnet/policy',
});

/** Where an explorer shows a devnet signature or address. */
export function explorerUrl(kind: 'tx' | 'address', value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

/**
 * - the starting cap of a person's private balance — null: no cap is set, and on devnet none is needed;
 * - Ryntra's fee on a private transfer, as a second recipient inside it — null: no fee output is added;
 * - which wallets may derive the private keys from one signed message — empty until the owner's wallet check
 *   (`/private/check`) shows a wallet returns the same signature twice, byte for byte. Until then every wallet takes the
 *   fallback: its own keys, made and encrypted in the person's browser.
 */
export const PRIVATE_BALANCE_CAP_USD: number | null = null;
export const PRIVATE_FEE_BPS: number | null = null;
export const DERIVE_FROM_WALLET: readonly string[] = [];

/** SOL a link carries for its own network fees, so whoever opens it needs no SOL: rent of its record and a few fees. */
export const LINK_FEE_LAMPORTS = 5_000_000n;

/**
 * The least a link may carry: taken to a fresh wallet, the amount itself must cover that wallet's rent-exempt minimum
 * (≈ 0.00089 SOL), or the withdrawal fails.
 */
export const LINK_MIN_LAMPORTS = 1_000_000n;

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** How the ring names SOL in a balance: the system program's address (the SDK's `SOL_MINT`), not wrapped SOL. */
export const RING_SOL = '11111111111111111111111111111111';
