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

import type { PresetConfigs } from "../core/venues/meteora-dbc/launch.server.ts";
import type { LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { resolveEndpoint } from "../solana/rpc.ts";

export type LaunchCluster = "devnet";

/** A pair currency a preset trades against on this network. */
export type LaunchPair = Readonly<{ mint: string; symbol: string; decimals: number; usdPrice: number }>;

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
    classic: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1 },
    protected: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1 },
    community: { mint: "8QwXVdfGjmnjZjF3TkzT4FZzA8J1gg9s8SfF9TUxFgEX", symbol: "COMM", decimals: 6, usdPrice: 0.01 },
  },
  explorer: (kind, id) => `https://solscan.io/${kind}/${id}?cluster=devnet`,
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
