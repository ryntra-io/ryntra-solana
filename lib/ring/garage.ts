import { createHash } from "node:crypto";

import type { WorldStore } from "../world/store.ts";
import type { GarageCheck } from "./engine.ts";

/**
 * The Arena's own garage (CITY-217): every account has one bay in the Arena, so a person makes an agent the moment the
 * Arena opens — no quarter to claim, no level to reach before the quarter's garage (from level 3, `lib/world/catalog`).
 * One agent lives in it; more live in the garages of the quarter. Its address is the account's alone and tells nobody
 * which account it is: a hash, never the account's id.
 */
export const BAY_SLOT = 0;
const BAY = /^bay-[0-9a-f]{32}$/;

export function bayOf(accountId: string): { quarterId: string; slot: number } {
  return { quarterId: `bay-${createHash("sha256").update(`ryntra-ring-bay\n${accountId}`).digest("hex").slice(0, 32)}`, slot: BAY_SLOT };
}

export const isBay = (quarterId: string): boolean => BAY.test(quarterId);

/**
 * Whether a garage slot is this account's to put an agent in. The account's own bay in the Arena always is. Otherwise
 * the world's word, read and never changed (`lib/world`, CITY-14): the account's resident owns the quarter, and the
 * building on that slot is a garage. A world that does not answer is `unavailable`; nothing is assumed in its place.
 */
export async function garageOf(world: Pick<WorldStore, "resident" | "quarter">, input: { accountId: string; quarterId: string; slot: number }): Promise<GarageCheck> {
  if (isBay(input.quarterId)) {
    const bay = bayOf(input.accountId);
    return bay.quarterId === input.quarterId && bay.slot === input.slot ? "ok" : "not_yours";
  }
  try {
    const resident = await world.resident({ accountId: input.accountId });
    if (!resident) return "not_yours";
    const state = await world.quarter(input.quarterId);
    if (!state || state.quarter.ownerId !== resident.id) return "not_yours";
    return state.buildings.some((building) => building.slot === input.slot && building.kind === "garage") ? "ok" : "not_garage";
  } catch {
    return "unavailable";
  }
}
