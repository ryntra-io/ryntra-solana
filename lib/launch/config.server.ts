/**
 * Where Ryntra Launch runs, and with what.
 *
 * On every deployment Launch runs on mainnet, on the configs created on
 * 2026-10-05 (Класичний and Захищений; «Спільнота» gets a config per
 * community token when one launches, so it is not offered here yet). A local
 * server can run the devnet stand instead — `RYNTRA_LAUNCH_STAND=devnet`,
 * never on production — whose presets are the devnet rehearsal's configs: the
 * same fields, with a test USDC and a test community token.
 *
 * Reading a launch — its page, its market, a creator's cabinet — needs no key
 * and no switch: people hold these tokens. Building or sending anything —
 * a launch, a trade, a claim — obeys the Launch lane's operator stop
 * (`RYNTRA_SOLANA_LAUNCH_STATE`, fail-closed), and a launch needs Ryntra's pool
 * payer too: its key comes through `RYNTRA_LAUNCH_POOL_PAYER_SECRET` (a JSON
 * array of 64 numbers, or the base58 string a wallet exports). On mainnet the
 * key must be the pool payer the attribution registry publishes, or nothing
 * launches: a pool Ryntra opens is always one a counter can attribute. The key
 * is never in the repository and never printed.
 *
 * The origin a launch's metadata, picture and share link live on is
 * configuration — `https://ryntra.io` on mainnet, the stand's own
 * `RYNTRA_LAUNCH_PUBLIC_ORIGIN` — never a request's Host or X-Forwarded-Host:
 * a mint names its metadata URI for ever, and a header must not be able to
 * point it at someone else's server.
 */

import { getBase58Encoder } from "@solana/kit";
import { Connection, Keypair } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY, SOLANA_FEE_WALLET } from "../attribution/registry.ts";
import { FEE_POLICY_V2 } from "../core/fee-policy.ts";
import type { PresetConfigs } from "../core/venues/meteora-dbc/launch.server.ts";
import type { LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { resolveSolanaLaneState } from "../solana/lane-state.ts";
import { resolveEndpoint, resolveEndpoints } from "../solana/rpc.ts";

export type LaunchCluster = "devnet" | "mainnet";

/**
 * A pair currency a preset trades against on this network. `dollar` — a
 * dollar stablecoin, so a figure in it is a figure in dollars; a community's
 * token is not, and its figures are said in the token.
 */
export type LaunchPair = Readonly<{ mint: string; symbol: string; decimals: number; usdPrice: number; dollar: boolean }>;

export type LaunchNetwork = Readonly<{
  cluster: LaunchCluster;
  /** The Wallet Standard chain a wallet signs for. */
  chain: "solana:devnet" | "solana:mainnet";
  configs: PresetConfigs;
  /** The pair of each preset with a config here: USDC, or for «Спільнота» the community's token. */
  pairs: Readonly<Partial<Record<LaunchPresetId, LaunchPair>>>;
  explorer: (kind: "tx" | "account", id: string) => string;
  /** Where the metadata, the pictures and the share links live — from configuration only. */
  origin: string;
  /**
   * The address Ryntra's referral token accounts belong to, for trades on a launch's
   * curve and pool — Launch's own fee identity, the partner's vault, so a
   * referral is counted with the rest of Launch's fees and nowhere else. A
   * trade carries the referral only where that account exists on chain.
   */
  referralOwner: string | null;
  /** Whether Jupiter routes this network, so a graduated token can also be traded there. Devnet has no Jupiter. */
  jupiter: boolean;
  /**
   * Ryntra's fee wallet on this network: a graduated launch is a new token, and a direct trade in its pool carries the
   * policy's Ryntra fee into this wallet, as a trade of it through Jupiter does. A trade's page reads the fee it finds
   * moved here as part of what the trade cost. Null: no fee wallet.
   */
  feeWallet: string | null;
  /**
   * Whether a launch's trade is recorded here the way every Ryntra fee is — its row in History and /stats, the
   * cashback and the inviter's share of the fee, its receipt. Ryntra's own fee in the pool is charged only where it
   * is: a fee is never taken that the person's rewards do not see.
   */
  tradesRecorded: boolean;
}>;

/* The devnet rehearsal of 05.10 (run 3, creator's share 40 %): its three configs and its test pair currencies. */
const DEVNET: Omit<LaunchNetwork, "origin"> = {
  cluster: "devnet",
  chain: "solana:devnet",
  configs: {
    classic: "9fRjQM1eDW6hNJRzeLoTZ1sub7tbuMcEbHEwd29UuDik",
    protected: "FWDh4JYHGBwZzDgjJP6VVt8cPkL2Xr7mKqyXEazvnYva",
    community: ["Ahh39x8jBcZxATVajcjfWUTsZBYmvwT6DwVTJLKEvr6v"],
  },
  pairs: {
    classic: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
    protected: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
    community: { mint: "8QwXVdfGjmnjZjF3TkzT4FZzA8J1gg9s8SfF9TUxFgEX", symbol: "COMM", decimals: 6, usdPrice: 0.01, dollar: false },
  },
  explorer: (kind, id) => `https://solscan.io/${kind}/${id}?cluster=devnet`,
  /* The rehearsal's partner vault on devnet — the same role the multisig's vault has on mainnet. */
  referralOwner: "xkfpaFQnfBGposA1WnsU3miQ8L5sFAXv5Mck9Cjxjju",
  jupiter: false,
  /* The rehearsal's owner on devnet stands in for Ryntra's fee wallet; on mainnet it is the attribution registry's. */
  feeWallet: "9WBQamBC9Amdzzrq8QANXweZCKpfhLMLvPQJzMBgFbbu",
  /* The stand records no launch trade: the pool's Ryntra fee is built and proven on chain, and charged where trades are recorded. */
  tradesRecorded: false,
};

const USDC: LaunchPair = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true };

