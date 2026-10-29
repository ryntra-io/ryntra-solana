import { useAgent } from '../agent/store.ts';
import { openTower, standsInCity } from '../coin/open.ts';
import { useCity } from '../city/store.ts';
import { createHarborEngine } from '../districts/harbor/engine.ts';
import { HARBOR_OPEN } from '../districts/harbor/flag.ts';
import type { HarborPool } from '../districts/harbor/pools.ts';
import { BUSY, ownHoldings, useHarbor } from '../districts/harbor/store.ts';
import { allLaunches, useLaunch } from '../launch/district.ts';
import { useRun } from '../run/store.ts';
import { useWallet } from '../trade/wallet.ts';
import type { FeedEvent, FeedInput, PoolsRead } from './feed.ts';
import { hydrateFeed, useFeed } from './store.ts';

/**
 * The feed on the page: it reads nothing of its own from the market. The city's minute read (`/api/city`) and the
 * Launch district's read (`/api/v1/launch/markets`) are already in their stores; the feed takes a step whenever either
 * changes. The Harbor's pools (`/api/city/harbor`, read-only) are asked every two minutes, and only while the Harbor is
 * open to people. While a run plays the city stands frozen, and the feed waits.
 */

const POOLS_MS = 2 * 60_000;

let pools: PoolsRead | null = null;

function input(now = Date.now()): FeedInput {
  const snapshot = useCity.getState().snapshot;
  const towers = Array.isArray(snapshot.towers) ? snapshot.towers : [];
  const readAt = Date.parse(snapshot.fetchedAt);
  const launch = useLaunch.getState();
  return {
    now,
    city: towers.length ? { towers, readAt, live: snapshot.source === 'live' } : null,
    launches: launch.status === 'ready' || launch.mine.length ? allLaunches(launch, now) : null,
    pools,
  };
}

function step() {
  if (useRun.getState().phase !== 'off') return;
  useFeed.getState().step(input());
}

function takePools(list: readonly HarborPool[], at: string | null, readAt: number) {
  const parsed = at ? Date.parse(at) : NaN;
  pools = { pools: list, at: Number.isFinite(parsed) ? Math.min(parsed, readAt) : readAt };
}

async function readPools() {
  if (!HARBOR_OPEN || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
  const answer = await createHarborEngine().pools();
  // A failed read keeps the last pools; they stop counting once ten minutes old. A read that lands after the feed
  // stopped is dropped.
  if (stopAll && answer.ok && Array.isArray(answer.value.pools)) {
    takePools(answer.value.pools, answer.value.at, Date.now());
    step();
  }
}

let starts = 0;
let stopAll: (() => void) | null = null;

/** Starts the feed for the page; the returned stop ends it once its last user is gone. */
export function startFeed(): () => void {
  hydrateFeed();
  starts += 1;
  if (!stopAll) {
    const offs = [
      useCity.subscribe((st, before) => {
        if (st.snapshot !== before.snapshot) step();
      }),
      useLaunch.subscribe((st, before) => {
        if (st.feed !== before.feed || st.mine !== before.mine || st.status !== before.status) step();
      }),
      // A kind switched on before its first event gets one at once; after that it waits for the next read.
      useFeed.subscribe((st, before) => {
        if (st.settings !== before.settings) step();
      }),
      // The Harbor's own read, when someone opens it, is as good as ours.
      useHarbor.subscribe((st, before) => {
        if (st.list !== before.list && st.list.status === 'ready') takePools(st.list.pools, st.list.at, Date.now());
      }),
    ];
    const timer = HARBOR_OPEN ? setInterval(() => void readPools(), POOLS_MS) : null;
    void readPools();
    step();
    stopAll = () => {
      offs.forEach((off) => off());
      if (timer) clearInterval(timer);
      stopAll = null;
    };
  }
  return () => {
    starts -= 1;
    if (starts === 0) stopAll?.();
  };
}

/** Whether a tap on the event can open what it is about: the tower stands in the city, or the Harbor knows the pool. */
export function reachable(event: FeedEvent): boolean {
  if ('tower' in event.target) return standsInCity(event.target.tower);
  const address = event.target.pool;
  return HARBOR_OPEN && !!pools?.pools.some((pool) => pool.address === address);
}

/**
 * A tap on the event: the camera flies to the tower and its card opens, as a tap on the tower does; a pool opens in the
 * Harbor on its own card, with the wallet's own balances. False when there is nothing to open — or when the Harbor is
 * busy with an action (a Review, a signature, a send), which a tap never interrupts.
 */
export function openEvent(event: FeedEvent): boolean {
  if ('tower' in event.target) {
    if (!standsInCity(event.target.tower)) return false;
    openTower(event.target.tower);
    return true;
  }
  const address = event.target.pool;
  const pool = HARBOR_OPEN ? pools?.pools.find((p) => p.address === address) : undefined;
  if (!pool || BUSY.has(useHarbor.getState().phase)) return false;
  useAgent.getState().closePanel();
  useCity.getState().select(null);
  const harbor = useHarbor.getState();
  harbor.show();
  const wallet = useWallet.getState();
  harbor.choose(pool, ownHoldings(wallet.connection, wallet.holdings));
  return true;
}
