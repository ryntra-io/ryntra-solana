/**
 * Who may move money through Earn today.
 *
 * The same gate the collateral lane has (`lib/phoenix/collateral.ts`) and for the same reason: code that can
 * move a person's dollars ships switched off, and the first live move is the founder's own small one. Three
 * states, set at runtime:
 *
 * - `CLOSED` — the default and anything unrecognised: no surface offers the action and no route builds bytes;
 * - `CANARY` — the one wallet the deployment names, up to {@link EARN_CANARY_MAX_USD} a move: the founder's
 *   first live check;
 * - `OPEN` — everyone.
 *
 * A stranger under `CANARY` is told exactly what a stranger under `CLOSED` is told. The gate is asked twice —
 * when the Review is built and again before the signed bytes are sent — so a gate that closed or narrowed
 * while a wallet was open holds the bytes back.
 *
 * Reading markets and positions is not gated: it moves nothing, and a person deciding whether to use Earn at
 * all is entitled to the figures before anyone decides they may act on them.
 */

import type { Env } from "./providers.ts";

export const EARN_ACTIONS_ENV = "RYNTRA_EARN_ACTIONS";
export const EARN_CANARY_WALLET_ENV = "RYNTRA_EARN_CANARY_WALLET";

/** The most one canary move may carry, in dollars: enough to prove the path, small enough to lose. */
export const EARN_CANARY_MAX_USD = 5;

export type EarnAdmission =
  | Readonly<{ ok: true; mode: "CANARY" | "OPEN"; maxUsd: number | null }>
  | Readonly<{ ok: false; code: "ACTIONS_CLOSED" }>;

export function admitEarn(owner: string | null, env: Env): EarnAdmission {
  const mode = env[EARN_ACTIONS_ENV]?.trim().toUpperCase();
  if (mode === "OPEN") return { ok: true, mode: "OPEN", maxUsd: null };
  if (mode === "CANARY") {
    const wallet = env[EARN_CANARY_WALLET_ENV]?.trim();
    if (wallet && owner !== null && owner === wallet) return { ok: true, mode: "CANARY", maxUsd: EARN_CANARY_MAX_USD };
  }
  return { ok: false, code: "ACTIONS_CLOSED" };
}

/**
 * Whether an amount fits the admission's ceiling, by the asset's own price.
 *
 * A ceiling in dollars over an asset priced in dollars is the only honest comparison — five dollars of USDC
 * and five dollars of SOL are different amounts of different things. Without a price the canary refuses: a
 * ceiling that cannot be evaluated is not a ceiling, and the canary is the one place to be strict about it.
 */
export function withinCanary(admission: EarnAdmission, usd: number | null): boolean {
  if (!admission.ok) return false;
  if (admission.maxUsd === null) return true;
  return usd !== null && Number.isFinite(usd) && usd > 0 && usd <= admission.maxUsd;
}
