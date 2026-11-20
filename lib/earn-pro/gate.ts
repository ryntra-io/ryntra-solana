/**
 * Where earning on Meteora DLMM Pro is served.
 *
 * One switch on the server, `RYNTRA_EARN_PRO`:
 *
 * | Value | What it opens |
 * |---|---|
 * | `devnet` | the piers, positions and an agent's care on devnet — the stand the operator tries it on |
 * | `mainnet` | Until then a deployment that sets it opens nothing |
 * | anything else | closed: every route answers 404, the city draws nothing |
 *
 * The city's own switch (`NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open`, `city/lib/earn/pro.ts`) only decides whether the
 * window asks; what is served is decided here.
 *
 * Pure: no I/O, no clock.
 */

import { DLMM_PRO_EARN_ON_MAINNET } from "../core/venues/meteora-dlmm-pro/gate.ts";

export const EARN_PRO_ENV = "RYNTRA_EARN_PRO";
/** Set to anything: new money stops at once — no opening, no adding, no new care. Taking out and taking back stay open. */
export const EARN_PRO_STOP_ENV = "RYNTRA_EARN_PRO_STOP";

export type EarnProNetwork = "devnet" | "mainnet";
export type EarnProGate = Readonly<{ open: true; network: EarnProNetwork }> | Readonly<{ open: false; reason: "closed" | "owner-word" }>;

type Env = Readonly<Record<string, string | undefined>>;

export function earnProGate(env: Env, ownerWord: boolean = DLMM_PRO_EARN_ON_MAINNET): EarnProGate {
  const value = env[EARN_PRO_ENV]?.trim().toLowerCase();
  if (value === "devnet") return { open: true, network: "devnet" };
  if (value === "mainnet") return ownerWord ? { open: true, network: "mainnet" } : { open: false, reason: "owner-word" };
  return { open: false, reason: "closed" };
}

/** Whether new money is stopped: the stop never holds money in. */
export const earnProStopped = (env: Env): boolean => Boolean(env[EARN_PRO_STOP_ENV]?.trim());

/**
 * An opening from a shape of the person's own, painted on a grid. Closed unless a deployment sets it to
 * `open` (exactly): then it is served wherever the surface itself is. The terminal's own switch
 * (`NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE=open`) only decides whether the ticket offers it.
 */
export const EARN_PRO_SHAPE_ENV = "RYNTRA_EARN_PRO_SHAPE";
export const earnProShapeOpen = (env: Env): boolean => env[EARN_PRO_SHAPE_ENV]?.trim() === "open";

/**
 * A position of one's own in any pool of SOL against another coin (MET/SOL and the like), not only against
 * the coins Earn checked (USDC and the staked SOL). Closed unless a deployment sets it to `open` (exactly). An agent's
 * care stays where it knows the coin (`./coins.ts`): in any other pool the person looks after the position. The
 * terminal's own switch (`NEXT_PUBLIC_RYNTRA_EARN_PRO_ANY_POOL=open`) only decides whether the pool's page offers it.
 */
export const EARN_PRO_ANY_POOL_ENV = "RYNTRA_EARN_PRO_ANY_POOL";
export const earnProAnyPool = (env: Env): boolean => env[EARN_PRO_ANY_POOL_ENV]?.trim() === "open";

/**
 * A position of one's own in a DLMM Pro pool of SOL against a **checked stock** of the stocks engine's shelf
 * (`lib/stocks/**`: a listed company's token the venue verified and its issuer names — Anthropic's ANT by Backpack
 * Securities was the first), without opening every pool of SOL (`RYNTRA_EARN_PRO_ANY_POOL`). Closed unless a deployment
 * sets it to `open` (exactly). No agent looks after such a position (`./coins.ts` does not know the coin); taking out
 * stays open whatever this says. The terminal's own switch (`NEXT_PUBLIC_RYNTRA_EARN_PRO_STOCKS=open`) only decides
 * whether a screen offers it.
 */
export const EARN_PRO_STOCKS_ENV = "RYNTRA_EARN_PRO_STOCKS";
export const earnProStocks = (env: Env): boolean => env[EARN_PRO_STOCKS_ENV]?.trim() === "open";

/** The actions a person's wallet signs here. The first three put money in or give a right; the rest take out or take back. */
export const EARN_PRO_ACTIONS = ["open", "compound", "care_on", "collect", "leave", "close", "care_off"] as const;
export type EarnProAction = (typeof EARN_PRO_ACTIONS)[number];
const BRINGS_IN: ReadonlySet<EarnProAction> = new Set(["open", "compound", "care_on"]);

/** Whether the action is one the stop holds back. */
export const heldByStop = (action: EarnProAction): boolean => BRINGS_IN.has(action);
