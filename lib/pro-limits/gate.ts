/**
 * Where «buy cheaper, sell higher» on Meteora DLMM Pro is open, and by whose switch.
 *
 * The orders stand on the engine's venue (`lib/core/venues/meteora-dlmm-pro/`), which is closed to people. This lane is
 * the one way to it, and it opens network by network:
 *
 * - `RYNTRA_PRO_LIMITS` — the server's switch: `devnet` opens the routes on devnet's test money; `mainnet` asks for
 *   mainnet, which answers only where the venue's own constant `DLMM_PRO_LIMITS_MAINNET` is true. Anything else, unset included, closes every route: they answer as if they were not there.
 * - `NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS` — the window's: the same two names show the panel in the coin's window. It
 *   opens nothing by itself: a network whose server switch is closed answers nothing to show.
 * - `RYNTRA_PRO_LIMITS_DEVNET_AGENT`, `RYNTRA_PRO_LIMITS_DEVNET_REFERRAL` — devnet's collector and referral wallets,
 *   public addresses. On mainnet both are the attribution registry's own rows and no variable names them.
 * - `RYNTRA_PRO_LIMITS_DEVNET_QUOTES` — test coins a devnet pool may be quoted in, beside wrapped SOL and Circle's
 *   devnet USDC.
 * - No ceiling on what one ladder rests: the person's own amount is
 *   the only bound; a price the agent collects still holds `minRungRaw`, below which the collector's fee eats the fill.
 *
 * Pure: the environment is an argument.
 */

import { DLMM_PRO_LIMITS_MAINNET } from "../core/venues/meteora-dlmm-pro/gate.ts";

export const PRO_LIMITS_ENV = "RYNTRA_PRO_LIMITS";
export const PRO_LIMITS_PUBLIC_ENV = "NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS";
/** Set to anything: new ladders stop at once. Cancelling, collecting and the agent's collecting stay open — the stop never holds money in. */
export const PRO_LIMITS_STOP_ENV = "RYNTRA_PRO_LIMITS_STOP";
export const PRO_LIMITS_DEVNET_AGENT_ENV = "RYNTRA_PRO_LIMITS_DEVNET_AGENT";
export const PRO_LIMITS_DEVNET_REFERRAL_ENV = "RYNTRA_PRO_LIMITS_DEVNET_REFERRAL";
export const PRO_LIMITS_DEVNET_QUOTES_ENV = "RYNTRA_PRO_LIMITS_DEVNET_QUOTES";

export const PRO_LIMITS_NETWORKS = ["devnet", "mainnet"] as const;
export type ProLimitsNetwork = (typeof PRO_LIMITS_NETWORKS)[number];
/** The Wallet Standard chain the wallet signs for, per network. */
export const PRO_LIMITS_CHAINS: Readonly<Record<ProLimitsNetwork, string>> = { devnet: "solana:devnet", mainnet: "solana:mainnet" };

export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Circle's devnet USDC (its faucet's mint). */
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/**
 * A coin a ladder is quoted in. `maxRaw` — the most one ladder may rest, counted in this coin: what a buy spends, what
 * a sell is paid once filled; null — no cap (devnet's test money). `minRungRaw` — the least one price holds where a
 * collector is named: a fill smaller than this is not worth the fee the collector pays to collect it.
 */
export type ProQuote = Readonly<{ mint: string; symbol: string; decimals: number | null; maxRaw: bigint | null; minRungRaw: bigint }>;

export const PRO_LIMITS_MIN_RUNG = Object.freeze({ sol: 2_000_000n, usdc: 500_000n });

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type Env = Readonly<Record<string, string | undefined>>;

/** A network's name as a switch spells it: `devnet`, `mainnet`, or nothing. */
export function proLimitsNetwork(value: string | undefined | null): ProLimitsNetwork | null {
  const name = value?.trim();
  return name === "devnet" || name === "mainnet" ? name : null;
}

/** An address a variable names, or null when it names none. */
export function addressOf(value: string | undefined): string | null {
  const address = value?.trim();
  return address && BASE58.test(address) ? address : null;
}

/** The coins a ladder may be quoted in on a network, with their caps. */
export function proQuotes(env: Env, network: ProLimitsNetwork): readonly ProQuote[] {
  if (network === "mainnet") {
    return [
      { mint: WRAPPED_SOL, symbol: "SOL", decimals: 9, maxRaw: null, minRungRaw: PRO_LIMITS_MIN_RUNG.sol },
      { mint: MAINNET_USDC, symbol: "USDC", decimals: 6, maxRaw: null, minRungRaw: PRO_LIMITS_MIN_RUNG.usdc },
    ];
  }
  const listed = [...new Set((env[PRO_LIMITS_DEVNET_QUOTES_ENV] ?? "").split(",").map((item) => item.trim()).filter((item) => BASE58.test(item) && item !== WRAPPED_SOL && item !== DEVNET_USDC))].slice(0, 8);
  return [
    { mint: WRAPPED_SOL, symbol: "SOL", decimals: 9, maxRaw: null, minRungRaw: PRO_LIMITS_MIN_RUNG.sol },
    { mint: DEVNET_USDC, symbol: "USDC", decimals: 6, maxRaw: null, minRungRaw: PRO_LIMITS_MIN_RUNG.usdc },
    ...listed.map((mint) => ({ mint, symbol: "USD", decimals: null, maxRaw: null, minRungRaw: 0n })),
  ];
}

export type ProLimitsGate = Readonly<{ open: true; network: ProLimitsNetwork; quotes: readonly ProQuote[] }> | Readonly<{ open: false }>;

/**
 * The server's answer to «are ladders open here»: the network and its quote coins, or closed. Mainnet is open only
 * where both the deployment's switch and the venue's constant say so.
 */
export function proLimitsGate(env: Env): ProLimitsGate {
  const network = proLimitsNetwork(env[PRO_LIMITS_ENV]);
  if (network === null) return { open: false };
  if (network === "mainnet" && !DLMM_PRO_LIMITS_MAINNET) return { open: false };
  return { open: true, network, quotes: proQuotes(env, network) };
}

/** Whether new ladders are stopped (`RYNTRA_PRO_LIMITS_STOP`). */
export const proLimitsStopped = (env: Env): boolean => Boolean(env[PRO_LIMITS_STOP_ENV]?.trim());

/** The network the window shows the panel for; null — the panel is not drawn. The window's switch opens nothing by itself. */
export function proLimitsWindow(value: string | undefined | null): ProLimitsNetwork | null {
  return proLimitsNetwork(value);
}
