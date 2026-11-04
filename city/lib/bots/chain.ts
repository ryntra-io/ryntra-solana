import type { HangarAnswer, HangarBot } from '../../../lib/bots/hangar/hangar.ts';

/**
 * The bots a wallet really runs, read from the engine's Hangar (CITY-131, `GET /api/bots/hangar?wallet=`): its pool
 * positions, its limit orders and ladders at DLMM and Jupiter Trigger V1, each with its status, its result against
 * holding and its last fill's receipt, and the wallet's loose ends — bundles that did not all land, orders left behind.
 *
 * A read and nothing more: nothing here builds, signs or sends. Ryntra holds no key that moves any of these bots
 * (`noRyntraSignature`), so the window only shows them; closing one is the person's own signature where it was placed.
 */

export type ChainRead =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; wallet: string }>
  | Readonly<{ status: 'ready'; wallet: string; answer: HangarAnswer }>
  | Readonly<{ status: 'error'; wallet: string }>;

export type ChainFetch = (url: string, init: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>;

/** A read that takes longer than this gives up: the hangar still shows the practice bots. */
export const CHAIN_WAIT_MS = 12_000;
/** And is read again after this long while the window is open. */
export const CHAIN_FRESH_MS = 60_000;

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const chainUrl = (wallet: string): string => `/api/bots/hangar?${new URLSearchParams({ wallet })}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A bot as the engine answers it; anything that does not look like one is left out, never guessed. */
function isBot(value: unknown): value is HangarBot {
  return isObject(value) && typeof value.id === 'string' && typeof value.kind === 'string' && typeof value.name === 'string' && typeof value.status === 'string' && typeof value.filler === 'string';
}

/** The engine's answer, checked: the wallet it is for, its bots, its loose ends; null when it is not one. */
export function readAnswer(body: unknown, wallet: string): HangarAnswer | null {
  if (!isObject(body) || body.wallet !== wallet || !Array.isArray(body.bots)) return null;
  const read = isObject(body.read) ? body.read : {};
  return {
    wallet,
    at: typeof body.at === 'number' ? body.at : 0,
    bots: body.bots.filter(isBot),
    issues: Array.isArray(body.issues) ? (body.issues.filter((i) => isObject(i) && (i.kind === 'orphan' || i.kind === 'incomplete_bundle')) as HangarAnswer['issues']) : [],
    sunset: isObject(body.sunset) ? (body.sunset as HangarAnswer['sunset']) : null,
    read: { positions: read.positions === true, orders: read.orders === true, rules: read.rules === true },
  };
}

export async function fetchChain(wallet: string, deps: Readonly<{ fetch: ChainFetch }>): Promise<HangarAnswer | null> {
  if (!WALLET.test(wallet)) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHAIN_WAIT_MS);
  try {
    const response = await deps.fetch(chainUrl(wallet), { signal: abort.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return readAnswer(await response.json(), wallet);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The engine's bots in the order the hangar lists them: the ones that need the person first, closed ones last. */
const ORDER: Readonly<Record<HangarBot['status'], number>> = { needs_you: 0, out_of_range: 1, partial: 2, working: 3, waiting: 4, paused: 5, filled: 6, closed: 7 };

export function sortChain(bots: readonly HangarBot[]): HangarBot[] {
  return [...bots].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
}
