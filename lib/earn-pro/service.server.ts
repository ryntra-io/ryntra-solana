/**
 * The answers of `/api/v1/earn/pro/**`, as the contract (1.92.0) shapes them: the piers, and a wallet's
 * positions with what an agent's care was told and did where there is one.
 *
 * Reads only. Null where the surface is closed on this deployment; a chain that does not answer throws, and the route
 * says so — an unread list is never an empty one.
 */

import type { EarnProPiersResponse, EarnProPositionsResponse } from "../api/v1/contract.ts";
import { proCareDay } from "./care.ts";
import { proCareAgent, proCareGate, proCaresOf, type ProCareDeps } from "./care.server.ts";
import { earnProGate } from "./gate.ts";
import { readBoats, readPiers, type PierDeps } from "./piers.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

export async function earnProPiersAnswer(env: Env = process.env, deps: PierDeps = {}): Promise<EarnProPiersResponse | null> {
  const gate = earnProGate(env);
  if (!gate.open) return null;
  const { piers, at } = await readPiers(gate.network, { ...deps, env });
  return { network: gate.network, piers: piers.slice(0, 200).map((pier) => ({ ...pier, rewards: [...pier.rewards] })), at: new Date(at).toISOString(), care: proCareGate(env).open };
}

export async function earnProPositionsAnswer(owner: string, env: Env = process.env, deps: PierDeps & Readonly<{ care?: ProCareDeps }> = {}): Promise<EarnProPositionsResponse | null> {
  const gate = earnProGate(env);
  if (!gate.open) return null;
  const care = proCareGate(env);
  const now = deps.now?.() ?? Date.now();
  const [boats, rows] = await Promise.all([readBoats(gate.network, owner, proCareAgent(env), { ...deps, env }), care.open ? proCaresOf(owner, { ...deps.care, env }).catch(() => []) : Promise.resolve([])]);
  const rowOf = new Map(rows.map((row) => [row.nftMint, row]));
  return {
    network: gate.network,
    owner,
    care: care.open,
    positions: boats.map((boat) => {
      /* A row the chain never confirmed — an approval still on its way, or one that never landed — tells nothing yet. */
      const found = rowOf.get(boat.nftMint);
      const row = found && !found.confirmed && !boat.cared ? undefined : found;
      const day = row ? proCareDay(row, now) : null;
      return {
        ...boat,
        rewards: [...boat.rewards],
        /* The chain says whether it is looked after now; the book says what the care was told and did. */
        care: row && day ? { status: boat.cared ? row.status : "stopped", stoppedBy: boat.cared ? row.stoppedBy : (row.stoppedBy ?? "owner"), stopBelow: row.stopBelow, claimedInY: day.claimedInY, lastAt: day.lastAt === null ? null : new Date(day.lastAt).toISOString() } : null,
      };
    }),
  };
}