const registryAddress = (id: string): string | null => ATTRIBUTION_REGISTRY.find((row) => row.id === id && row.end === null)?.address ?? null;

/*
 * Mainnet: the two configs created on 2026-10-05 (the creator's share 40 %), the attribution registry's rows —
 * the partner's vault owns Ryntra's referral accounts, Ryntra's fee wallet. A launch's trade is not yet recorded the way a
 * Ryntra fee is (History, cashback, the inviter's share), so no Ryntra fee is taken in a graduated pool: on the curve Ryntra
 * earns as the config's partner, inside the curve's own fee.
 */
const MAINNET: LaunchNetwork = {
  cluster: "mainnet",
  chain: "solana:mainnet",
  configs: {
    classic: registryAddress("solana-launch-config-classic") ?? "",
    protected: registryAddress("solana-launch-config-protected") ?? "",
  },
  pairs: { classic: USDC, protected: USDC },
  explorer: (kind, id) => `https://solscan.io/${kind}/${id}`,
  origin: "https://ryntra.io",
  referralOwner: registryAddress("solana-launch-fee-claimer"),
  jupiter: true,
  feeWallet: SOLANA_FEE_WALLET,
  tradesRecorded: false,
};

/**
 * The network Launch runs on here: the devnet stand where a local server asks
 * for it — never production, where a flag left set opens nothing and mainnet
 * runs as everywhere else — and mainnet otherwise. Null only for a stand
 * without its public origin.
 */
export function launchNetwork(env: NodeJS.ProcessEnv = process.env): LaunchNetwork | null {
  if (env.RYNTRA_LAUNCH_STAND !== "devnet" || env.VERCEL_ENV === "production") return MAINNET;
  const origin = publicOrigin(env.RYNTRA_LAUNCH_PUBLIC_ORIGIN);
  return origin ? { ...DEVNET, origin } : null;
}

/** Whether anything may be built or sent through Launch now: its lane's operator stop says `OPEN`. */
export function launchOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSolanaLaneState("LAUNCH", env) === "OPEN";
}

/**
 * Whether this deployment may make a launch on its network. A mint names its metadata at `https://ryntra.io` for ever,
 * so on mainnet only the production deployment — whose store is the one that address serves — writes a launch; a preview
 * or a local server reads launches and never makes one whose metadata would be found nowhere. The devnet stand makes
 * launches on its own origin.
 */
export function launchWritesHere(network: LaunchNetwork, env: NodeJS.ProcessEnv = process.env): boolean {
  return network.cluster !== "mainnet" || env.VERCEL_ENV === "production";
}

/** The pair a preset trades against here; a preset without a config here has none, and is refused before this is asked. */
export function launchPair(network: LaunchNetwork, preset: LaunchPresetId): LaunchPair {
  const pair = network.pairs[preset];
  if (!pair) throw new Error(`Launch has no ${preset} preset on ${network.cluster}.`);
  return pair;
}

/** An origin as configured — `scheme://host[:port]`, nothing more — or null. */
function publicOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.pathname !== "/" || url.search || url.hash || url.username) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Ryntra's pool payer here; null when there is none, and then nothing launches. On mainnet only the key of the pool payer
 * the attribution registry publishes is one: a key for another address is refused, never used.
 */
export function launchPoolPayer(env: NodeJS.ProcessEnv = process.env, network: LaunchNetwork | null = launchNetwork(env)): Keypair | null {
  if (!network) return null;
  const payer = keypairOf(env.RYNTRA_LAUNCH_POOL_PAYER_SECRET);
  if (!payer || network.cluster !== "mainnet") return payer;
  return payer.publicKey.toBase58() === registryAddress("solana-launch-pool-payer") ? payer : null;
}

