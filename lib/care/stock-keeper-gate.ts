/**
 * The switch of the stock pool's keeper. Closed, the care works exactly as it does without it: the stop,
 * the fees, and a range the agent never touches.
 *
 * `RYNTRA_STOCK_KEEPER` names the network the keeper works on — `devnet` or `mainnet`; anything else, or nothing,
 * closes it. It works only where the agent's care itself is open on that same network (`RYNTRA_AGENT_CARE`, and for
 * DLMM Pro `RYNTRA_EARN_PRO`): the caller asks both.
 *
 * Two keepers, by what the person signed (`keeperModeOf`):
 * - **pull** — puts nothing back: before the close and a dividend it takes the narrow liquidity out to the person's
 *   wallet, with the rights a care already has. Open on either network by the switch;
 * - **shift** — moves the money itself, with the person's spending approval on her own accounts. The program does not
 *   hold that approval to the pool — the agent's key could spend it elsewhere, and only Ryntra's signer refuses to —
 *   so on mainnet it opens only by `STOCK_KEEPER_SHIFT_ON_MAINNET`, in a change of this line. A
 *   constant: nothing in a deployment can flip it.
 *
 * The way back: unset the switch. A keeper that is closed signs nothing; what it laid stays the person's, in her
 * pool, and her stop and fees go on as before.
 *
 * Pure: reads only the environment it is given.
 */

import { keeperModeOf, type KeeperMode, type RangeLimits } from "./range-limits.ts";

export const STOCK_KEEPER_ENV = "RYNTRA_STOCK_KEEPER";

/** Not given. */
export const STOCK_KEEPER_SHIFT_ON_MAINNET = false;

export type StockKeeperGate = Readonly<{ open: false }> | Readonly<{ open: true; network: "devnet" | "mainnet"; modes: readonly KeeperMode[] }>;

type Env = Readonly<Record<string, string | undefined>>;

export function stockKeeperGate(env: Env = process.env): StockKeeperGate {
  const network = env[STOCK_KEEPER_ENV]?.trim().toLowerCase();
  if (network === "devnet") return { open: true, network, modes: ["pull", "shift"] };
  if (network === "mainnet") return { open: true, network, modes: STOCK_KEEPER_SHIFT_ON_MAINNET ? ["pull", "shift"] : ["pull"] };
  return { open: false };
}

/** Whether the switch lets a keeper of these bounds work on this network. */
export function stockKeeperAllowed(gate: StockKeeperGate, network: "devnet" | "mainnet", limits: Pick<RangeLimits, "maxPutBackPerShift">): boolean {
  return gate.open && gate.network === network && gate.modes.includes(keeperModeOf(limits));
}
