/**
 * «Ryntra попередить» on a position: the exit of a company the wallet already
 * holds, when no plan it was bought under watches it. The person picks one of
 * the published presets — «Обережно» −5 % / +10 %, «Збалансовано» −10 % /
 * +20 % — and the server counts the loss limit and the target from the
 * token's price as the product reads it now, never from a figure the client
 * sends. From then on Нагляд checks the price every five minutes and warns at
 * the limit or the target; the sale stays the person's to open and sign.
 * Nothing here moves or holds money: the tokens stay in the wallet.
 *
 * One record per wallet and token, keyed `solana:mainnet:<wallet>:<mint>` in
 * `positionWatches`, written by compare-and-set on its own version. Turning it
 * on again counts the figures afresh from the price now. A complete read of
 * the wallet that finds none of the token closes it (`closedAt`): a position
 * sold in full is not watched, and a new purchase of the token is a new
 * position that says «вихід не налаштований» until the person decides again.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { POSITION_WATCH_PRESETS, POSITION_WATCH_PRESET_IDS, roundWatch, watchFigures, type PositionWatchPreset } from "./watch-figures.ts";

export { POSITION_WATCH_PRESETS, POSITION_WATCH_PRESET_IDS, watchFigures, type PositionWatchPreset };

export type PositionWatchRecord = Readonly<{
  version: number;
  owner: string;
  mint: string;
  /** The token's symbol when it was turned on — the label of its monitor and its notes. */
  symbol: string;
  preset: PositionWatchPreset;
  stopPct: number;
  targetPct: number;
  /** The price the limit and the target were counted from, USD per unit as the wallet shows the token, and when it was observed. */
  basisPerUnit: number;
  basisObservedAt: string;
  /** The loss limit and the target, the same unit. */
  limitPerUnit: number;
  targetPerUnit: number;
  /** The language the person turned it on in: its notes and its Telegram message speak it. */
  locale: "en" | "uk";
  createdAt: string;
  updatedAt: string;
  /** When a complete read of the wallet found none of the token: from then on nothing is watched. Null while open. */
  closedAt: string | null;
}>;

const PREFIX = "solana:mainnet:";

export function positionWatchKey(owner: string, mint: string): string {
  return `${PREFIX}${owner}:${mint}`;
}

/** Where a position's warning lands: its company, the sale opening on arrival — the one action of «Дія». */
export function positionSaleHref(symbol: string): string {
  return `/app/stocks/${encodeURIComponent(symbol)}?sell=1`;
}

export function positionWatchesOf(store: GuardStore) {
  return store.versioned<PositionWatchRecord>("positionWatches");
}

/** The wallet's watches — open and closed — or every wallet's, for the tick. */
export async function listPositionWatches(store: GuardStore, owner?: string): Promise<readonly PositionWatchRecord[]> {
  return positionWatchesOf(store).valuesWithPrefix(owner ? `${PREFIX}${owner}:` : PREFIX);
}

export async function readPositionWatch(store: GuardStore, owner: string, mint: string): Promise<PositionWatchRecord | null> {
  const found = await positionWatchesOf(store).get(positionWatchKey(owner, mint));
  return found && found.owner === owner ? found : null;
}

export type SetPositionWatchInput = Readonly<{
  mint: string;
  symbol: string;
  preset: PositionWatchPreset;
  basisPerUnit: number;
  basisObservedAt: string;
  locale: "en" | "uk";
}>;

/** Turn «Ryntra попередить» on for a position, or again with a new preset: the figures are counted afresh from the price given. */
export async function setPositionWatch(store: GuardStore, owner: string, input: SetPositionWatchInput, nowMs: number): Promise<PositionWatchRecord> {
  if (!Number.isFinite(input.basisPerUnit) || input.basisPerUnit <= 0) throw new Error("A watch needs a positive price to count from.");
  const at = new Date(nowMs).toISOString();
  const key = positionWatchKey(owner, input.mint);
  const figures = watchFigures(input.preset, input.basisPerUnit);
  let written: PositionWatchRecord | null = null;
  await withBoundedCasRetry(async () => {
    const current = await positionWatchesOf(store).get(key);
    const next: PositionWatchRecord = {
      version: current ? current.version + 1 : 0,
      owner,
      mint: input.mint,
      symbol: input.symbol,
      preset: input.preset,
      stopPct: figures.stopPct,
      targetPct: figures.targetPct,
      basisPerUnit: roundWatch(input.basisPerUnit),
      basisObservedAt: input.basisObservedAt,
      limitPerUnit: figures.limitPerUnit,
      targetPerUnit: figures.targetPerUnit,
      locale: input.locale,
      createdAt: current && current.closedAt === null ? current.createdAt : at,
      updatedAt: at,
      closedAt: null,
    };
    const ok = await positionWatchesOf(store).compareAndSet(key, current ? current.version : null, next);
    if (ok) written = next;
    return ok;
  });
  if (!written) throw new Error("The watch could not be written.");
  return written;
}

/** A complete read found none of the token: the watch closes, once; a watch already closed stays as it was. */
export async function closePositionWatch(store: GuardStore, owner: string, mint: string, nowMs: number): Promise<boolean> {
  const key = positionWatchKey(owner, mint);
  let closed = false;
  await withBoundedCasRetry(async () => {
    const current = await positionWatchesOf(store).get(key);
    if (!current || current.owner !== owner || current.closedAt !== null) return true;
    const at = new Date(nowMs).toISOString();
    const ok = await positionWatchesOf(store).compareAndSet(key, current.version, { ...current, version: current.version + 1, closedAt: at, updatedAt: at });
    if (ok) closed = true;
    return ok;
  });
  return closed;
}