/**
 * The pool payer's address a launch's receipt asks for: the registry's on mainnet, read without the key — a page shows a
 * launch whether or not this deployment can launch — and the stand's own key's on devnet.
 */
export function launchPoolPayerAddress(network: LaunchNetwork, env: NodeJS.ProcessEnv = process.env): string | null {
  if (network.cluster === "mainnet") return registryAddress("solana-launch-pool-payer");
  return launchPoolPayer(env, network)?.publicKey.toBase58() ?? null;
}

/** A secret key as configured: a JSON array of 64 bytes, or the base58 string a wallet exports. Null for anything else. */
function keypairOf(raw: string | undefined): Keypair | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const bytes = text.startsWith("[") ? (JSON.parse(text) as unknown) : Array.from(getBase58Encoder().encode(text));
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) return null;
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    return null;
  }
}

let cached: { url: string; connection: Connection } | null = null;

export function launchConnection(network: LaunchNetwork): Connection {
  const url = resolveEndpoint(network.cluster);
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, "confirmed") };
  return cached.connection;
}

/**
 * The endpoint whose signature lists reach back to a token's creation. The public operators keep a day or two of an
 * account's signatures (measured 06.10: the same wallet — 9 on one, 8 on the other, 52 back to 1 October on Solana's own
 * endpoint), so on mainnet the lists come from Solana's own public endpoint unless a provider's is configured. A list
 * is trusted as whole only when it reaches the account's first transaction, whatever endpoint gave it.
 */
export function launchHistoryEndpoint(network: LaunchNetwork): string {
  const endpoints = resolveEndpoints(network.cluster);
  const primary = endpoints[0]!;
  if (primary.fromEnv || network.cluster !== "mainnet") return primary.url;
  return "https://api.mainnet-beta.solana.com";
}

/* One per process: the history endpoint as a connection — signature lists back to a token's creation. */
const HISTORIES = new Map<string, Connection>();
export function launchHistoryConnection(network: LaunchNetwork): Connection {
  const url = launchHistoryEndpoint(network);
  const known = HISTORIES.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  HISTORIES.set(url, known);
  return known;
}

/** Asked for a transaction the main endpoint no longer keeps: the second operator still serves older ones. */
export function launchArchiveEndpoint(network: LaunchNetwork): string {
  return launchIndexedEndpoint(network);
}

/* One per process; a refusal is answered at once rather than waited out — the receipt then says it was not read. */
const ARCHIVES = new Map<string, Connection>();
export function launchArchiveConnection(network: LaunchNetwork): Connection | null {
  const url = launchArchiveEndpoint(network);
  if (url === resolveEndpoint(network.cluster)) return null;
  const known = ARCHIVES.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  ARCHIVES.set(url, known);
  return known;
}

/**
 * The endpoint for the reads a node answers from its indexes — every holder of a mint, its largest accounts, a creator's
 * curves. A configured primary (a provider's endpoint) answers them; the public primary on mainnet refuses them ("indexed
 * requests require a personal token"), so then the network's second operator, which answers a small token's holders in
 * about a second.
 */
export function launchIndexedEndpoint(network: LaunchNetwork): string {
  const endpoints = resolveEndpoints(network.cluster);
  const primary = endpoints[0]!;
  if (primary.fromEnv) return primary.url;
  return (endpoints.find((endpoint) => endpoint.role === "fallback") ?? primary).url;
}

/** The fewest lamports the pool payer keeps; below it the stand stops building launches rather than fail them. */
export const POOL_PAYER_FLOOR_LAMPORTS = 20_000_000n;

/**
 * How many launches one creator's wallet may send in a day, and how many the
 * whole network in an hour — every send counted, the ones the chain refused
 * too: a creation that fails on chain still costs the pool payer its fee, so
 * failures are bounded by the same counts.
 */
export const LAUNCHES_PER_CREATOR_PER_DAY = 3;
export const LAUNCHES_PER_HOUR = 60;

/**
 * The Ryntra fee a direct trade in a graduated launch's pool carries: after the curve the token is a new token like
 * any other, so the policy's rate for that class (MEME), into the network's fee wallet. Its class by Jupiter's
 * verification and age is read with the mainnet catalogue; a new launch is not verified yet. None without a fee wallet,
 * and none where the trade is not recorded for the person's cashback, History and receipt.
 */
export function launchPoolFee(network: LaunchNetwork): Readonly<{ wallet: string; bps: number }> | null {
  return network.feeWallet && network.tradesRecorded ? { wallet: network.feeWallet, bps: FEE_POLICY_V2.MEME.bps } : null;
}
