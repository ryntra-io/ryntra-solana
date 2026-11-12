/**
 * Where the ladder composer may put a signed transaction, and by whose switch.
 * This is the first bot that moves funds, so it goes by the release protocol
 * (spec §18.3, decision 92): devnet → a release with a point to roll back to →
 * the operator tries it himself.
 *
 * Each network opens by its own switch and only by it; neither inherits the
 * other's:
 *
 * - `RYNTRA_BOTS_LADDER` — devnet's server switch: `devnet` opens devnet's routes; anything else, unset included, closes them.
 *   `mainnet` is not a value it takes.
 * - `RYNTRA_BOTS_LADDER_MAINNET` — mainnet's server switch: `OPEN` opens mainnet's routes; `CLOSING` keeps only taking
 *   back — reading the orders, building and relaying their cancellations — so a person keeps the way to what is theirs
 *   after placing is closed (the rollback); anything else, unset included, closes them all.
 * - `RYNTRA_BOTS_LADDER_MAINNET_MAX_USD` — the most one mainnet ladder may place, dollars: the start is
 *   `LADDER_START_MAX_USD`; the variable may set it from 1 up to `LADDER_MAX_USD_CEILING`, never above.
 * - `NEXT_PUBLIC_RYNTRA_CITY_LADDER` — the window's: `devnet` or `mainnet` shows that network's «Place»; else practice
 *   only. The window's value opens nothing by itself: a network whose server switch is closed answers 404.
 * - `RYNTRA_BOTS_LADDER_DEVNET_POOLS` — the devnet DLMM pools a ladder may sit in, comma-separated public addresses.
 * - `RYNTRA_BOTS_LADDER_DEVNET_QUOTES` — dollar test tokens a devnet pool may quote in, beside Circle's devnet USDC.
 *
 * On mainnet the pool is not listed: it is the deepest USDC pool of the coin that takes limit orders, as the limits
 * lane finds it (`findDlmmLimitPool`), read on chain before every build and relay.
 *
 * Pure: the environment is an argument.
 */

export const LADDER_ENV = "RYNTRA_BOTS_LADDER";
export const LADDER_MAINNET_ENV = "RYNTRA_BOTS_LADDER_MAINNET";
export const LADDER_MAINNET_MAX_USD_ENV = "RYNTRA_BOTS_LADDER_MAINNET_MAX_USD";
export const LADDER_PUBLIC_ENV = "NEXT_PUBLIC_RYNTRA_CITY_LADDER";
export const LADDER_POOLS_ENV = "RYNTRA_BOTS_LADDER_DEVNET_POOLS";
export const LADDER_QUOTES_ENV = "RYNTRA_BOTS_LADDER_DEVNET_QUOTES";

export const LADDER_NETWORKS = ["devnet", "mainnet"] as const;
export type LadderNetwork = (typeof LADDER_NETWORKS)[number];

/** The Wallet Standard chain the wallet signs for, per network. */
export const LADDER_CHAINS: Readonly<Record<LadderNetwork, string>> = { devnet: "solana:devnet", mainnet: "solana:mainnet" };
/** Circle's devnet USDC (its faucet's mint). */
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Circle's USDC on mainnet: the one dollar a mainnet ladder is quoted in. */
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** The start: what one mainnet ladder may place, dollars, until the operator raises it. */
export const LADDER_START_MAX_USD = 100;
/** The most the variable may raise it to; above this is a change of code. */
export const LADDER_MAX_USD_CEILING = 1_000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_LISTED = 8;

type Env = Readonly<Record<string, string | undefined>>;

/** A network's name as the window's switch and a request spell it: `devnet`, `mainnet`, or nothing. */
export function ladderNetwork(value: string | undefined | null): LadderNetwork | null {
  const name = value?.trim();
  return name === "devnet" || name === "mainnet" ? name : null;
}

/** Whether a network's own server switch is open for placing. */
export function networkOpen(env: Env, network: LadderNetwork): boolean {
  if (network === "devnet") return env[LADDER_ENV]?.trim() === "devnet";
  return env[LADDER_MAINNET_ENV]?.trim().toUpperCase() === "OPEN";
}

/** Whether taking back is open on a network: wherever placing is, and on mainnet also while it is `CLOSING`. */
export function takeBackOpen(env: Env, network: LadderNetwork): boolean {
  if (networkOpen(env, network)) return true;
  return network === "mainnet" && env[LADDER_MAINNET_ENV]?.trim().toUpperCase() === "CLOSING";
}

function addresses(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => BASE58.test(item)))].slice(0, MAX_LISTED);
}

/** The devnet pools a ladder may sit in; none while devnet's switch is closed. */
export function ladderPools(env: Env): string[] {
  return networkOpen(env, "devnet") ? addresses(env[LADDER_POOLS_ENV]) : [];
}

/** The dollar tokens a ladder may be quoted in on a network. */
export function ladderQuotes(env: Env, network: LadderNetwork = "devnet"): string[] {
  if (network === "mainnet") return [MAINNET_USDC];
  return [...new Set([DEVNET_USDC, ...addresses(env[LADDER_QUOTES_ENV])])];
}

/** The most one mainnet ladder may place, dollars: the start, or the variable's value up to the ceiling. */
export function ladderMaxUsd(env: Env): number {
  const raw = env[LADDER_MAINNET_MAX_USD_ENV]?.trim();
  const value = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= 1)) return LADDER_START_MAX_USD;
  return Math.min(value, LADDER_MAX_USD_CEILING);
}

export type LadderGate =
  | Readonly<{
      open: true;
      network: LadderNetwork;
      /** Devnet's listed pools; null on mainnet, where the pool is found by depth and read on chain. */
      pools: readonly string[] | null;
      quotes: readonly string[];
      /** The most one ladder may place, dollars; null — no cap (devnet's test money). */
      maxUsd: number | null;
    }>
  | Readonly<{ open: false }>;

/**
 * The server's answer to «is the composer open on this network»: its pools, quotes and cap, or closed. `takeBack` asks
 * for the taking-back routes only (orders, cancel, a cancellation's relay), which a `CLOSING` mainnet still serves.
 */
export function ladderGate(env: Env, network: LadderNetwork = "devnet", options: Readonly<{ takeBack?: boolean }> = {}): LadderGate {
  if (!(options.takeBack ? takeBackOpen(env, network) : networkOpen(env, network))) return { open: false };
  if (network === "mainnet") return { open: true, network, pools: null, quotes: ladderQuotes(env, network), maxUsd: ladderMaxUsd(env) };
  return { open: true, network, pools: ladderPools(env), quotes: ladderQuotes(env, network), maxUsd: null };
}
