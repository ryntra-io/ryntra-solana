/**
 * Who may act on a pool today. Reading is open to everyone; adding, withdrawing
 * and claiming go through three states set at runtime:
 *
 * - `CLOSED` (the default, and what any other value reads as): no screen offers
 *   an action and no route builds one;
 * - `CANARY`: one wallet — the operator's, named in the environment and
 *   compared character for character — may act, and an add may put in at most
 *   `CANARY_MAX_DEPOSIT_USD`. The first live check on mainnet is made this way,
 *   with the smallest amount, before anyone else is offered the actions;
 * - `OPEN`: everyone, to any amount.
 *
 * The wallet is runtime input on purpose, never a constant here: an address in
 * a repository is a fact about a person that outlives the reason it was needed.
 * `CANARY` with no wallet configured admits nobody.
 *
 * Pure: the environment is passed in.
 */

import type { CapabilityState } from "@ryntra/core/adapters";

import { ACTIONS_UNTIL, type LiquidityAction } from "./contract.ts";

export const LIQUIDITY_ACTIONS_ENV = "RYNTRA_LIQUIDITY_ACTIONS";
export const LIQUIDITY_CANARY_WALLET_ENV = "RYNTRA_LIQUIDITY_CANARY_WALLET";

/** The most a canary add may put in, in dollars at the venue's token prices. Withdrawing and claiming are bounded by what went in. */
export const CANARY_MAX_DEPOSIT_USD = 5;

export const LIQUIDITY_GATE_MODES = ["CLOSED", "CANARY", "OPEN"] as const;
export type LiquidityGateMode = (typeof LIQUIDITY_GATE_MODES)[number];

export type Env = Readonly<Record<string, string | undefined>>;

export function liquidityGateMode(env: Env): LiquidityGateMode {
  const value = env[LIQUIDITY_ACTIONS_ENV]?.trim().toUpperCase();
  return value === "OPEN" || value === "CANARY" ? value : "CLOSED";
}

/** The actions that change a position — the ones the gate decides. */
export type GatedAction = Exclude<LiquidityAction, "pools" | "positions">;
export const GATED_ACTIONS: readonly GatedAction[] = ["add", "remove", "claim"];

export type GateAdmission =
  | Readonly<{ ok: true; mode: Exclude<LiquidityGateMode, "CLOSED">; maxDepositUsd: number | null }>
  | Readonly<{ ok: false; code: "ACTIONS_CLOSED" }>;

/** Whether this wallet may act now. In `CANARY` a stranger is told the same as under `CLOSED` — the canary is not announced. */
export function admitLiquidityAction(owner: string | null, env: Env): GateAdmission {
  const mode = liquidityGateMode(env);
  if (mode === "OPEN") return { ok: true, mode, maxDepositUsd: null };
  if (mode === "CANARY") {
    const wallet = env[LIQUIDITY_CANARY_WALLET_ENV]?.trim();
    if (wallet && owner !== null && owner === wallet) return { ok: true, mode, maxDepositUsd: CANARY_MAX_DEPOSIT_USD };
  }
  return { ok: false, code: "ACTIONS_CLOSED" };
}

/** The three gated actions as the core's capability states, for one wallet (or none). */
export function liquidityActionStates(owner: string | null, env: Env): Readonly<Record<GatedAction, CapabilityState>> & Readonly<{ maxDepositUsd: number | null }> {
  const admitted = admitLiquidityAction(owner, env);
  const state: CapabilityState = admitted.ok ? { status: "on" } : { status: "later", until: ACTIONS_UNTIL };
  return { add: state, remove: state, claim: state, maxDepositUsd: admitted.ok ? admitted.maxDepositUsd : null };
}

/**
 * The dollars an add puts in, from the venue's token prices; null when a side that goes in has no price — a canary
 * add without a price is refused rather than guessed.
 */
export function depositUsd(
  deposit: Readonly<{ x: Readonly<{ units: string; decimals: number }>; y: Readonly<{ units: string; decimals: number }> }>,
  prices: Readonly<{ x: number | null; y: number | null }>,
): number | null {
  let total = 0;
  for (const side of ["x", "y"] as const) {
    const amount = deposit[side];
    if (amount.units === "0") continue;
    const price = prices[side];
    /* A price of zero is a price nobody stated: it would let any amount under the ceiling. */
    if (price === null || !Number.isFinite(price) || price <= 0) return null;
    total += (Number(amount.units) / 10 ** amount.decimals) * price;
  }
  return total;
}
