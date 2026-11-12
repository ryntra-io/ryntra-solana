/**
 * CITY-70 — «Freeze»: the person's own switch that stops the agent's new actions at once, with no transaction. The agent
 * still reads back what is already on its way (a trade being confirmed is settled by its signature), it only starts
 * nothing new; «Resume» takes the switch off. Her money and her policy stay where they are: to take the budget back is
 * «Withdraw», one signature of hers.
 *
 * The switch lives under its own key in the agent's book (`f:<cluster>:<policy>`), apart from the mandate's row, so no
 * pass that rewrites the row (the agent's, the money autopilot's) can ever write it away; the pass reads the switches
 * once at its start and again just before each buy. A switch that cannot be read stops the buy: a kill switch not read
 * is never taken as off.
 *
 * Only the mandate's own wallet turns it, under its proof (`app/api/bots/mandate/freeze`). Public data only.
 */

import type { GuardStore } from "../guard/store.ts";
import { AGENT_BOOK, readEntry } from "./book.server.ts";
import type { MandateNetwork } from "./service.server.ts";

export type FreezeRow = Readonly<{ v: 1; kind: "freeze"; cluster: MandateNetwork; policy: string; owner: string; at: number }>;

export const freezeKey = (cluster: string, policy: string) => `f:${cluster}:${policy}`;

const switches = (store: GuardStore) => store.collection<FreezeRow>(AGENT_BOOK);

const isFreeze = (row: unknown): row is FreezeRow => typeof row === "object" && row !== null && (row as FreezeRow).kind === "freeze" && (row as FreezeRow).v === 1;

/** The policies frozen on a network. Throws when the book does not answer. */
export async function frozenOn(store: GuardStore, cluster: string): Promise<ReadonlySet<string>> {
  const rows = await switches(store).valuesWithPrefix(`f:${cluster}:`);
  return new Set(rows.filter(isFreeze).map((row) => row.policy));
}

/** Whether one mandate is frozen. Throws when the book does not answer. */
export async function isFrozen(store: GuardStore, cluster: string, policy: string): Promise<boolean> {
  return isFreeze(await switches(store).get(freezeKey(cluster, policy)));
}

export type FreezeResult = Readonly<{ ok: true; frozen: boolean }> | Readonly<{ ok: false; code: "NOT_FOUND" | "NOTHING"; reason: string }>;

/**
 * Turn the switch for her mandate: on stops the agent's new actions; off lets it work again. Only a mandate of the agent's
 * book, of this wallet; a mandate no longer at work has nothing to freeze (taking the switch off is always allowed).
 */
export async function setFrozen(input: Readonly<{ owner: string; policy: string; frozen: boolean }>, cluster: MandateNetwork, deps: Readonly<{ store: GuardStore; now?: () => number }>): Promise<FreezeResult> {
  const entry = await readEntry(deps.store, input.policy, cluster);
  if (!entry || entry.record.owner !== input.owner) return { ok: false, code: "NOT_FOUND", reason: "No such agent of this wallet." };
  const key = freezeKey(cluster, input.policy);
  if (!input.frozen) {
    await switches(deps.store).delete(key);
    return { ok: true, frozen: false };
  }
  if (entry.status !== "working" && entry.status !== "paused") return { ok: false, code: "NOTHING", reason: "The agent no longer works for this mandate." };
  await switches(deps.store).set(key, { v: 1, kind: "freeze", cluster, policy: input.policy, owner: input.owner, at: (deps.now ?? Date.now)() });
  return { ok: true, frozen: true };
}
