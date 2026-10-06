/**
 * Where Ryntra Launch runs, and with what.
 *
 * Launch opens to people on mainnet with its own subtask; until then it runs
 * only on a devnet stand: `RYNTRA_LAUNCH_STAND=devnet` on a local server, never
 * on production, where every page and route of Launch answers «not found».
 *
 * On the stand the presets are the devnet rehearsal's configs — the same
 * fields as the mainnet configs, with a test USDC and a test community token
 * — and Ryntra's pool payer is a devnet key the stand hands in through
 * `RYNTRA_LAUNCH_POOL_PAYER_SECRET` (a JSON array of 64 numbers). The key is
 * never in the repository and never printed.
 *
 * The origin a launch's metadata, picture and share link live on is the
 * stand's own configuration (`RYNTRA_LAUNCH_PUBLIC_ORIGIN`), never a request's
 * Host or X-Forwarded-Host: a mint names its metadata URI for ever, and a
 * header must not be able to point it at someone else's server.
 */

import { Connection, Keypair } from "@solana/web3.js";

import { FEE_POLICY_V2 } from "../core/fee-policy.ts";
import type { PresetConfigs } from "../core/venues/meteora-dbc/launch.server.ts";
import type { LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { resolveEndpoint } from "../solana/rpc.ts";

export type LaunchCluster = "devnet";

/**
 * A pair currency a preset trades against on this network. `dollar` — a
 * dollar stablecoin, so a figure in it is a figure in dollars; a community's
 * token is not, and its figures are said in the token.
 */
export type LaunchPair = Readonly<{ mint: string; symbol: string; decimals: number; usdPrice: number; dollar: boolean }>;

export type LaunchNetwork = Readonly<{
  cluster: LaunchCluster;
  /** The Wallet Standard chain a wallet signs for. */
  chain: "solana:devnet";
  configs: PresetConfigs;
  /** The pair of each preset: USDC, or for «Спільнота» the community's token. */
  pairs: Readonly<Record<LaunchPresetId, LaunchPair>>;
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

/**
 * The network Launch runs on here, or null — Launch is closed in this
 * deployment. The devnet stand is never production: a flag left set on the
 * production deployment opens nothing. Without its public origin the stand is
 * closed too.
 */
export function launchNetwork(env: NodeJS.ProcessEnv = process.env): LaunchNetwork | null {
  if (env.RYNTRA_LAUNCH_STAND !== "devnet" || env.VERCEL_ENV === "production") return null;
  const origin = publicOrigin(env.RYNTRA_LAUNCH_PUBLIC_ORIGIN);
  return origin ? { ...DEVNET, origin } : null;
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

/** Ryntra's pool payer on the stand; null when the stand has none, and then nothing launches. */
export function launchPoolPayer(env: NodeJS.ProcessEnv = process.env): Keypair | null {
  const raw = env.RYNTRA_LAUNCH_POOL_PAYER_SECRET;
  if (!raw) return null;
  try {
    const bytes = JSON.parse(raw) as unknown;
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
