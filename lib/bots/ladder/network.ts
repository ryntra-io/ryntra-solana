/**
 * Where the ladder composer may put a signed transaction: devnet, and only
 * when the deployment says so. This is the first bot that moves funds, so it
 * goes by the release protocol (spec §18.3, decision 92): devnet → a release
 * with a point to roll back to → the operator tries it himself. Mainnet is not a
 * value this switch takes — opening it is a change of code,
 * never an environment variable.
 *
 * - `RYNTRA_BOTS_LADDER` — the server's switch: `devnet` opens the routes; anything else, unset included, closes them.
 * - `NEXT_PUBLIC_RYNTRA_CITY_LADDER` — the window's: `devnet` shows the «Place on devnet» action; else practice only.
 * - `RYNTRA_BOTS_LADDER_DEVNET_POOLS` — the devnet DLMM pools a ladder may sit in, comma-separated public addresses.
 * - `RYNTRA_BOTS_LADDER_DEVNET_QUOTES` — dollar test tokens a devnet pool may quote in, beside Circle's devnet USDC.
 *
 * Pure: the environment is an argument.
 */

export const LADDER_ENV = "RYNTRA_BOTS_LADDER";
export const LADDER_PUBLIC_ENV = "NEXT_PUBLIC_RYNTRA_CITY_LADDER";
export const LADDER_POOLS_ENV = "RYNTRA_BOTS_LADDER_DEVNET_POOLS";
export const LADDER_QUOTES_ENV = "RYNTRA_BOTS_LADDER_DEVNET_QUOTES";

export type LadderNetwork = "devnet";
/** The Wallet Standard chain the wallet signs for. */
export const LADDER_CHAIN = "solana:devnet";
/** Circle's devnet USDC (its faucet's mint). */
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_LISTED = 8;

type Env = Readonly<Record<string, string | undefined>>;

/** The network a switch's value opens: `devnet`, or nothing. */
export function ladderNetwork(value: string | undefined): LadderNetwork | null {
  return value?.trim() === "devnet" ? "devnet" : null;
}

function addresses(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => BASE58.test(item)))].slice(0, MAX_LISTED);
}

/** The devnet pools a ladder may sit in; none while the switch is closed. */
export function ladderPools(env: Env): string[] {
  return ladderNetwork(env[LADDER_ENV]) ? addresses(env[LADDER_POOLS_ENV]) : [];
}

/** The dollar tokens a devnet ladder may be quoted in. */
export function ladderQuotes(env: Env): string[] {
  return [...new Set([DEVNET_USDC, ...addresses(env[LADDER_QUOTES_ENV])])];
}

/** The server's answer to «is the composer open»: the network and its pools, or closed. */
export function ladderGate(env: Env): Readonly<{ open: true; network: LadderNetwork; pools: readonly string[]; quotes: readonly string[] }> | Readonly<{ open: false }> {
  const network = ladderNetwork(env[LADDER_ENV]);
  if (!network) return { open: false };
  return { open: true, network, pools: ladderPools(env), quotes: ladderQuotes(env) };
}
