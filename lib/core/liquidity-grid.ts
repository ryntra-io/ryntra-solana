/**
 * A liquidity shape painted on a grid, as Meteora's keynote showed it («Create New Strategy»): 32 columns,
 * 16 under the price and 16 over it, each 0 to 8 cells tall. One rule for every side of it — the ticket that paints the
 * grid and says before a Review whether it can be built, and the venue that builds it — so that what a person is told
 * and what is built never part.
 *
 * A grid becomes a weight on every tick of a pool around the price: a side's 16 columns laid over `steps` ticks of the
 * pool's spacing, the tick the price stands in taking the mean of the two columns beside the line. How many ranges a
 * position holds those weights in is counted here exactly as the SDK merges them — side by side (a range per run of one
 * weight) or stacked (a range per run of ticks at or above each weight) — and the fewer of the two is the layout.
 *
 * Pure: no I/O, no clock, no SDK.
 */

export const GRID_SIDE = 16;
export const GRID_COLUMNS = 2 * GRID_SIDE;
/** The most cells a column is painted. */
export const GRID_LEVELS = 8;
/** The program's weight of one painted cell: a full column weighs 248 of its 255, every tick in proportion to its cells. */
export const GRID_CELL_WEIGHT = 31;
/**
 * The most ranges a painted shape takes. Fifteen ranges and their deposit fit one transaction (the venue's rehearsal,
 * `REHEARSAL.md` §2), so an opening is never sent apart from its deposit; and every range keeps rent until the position
 * is closed. A shape that needs more is not coarsened behind the person's back: it is said to be too detailed.
 */
export const GRID_MAX_RANGES = 15;

export type GridWeight = Readonly<{ tickId: number; weight: number }>;
export type GridLayout = "vertical" | "horizontal";

/** Why a value is not a grid that can be built — `format`: not 32 whole columns of 0 to 8 cells; `sides`: not painted both sides of the price — or null. */
export function gridFault(value: unknown): "format" | "sides" | null {
  if (!Array.isArray(value) || value.length !== GRID_COLUMNS || !value.every((cells) => Number.isInteger(cells) && cells >= 0 && cells <= GRID_LEVELS)) return "format";
  const columns = value as readonly number[];
  if (!columns.slice(0, GRID_SIDE).some((cells) => cells > 0) || !columns.slice(GRID_SIDE).some((cells) => cells > 0)) return "sides";
  return null;
}

/**
 * One side's 16 columns over its `steps` ticks, nearest the price first, as each tick's weight. A tick takes the
 * columns whose middles fall inside it — the mean of several where a side has fewer ticks than columns; where it has
 * more, the one column it stands under.
 */
function sideWeights(outward: readonly number[], steps: number): number[] {
  const taken = Array.from({ length: steps }, () => ({ cells: 0, count: 0 }));
  outward.forEach((cells, column) => {
    const tick = Math.min(steps - 1, Math.floor(((column + 0.5) * steps) / GRID_SIDE));
    taken[tick]!.cells += cells;
    taken[tick]!.count += 1;
  });
  return taken.map((tick, index) => {
    const mean = tick.count > 0 ? tick.cells / tick.count : outward[Math.min(GRID_SIDE - 1, Math.floor(((index + 0.5) * GRID_SIDE) / steps))]!;
    return Math.round(mean * GRID_CELL_WEIGHT);
  });
}

/**
 * The weight of every tick a grid stands on, from the farthest under the price to the farthest over it: `steps` ticks
 * of `spacing` each side of `here` — the first tick of the step the price stands in — and that step itself.
 */
export function gridWeights(columns: readonly number[], steps: number, here: number, spacing: number): GridWeight[] {
  const under = sideWeights(columns.slice(0, GRID_SIDE).reverse(), steps);
  const over = sideWeights(columns.slice(GRID_SIDE), steps);
  const middle = Math.round(((columns[GRID_SIDE - 1]! + columns[GRID_SIDE]!) / 2) * GRID_CELL_WEIGHT);
  return [
    ...under.map((weight, index) => ({ tickId: here - (index + 1) * spacing, weight })).reverse(),
    { tickId: here, weight: middle },
    ...over.map((weight, index) => ({ tickId: here + (index + 1) * spacing, weight })),
  ];
}

/** The runs of neighbouring ticks whose weight is at least `level`, as the SDK finds them: a lighter tick ends a run. */
function runsAtLevel(weights: readonly GridWeight[], spacing: number, level: number): string[] {
  const runs: { lower: number; upper: number }[] = [];
  for (const tick of weights) {
    if (tick.weight < level) continue;
    const last = runs[runs.length - 1];
    if (last && last.upper === tick.tickId) last.upper = tick.tickId + spacing;
    else runs.push({ lower: tick.tickId, upper: tick.tickId + spacing });
  }
  return runs.map((run) => `${run.lower}:${run.upper}`);
}

/**
 * How many ranges the SDK merges weights into either way it lays them (`buildLiquidityShape`): `vertical` — side by
 * side, a range per run of one weight; `horizontal` — stacked, a range per run of ticks at or above each weight, a run
 * the same as the level's below it taking the extra weight. Weights in the order of their ticks.
 */
export function rangesOfLayout(weights: readonly GridWeight[], spacing: number): Readonly<Record<GridLayout, number>> {
  let vertical = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const tick = weights[index]!;
    const before = weights[index - 1];
    if (tick.weight > 0 && !(before && before.weight === tick.weight && before.tickId + spacing === tick.tickId)) vertical += 1;
  }
  let horizontal = 0;
  let below = new Set<string>();
  for (const level of [...new Set(weights.map((tick) => tick.weight).filter((weight) => weight > 0))].sort((a, b) => a - b)) {
    const runs = runsAtLevel(weights, spacing, level);
    horizontal += runs.filter((run) => !below.has(run)).length;
    below = new Set(runs);
  }
  return { vertical, horizontal };
}

/** The layout of fewer ranges, and how many: side by side where both take as many. */
export function bestLayout(weights: readonly GridWeight[], spacing: number): Readonly<{ layout: GridLayout; ranges: number }> {
  const count = rangesOfLayout(weights, spacing);
  return count.horizontal < count.vertical ? { layout: "horizontal", ranges: count.horizontal } : { layout: "vertical", ranges: count.vertical };
}

/**
 * How many ranges a grid takes at a width of `steps` ticks a side — what a person is told before a Review. The count
 * stands on the ticks alone, never on where the pool's price is.
 */
export function gridRanges(columns: readonly number[], steps: number): number {
  const weights = gridWeights(columns, steps, 0, 1);
  const first = weights.findIndex((tick) => tick.weight > 0);
  const last = weights.findLastIndex((tick) => tick.weight > 0);
  return first < 0 ? 0 : bestLayout(weights.slice(first, last + 1), 1).ranges;
}
