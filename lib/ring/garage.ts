import type { WorldStore } from "../world/store.ts";
import type { GarageCheck } from "./engine.ts";

/**
 * Whether a garage slot is this account's to put an agent in — the world's word, read and never changed
 * (`lib/world`, CITY-14): the account's resident owns the quarter, and the building on that slot is a garage.
 * A world that does not answer is `unavailable`; nothing is assumed in its place.
 */
export async function garageOf(world: Pick<WorldStore, "resident" | "quarter">, input: { accountId: string; quarterId: string; slot: number }): Promise<GarageCheck> {
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
