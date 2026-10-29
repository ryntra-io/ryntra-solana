"use client";

/**
 * The grids a wallet placed through «Боти», kept in this browser (B10): the
 * chain holds the position but not that it is a grid, so the browser that
 * placed it keeps the choice — beside the pools' entry of what went in
 * (`app/app/markets/pools/position-entries.ts`), which gives the bot its
 * result. Another browser, or a cleared one, shows the same position in
 * «Пули». The checks are `lib/bots/grid.ts`.
 */

import { useCallback, useEffect, useState } from "react";

import { readGridBot, type GridBot } from "@/lib/bots/grid";

const KEY = "ryntra.bots.grids.v1:";
/** The same tab hears its own writes through this event; other tabs through `storage`. */
const CHANGED = "ryntra:grid-bots";

function readAll(owner: string): GridBot[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY + owner) ?? "null") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(readGridBot).filter((bot): bot is GridBot => bot !== null);
  } catch {
    return [];
  }
}

function write(owner: string, bots: readonly GridBot[]): void {
  try {
    window.localStorage.setItem(KEY + owner, JSON.stringify(bots));
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: owner }));
  } catch {
    /* No storage (a private window, blocked site data): the position still shows in «Пули». */
  }
}

/** A placement landed: the grid joins the wallet's bots, newest first. */
export function recordGrid(owner: string, bot: GridBot): void {
  write(owner, [bot, ...readAll(owner).filter((kept) => kept.position !== bot.position)]);
}

/** The grid was stopped, here or elsewhere: it leaves the list. */
export function forgetGrid(owner: string, position: string): void {
  const all = readAll(owner);
  if (all.some((bot) => bot.position === position)) write(owner, all.filter((bot) => bot.position !== position));
}

/**
 * What one read of the chain said about a grid. Present — any earlier miss is cleared. Absent past the settle window —
 * the first such read marks it, and only a later, different read without it takes the grid off the list: one read
 * that missed a position (a node behind, a cached answer) never removes a bot.
 */
export function noteGridRead(owner: string, position: string, present: boolean, readAt: number): void {
  const all = readAll(owner);
  const bot = all.find((kept) => kept.position === position);
  if (!bot) return;
  if (present) {
    if (bot.missedAt === undefined) return;
    const { missedAt: _cleared, ...rest } = bot;
    void _cleared;
    write(owner, all.map((kept) => (kept.position === position ? rest : kept)));
    return;
  }
  if (bot.missedAt === undefined) {
    write(owner, all.map((kept) => (kept.position === position ? { ...kept, missedAt: readAt } : kept)));
    return;
  }
  if (readAt > bot.missedAt) write(owner, all.filter((kept) => kept.position !== position));
}

/** The wallet's grids, kept current as this tab or another one changes them; null until the browser has read them. */
export function useGridBots(owner: string | null): readonly GridBot[] | null {
  const [bots, setBots] = useState<readonly GridBot[] | null>(null);
  const refresh = useCallback(() => setBots(owner ? readAll(owner) : []), [owner]);
  useEffect(() => {
    refresh();
    if (!owner) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === KEY + owner) refresh();
    };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === owner) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED, onChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED, onChanged);
    };
  }, [owner, refresh]);
  return bots;
}
