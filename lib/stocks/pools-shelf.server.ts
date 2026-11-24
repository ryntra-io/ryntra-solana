import "server-only";

import { dlmmStocksMode, dlmmStocksStopped } from "@/lib/earn-dlmm/stocks";
import { earnProGate, earnProStocks, earnProStopped } from "@/lib/earn-pro/gate";
import { stockSeatsOf } from "@/lib/earn-pro/stocks";
import { readPoolCatalog } from "@/lib/liquidity/catalog/service.server";
import { readProMarket } from "@/lib/pro-limits/service.server";
import type { ProPoolRow } from "@/lib/pro-pools/model";
import { readProPools } from "@/lib/pro-pools/read.server";
import { proStore, restProStore } from "@/lib/pro-pools/store.server";
import { readOnchainMintCached } from "@/lib/stocks/asset.server";
import { noShelf, proDaysOf, shelfDeposits, shelfOf, type PoolsShelf, type ProDay, type ShelfLadder } from "@/lib/stocks/pools-shelf";
import { readStockUniverse } from "@/lib/stocks/universe.server";
import { lookalikeOf } from "@/lib/world/text-safety/lookalike";

/**
 * A stock's pools on Meteora on the server, read only (the model and its rules: `./pools-shelf.ts`).
 *
 * - **The stock** — the stocks engine's warm universe: a mint it does not hold is no stock and has no shelf. Whether new
 *   money may go into the stock's pools is the rule of the stock pools' deposit as it is: a listed company's token its
 *   issuer still sells (`lib/earn-pro/stocks.ts`), not paused by its issuer (the mint's own pausable config, the
 *   engine's cached read), and the deployment's own switches — `RYNTRA_EARN_DLMM_STOCKS=open` and the Harbor's stop for
 *   DLMM, `RYNTRA_EARN_PRO`, `RYNTRA_EARN_PRO_STOCKS` and DLMM Pro's stop for DLMM Pro. A canary serves one wallet, not
 *   a shelf everyone reads: under `canary` the shelf offers no deposit.
 * - **DLMM** — one search of the engine's pool catalogue by the mint (kept two minutes for every visitor, paced per
 *   minute by the catalogue itself).
 * - **DLMM Pro** — the program's pools as the `/pro` table reads them (kept a minute), cut to the stock's; their day from
 *   the indexer's rows (one read of the database), and the ladder market of the stock (kept twenty seconds) — both only
 *   when the stock has a DLMM Pro pool at all.
 *
 * One answer per mint is kept a minute for the whole process, and one read at a time is in flight per mint, so a page
 * that many people open costs the venues the same. A part that did not answer leaves its pools out and says so
 * (`read`); null — the stocks universe itself did not read, and nothing is said rather than «no pools».
 */

export const SHELF_KEEP_MS = 60_000;
/** A shelf with a venue missing is asked again sooner. */
export const SHELF_PART_KEEP_MS = 15_000;
/** The most mints kept: an address anyone may type is never a reason for the process to grow. */
export const SHELVES_KEPT = 256;

type Env = Readonly<Record<string, string | undefined>>;

const kept = new Map<string, Readonly<{ at: number; shelf: PoolsShelf }>>();
const flights = new Map<string, Promise<PoolsShelf | null>>();

/** Forgets what is kept — for a test. */
export function resetPoolsShelf(): void {
  kept.clear();
  flights.clear();
}

const passesFor = (symbol: string, mint: string): boolean => lookalikeOf(symbol, mint) !== null;

/** A stock's pools on DLMM and DLMM Pro; null where the stocks universe did not read. Never throws. */
export function readPoolsShelf(mint: string, nowMs: number = Date.now(), env: Env = process.env): Promise<PoolsShelf | null> {
  const hit = kept.get(mint);
  if (hit) {
    const whole = hit.shelf.read.dlmm && hit.shelf.read.pro;
    if (nowMs - hit.at < (whole ? SHELF_KEEP_MS : SHELF_PART_KEEP_MS)) return Promise.resolve(hit.shelf);
  }
  const flying = flights.get(mint);
  if (flying) return flying;
  const flight = build(mint, nowMs, env)
    .catch(() => null)
    .then((shelf) => {
      if (shelf) keep(mint, { at: nowMs, shelf });
      return shelf;
    })
    .finally(() => flights.delete(mint));
  flights.set(mint, flight);
  return flight;
}

function keep(mint: string, value: Readonly<{ at: number; shelf: PoolsShelf }>): void {
  kept.delete(mint);
  while (kept.size >= SHELVES_KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
  kept.set(mint, value);
}

async function build(mint: string, nowMs: number, env: Env): Promise<PoolsShelf | null> {
  const universe = await readStockUniverse().catch(() => null);
  if (!universe?.ok) return null;
  const row = universe.universe.rows.find((candidate) => candidate.representation.mint === mint) ?? null;
  if (!row) return noShelf(mint, nowMs);
  const symbol = row.representation.symbol;

  const gate = earnProGate(env);
  const [catalog, proAll, mintRead] = await Promise.all([
    readPoolCatalog(mint).catch(() => null),
    gate.open ? readProPools(gate.network).then((answer) => answer.pools, () => null) : Promise.resolve([] as readonly ProPoolRow[]),
    readOnchainMintCached(mint).catch(() => null),
  ]);
  const dlmm = catalog && catalog.sources.dlmm.ok ? catalog.pools.filter((pool) => pool.kind === "dlmm") : null;
  const pro = proAll === null ? null : proAll.filter((pool) => pool.x.mint === mint || pool.y.mint === mint);

  /* The day and the ladder are read only for a stock with a DLMM Pro pool. */
  let proDays: ReadonlyMap<string, ProDay> = new Map();
  let ladder: ShelfLadder | null = null;
  if (gate.open && pro && pro.length > 0) {
    const network = gate.network;
    const [states, market] = await Promise.all([
      (async () => {
        const store = proStore(nowMs);
        if (!store) return null;
        try {
          return await store.states(network);
        } catch {
          restProStore(nowMs);
          return null;
        }
      })(),
      readProMarket(mint).catch(() => null),
    ]);
    proDays = proDaysOf(states, pro.map((pool) => pool.address));
    const value = market?.ok ? market.value : null;
    if (value && value.network === network) ladder = { pool: value.pool, ownerBps: value.bonus.ownerBps, placing: value.placing };
  }

  /* New money into the stock's pools: the stock's seat, no pause, and the deployment's switches. */
  const seat = stockSeatsOf(universe.universe.rows, [mint]).get(mint) ?? null;
  const onchain = mintRead && !("error" in mintRead) ? mintRead : null;
  const deposits = shelfDeposits({
    seat: seat !== null,
    paused: onchain === null ? null : onchain.pausable?.paused === true,
    dlmm: dlmmStocksMode(env),
    dlmmStopped: dlmmStocksStopped(env),
    pro: gate.open,
    proStocks: earnProStocks(env),
    proStopped: earnProStopped(env),
  });

  return shelfOf({ mint, symbol, nowMs, dlmm, pro, proDays, ladder, deposits, passesFor });
}
