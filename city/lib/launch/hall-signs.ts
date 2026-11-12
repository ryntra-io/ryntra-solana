import type { HallBoardId, HallView } from './hall.ts';
import { shownBoards } from './hall-words.ts';

/**
 * Where the Hall of Fame stands in the city (CITY-241): a sign only on a board that has a leader, showing the leader's
 * number, and a mast only under a sign. A board nobody is on has no sign (its one action, «Launch yours», stays in the
 * Hall's panel), and a mast with no sign on it is not there at all.
 */

export const SIGN = { w: 12.8, h: 8 } as const;
/** The two masts stand at the plaza's front edge, x ±13, so the signs clear the spire and rise over the core. */
export const MASTS = [-13, 13] as const;
export const MAST_Z = 5.5;
/** How far a mast rises over its top sign: the cap's height of steel. */
const MAST_OVER = 1;

/** Every sign's place on its mast: the upper pair, then the lower. */
export const SIGN_SPOTS: ReadonlyArray<Readonly<{ board: HallBoardId; x: number; y: number }>> = [
  { board: 'catch', x: MASTS[0], y: 65 },
  { board: 'hunters', x: MASTS[1], y: 65 },
  { board: 'creators', x: MASTS[0], y: 56 },
  { board: 'scouts', x: MASTS[1], y: 56 },
];

export type HallSignsPlan = Readonly<{
  signs: ReadonlyArray<Readonly<{ board: HallBoardId; x: number; y: number }>>;
  /** One per mast that carries a sign: where it stands and how tall it is, up to just over its top sign. */
  masts: ReadonlyArray<Readonly<{ x: number; top: number }>>;
}>;

/** The boards with a leader to show: a public source and a first row. */
export function ledBoards(view: Pick<HallView, 'boards'>): HallBoardId[] {
  return shownBoards(view).filter((id) => view.boards[id].rows.length > 0);
}

/** The signs and masts the city draws for this read of the Hall. */
export function hallSignsPlan(view: Pick<HallView, 'boards'>): HallSignsPlan {
  const led = new Set(ledBoards(view));
  const signs = SIGN_SPOTS.filter((spot) => led.has(spot.board));
  const masts = MASTS.flatMap((x) => {
    const on = signs.filter((sign) => sign.x === x);
    if (!on.length) return [];
    return [{ x, top: Math.max(...on.map((sign) => sign.y)) + SIGN.h / 2 + MAST_OVER }];
  });
  return { signs, masts };
}
