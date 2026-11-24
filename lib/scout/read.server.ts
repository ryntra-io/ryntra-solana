import "server-only";

import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { scoutModeOf } from "./flag.ts";
import { loadDesk, readJournal, type ScoutNetwork } from "./store.server.ts";
import { checksFor, viewOf, type ScoutChecks, type ScoutView } from "./view.ts";

/**
 * The Scout's reads for its route: the view and the checks, assembled once for everyone asking within a few seconds.
 * Without a store the Scout answers as off with nothing on its desk — never an error a page would show.
 */

const NETWORK: ScoutNetwork = "mainnet";
const ANSWER_TTL_MS = 15_000;
/** The view reads the last day of the journal. */
const VIEW_HOURS = 24;

let viewCache: { at: number; value: Promise<ScoutView> } | null = null;
let deskCache: { at: number; value: Promise<Awaited<ReturnType<typeof loadDesk>> | null> } | null = null;

function storeOf(): GuardStore | null {
  try {
    const guard = getGuardRuntime();
    return guard.store;
  } catch {
    return null;
  }
}

function deskNow(store: GuardStore | null, now: number) {
  if (deskCache && now - deskCache.at < ANSWER_TTL_MS) return deskCache.value;
  const value = store ? loadDesk(store, NETWORK).catch(() => null) : Promise.resolve(null);
  deskCache = { at: now, value };
  return value;
}

export function readScout(env: Readonly<Record<string, string | undefined>> = process.env, now: number = Date.now()): Promise<ScoutView> {
  if (viewCache && now - viewCache.at < ANSWER_TTL_MS) return viewCache.value;
  const store = storeOf();
  const value = (async () => {
    const [desk, hours] = await Promise.all([deskNow(store, now), store ? readJournal(store, NETWORK, now, VIEW_HOURS).catch(() => []) : Promise.resolve([])]);
    return viewOf({ on: scoutModeOf(env) !== "off", desk, hours, now });
  })();
  viewCache = { at: now, value };
  value.catch(() => {
    if (viewCache?.value === value) viewCache = null;
  });
  return value;
}

export async function readScoutChecks(mints: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env, now: number = Date.now()): Promise<ScoutChecks> {
  const desk = await deskNow(storeOf(), now);
  return { on: scoutModeOf(env) !== "off", checks: checksFor(desk, mints) };
}
