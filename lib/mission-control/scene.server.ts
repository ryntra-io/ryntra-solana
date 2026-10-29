/**
 * Mission Control on the server: the same snapshot the browser builds (`live.ts`), read through the Launch API's own
 * server functions and their caches — for a mission page's title and for the cards for X, whose figures are read here
 * and never taken from the address. A read that does not answer in time is no snapshot: the page stays generic, the
 * card is not drawn.
 */

import { launchHealthDeps } from "../launch/runtime.server.ts";
import { readLaunchMarkets } from "../launch/markets.server.ts";
import { readLaunchSurvival } from "../launch/survival.server.ts";
import { readFlyingCrews } from "../launch/crew.server.ts";
import type { LaunchCrewsResponse } from "../api/v1/contract.ts";
import { snapshotFrom } from "./scene.ts";
import type { SceneMission, SceneSnapshot } from "./types.ts";

const TIMEOUT_MS = 4_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/* The crews in flight (MC-2), as `GET /api/v1/launch/crews` answers them: Ryntra's records joined to each launch's vault. */
async function readCrews(deps: NonNullable<ReturnType<typeof launchHealthDeps>>): Promise<LaunchCrewsResponse> {
  const crews = await readFlyingCrews({ store: deps.store, cluster: deps.network.cluster });
  return { network: deps.network.chain, crews: crews.map((crew) => ({ ...crew, members: [...crew.members] })), observedAt: new Date().toISOString() };
}

export async function readSky(ms = TIMEOUT_MS): Promise<SceneSnapshot | null> {
  const deps = launchHealthDeps();
  if (!deps) return null;
  const [markets, survival, crews] = await Promise.all([within(readLaunchMarkets(deps), ms), within(readLaunchSurvival(deps), ms), within(readCrews(deps), ms)]);
  if (!markets) return null;
  return snapshotFrom(markets, survival, Date.now(), undefined, crews);
}

export async function readSceneMission(token: string, ms = TIMEOUT_MS): Promise<SceneMission | null> {
  const deps = launchHealthDeps();
  if (!deps) return null;
  const [markets, survival, crews] = await Promise.all([within(readLaunchMarkets(deps), ms), within(readLaunchSurvival(deps), ms), within(readCrews(deps), ms)]);
  const row = markets?.markets.find((market) => market.token === token);
  if (!markets || !row) return null;
  /* One market alone: the snapshot of a list with just it, so the mission reads exactly as on the sky. */
  return snapshotFrom({ ...markets, markets: [row] }, survival, Date.now(), undefined, crews).missions[0] ?? null;
}
