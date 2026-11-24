/**
 * One flag, `NEXT_PUBLIC_RYNTRA_PRIVATE`, read at build time like the terminal's own:
 * - `devnet` opens the private balance, the wallet check and the claim page on Solana devnet, as since 21.11;
 * - `mainnet` opens them on Solana mainnet — only when the build also saw the mainnet relay's Helius key
 *   (`RYNTRA_PRIVATE_MAINNET_KEY_SEEN`, set by `next.config.ts` from the key's presence, never its value). Without the key
 *   `mainnet` reads as no value at all;
 * - any other value, and no value, keeps them shut, and the Portfolio shows its «Soon» block as before.
 * Setting `mainnet` and the key is that word.
 *
 * The browser never talks to Helius itself. The SDK's every HTTP call goes to Ryntra's relay under
 * `/api/v1/privacy/<network>/**`, which adds the network's Helius key server-side (`?api-key=`, the only form the prover
 * accepts) and forwards the bytes. The prover's requests are encrypted to the attested enclave, so the relay sees
 * ciphertext. The person's keys never reach Ryntra's server: the viewing key stays in their browser; the nullifier secret
 * leaves it only inside a proof request, encrypted to Helius's attested enclave, as the ring's proofs require.
 */

export type PrivateNetwork = 'devnet' | 'mainnet';

export const PRIVATE_NETWORKS: readonly PrivateNetwork[] = Object.freeze(['devnet', 'mainnet']);

/** Whether the build saw the mainnet relay's key — its presence only (`next.config.ts`); on the server the relay reads the key itself. */
const MAINNET_KEY_SEEN = process.env.RYNTRA_PRIVATE_MAINNET_KEY_SEEN === '1';

/**
 * The network the private balance runs on, or null while it is shut. `mainnet` opens only with its key; on the server
 * the relay (`relay-key.server.ts`) checks the key again at the moment of each call.
 */
export function privateNetwork(value: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_PRIVATE, mainnetKey: boolean = MAINNET_KEY_SEEN): PrivateNetwork | null {
  if (value === 'devnet') return 'devnet';
  return value === 'mainnet' && mainnetKey ? 'mainnet' : null;
}

/**
 * The network every private store, signature and relay call of this build is named for. While the private balance is
 * shut nothing runs; the name stays `devnet`, so a store's name never changes under a person.
 */
export const PRIVATE_NET: PrivateNetwork = privateNetwork() ?? 'devnet';

/** Whether the private balance runs on the test network — the «Test network» mark and «test money» lines show only then. */
export const PRIVATE_TEST = PRIVATE_NET === 'devnet';

const CHAINS: Readonly<Record<PrivateNetwork, string>> = Object.freeze({ devnet: 'solana:devnet', mainnet: 'solana:mainnet' });

/** The wallet chain a network's private transactions are signed for. */
export function chainOf(network: PrivateNetwork): string {
  return CHAINS[network];
}

/** The wallet chain every private transaction of this build is signed for. */
export const PRIVATE_CHAIN = chainOf(PRIVATE_NET);

/** The SDK bundle (`scripts/privacy/vendor-sdk.mjs`); fetched only by a page where the private balance is open. */
export const PRIVATE_SDK_URL = '/privacy/spr-0.9.0-alpha.mjs';

/** The bundle's sha256, file as committed; the line's test recomputes it, `vendor-sdk.mjs` prints it when it builds. */
export const PRIVATE_SDK_SHA256 = '828cca05bde086460a6222fb7d65dede4abe8a17fb9fe8c155b648b61121e737';

/** Ryntra's relay to a network's Helius: Solana RPC, the ring's indexer and prover, and the page's relay session. */
export function relayOf(network: PrivateNetwork): Readonly<{ rpc: string; spr: string; policy: string; session: string }> {
  return Object.freeze({
    rpc: `/api/v1/privacy/${network}/rpc`,
    spr: `/api/v1/privacy/${network}/spr`,
    policy: `/api/v1/privacy/${network}/policy`,
    session: `/api/v1/privacy/${network}/session`,
  });
}

/** This build's relay. */
export const PRIVATE_RELAY = relayOf(PRIVATE_NET);

/** Where an explorer shows a signature or address of the private balance's network. */
export function explorerUrl(kind: 'tx' | 'address', value: string, network: PrivateNetwork = PRIVATE_NET): string {
  return `https://explorer.solana.com/${kind}/${value}${network === 'devnet' ? '?cluster=devnet' : ''}`;
}

/**
 * - the starting cap of a person's private balance — null in code; the gate reads `RYNTRA_PRIVATE_CAP_USD`
 *   (`gate/settings.ts`), and on mainnet no cap holds deposits back rather than letting them run without one;
 * - Ryntra's fee on a private payout — not in code: a server setting, `RYNTRA_PRIVATE_PAYOUT_FEE_BPS` with its address
 *   (`payouts/fee.ts`, read by the «Money» page on the server); unset — no fee output is added;
 * - which wallets are named to a person as ones that give the private balance's keys — empty until the owner's wallet
 *   check (`/private/check`) shows a wallet returns the same signature twice, byte for byte. Keys come from the wallet
 *   only: every wallet is checked again when it turns the balance on (`usePrivate.ts`), listed or not.
 */
export const PRIVATE_BALANCE_CAP_USD: number | null = null;
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
