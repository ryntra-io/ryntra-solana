/**
 * The coins a DLMM Pro pier is made of.
 *
 * A **pier** is a pool of SOL against a coin a person already knows from Earn: USDC, or a staked SOL of the SOL Saver
 * (JupSOL, INF, JitoSOL). The pools themselves are read from the chain — DLMM Pro has no Data API — and a pool of any
 * other pair is simply not a pier: its coins were not checked by anyone, and Earn says its results in SOL.
 *
 * On devnet the stand names its own test coin beside devnet's SOL (`RYNTRA_EARN_PRO_DEVNET_COIN=<mint>:<symbol>`).
 *
 * Where a deployment opens any pool (`RYNTRA_EARN_PRO_ANY_POOL=open`, `./gate.ts`), a pool of SOL against
 * any other coin is a pier as well — a position of the person's own, which no agent looks after (`coinKindOf` is null
 * for that coin, and a care is refused).
 *
 * Pure: no I/O.
 */

import type { EarnProNetwork } from "./gate.ts";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * `other` — a coin nobody checked, in a pool of SOL a deployment opened to any coin (`RYNTRA_EARN_PRO_ANY_POOL`):
 * named from the catalogue, never looked after by an agent.
 */
export type EarnProCoin = Readonly<{ mint: string; symbol: string; kind: "sol" | "dollar" | "staked-sol" | "test" | "other" }>;

const MAINNET: readonly EarnProCoin[] = [
  { mint: SOL_MINT, symbol: "SOL", kind: "sol" },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", kind: "dollar" },
  { mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", symbol: "JupSOL", kind: "staked-sol" },
  { mint: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", symbol: "INF", kind: "staked-sol" },
  { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", kind: "staked-sol" },
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^[A-Za-z0-9]{1,10}$/;

/** The coins of a network. On devnet: SOL, Circle's devnet USDC, and the one test coin the stand names. */
export function earnProCoins(network: EarnProNetwork, env: Readonly<Record<string, string | undefined>> = {}): readonly EarnProCoin[] {
  if (network === "mainnet") return MAINNET;
  const coins: EarnProCoin[] = [
    { mint: SOL_MINT, symbol: "SOL", kind: "sol" },
    { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", symbol: "USDC", kind: "dollar" },
  ];
  const [mint, symbol] = (env.RYNTRA_EARN_PRO_DEVNET_COIN ?? "").trim().split(":");
  if (mint && symbol && BASE58.test(mint) && SYMBOL.test(symbol) && !coins.some((coin) => coin.mint === mint)) coins.push({ mint, symbol, kind: "test" });
  return coins;
}

/** The kind of a coin of the network's: SOL, dollars, a staked SOL, the stand's test coin — or null for a coin Earn does not know. */
export function coinKindOf(network: EarnProNetwork, mint: string, env: Readonly<Record<string, string | undefined>> = {}): EarnProCoin["kind"] | null {
  return earnProCoins(network, env).find((coin) => coin.mint === mint)?.kind ?? null;
}

/** A coin's short name where no catalogue names it: the start of its address. */
export const shortMint = (mint: string): string => `${mint.slice(0, 4)}…`;

/**
 * The pair of a pool as a pier's: SOL and one known coin — or null for any other pool. `nameOf` — where a deployment
 * opened any pool of SOL: SOL against any other coin is a pier too, that coin `other`, named by `nameOf`. A
 * pool without SOL on a side is never one: an opening is paid in SOL alone.
 */
export function pierPairOf(coins: readonly EarnProCoin[], mintX: string, mintY: string, nameOf: ((mint: string) => string) | null = null): Readonly<{ x: EarnProCoin; y: EarnProCoin; solIsX: boolean }> | null {
  if (mintX === mintY) return null;
  const own = (mint: string): EarnProCoin | undefined => coins.find((coin) => coin.mint === mint) ?? (nameOf && mint !== SOL_MINT ? { mint, symbol: nameOf(mint), kind: "other" } : undefined);
  const x = own(mintX);
  const y = own(mintY);
  if (!x || !y) return null;
  if (x.kind === "sol") return { x, y, solIsX: true };
  if (y.kind === "sol") return { x, y, solIsX: false };
  return null;
}
