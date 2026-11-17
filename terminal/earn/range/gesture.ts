/**
 * How a pointer moves the range on the bins chart, as a pure step function the chart wires to its events.
 *
 * - A mouse pressed on the bars sets the width where it is pressed and follows while held.
 * - A mouse pressed on an edge's grip changes nothing until it moves: the edge then follows the pointer, kept at the
 *   distance from the edge the press began at — a press is never a jump.
 * - A finger, on the bars or on a grip, changes nothing until it moves across — sideways farther than down, and by more
 *   than a few pixels: a finger that starts a scroll down the ticket scrolls it. A tap changes nothing.
 *
 * The positions are the chart's own pixels across; `set` is where, in those pixels, the width is to be read.
 */

/** A finger's move across before the width follows it, px. */
export const DRAG_START_PX = 6;

export type Press = Readonly<{
  id: number;
  x: number;
  y: number;
  touch: boolean;
  /** Added to the pointer's x to find where the width is read: the press's distance from its edge; 0 on the bars. */
  offset: number;
  /** Whether the width follows the pointer now. */
  live: boolean;
}>;

export type Step = Readonly<{ press: Press | null; set: number | null; capture: boolean }>;

/** A pointer pressed: on the bars (`edgeX` null) or on an edge's grip at `edgeX`. */
export function pressDown(pointer: Readonly<{ id: number; x: number; y: number; touch: boolean }>, edgeX: number | null): Step {
  const offset = edgeX === null ? 0 : edgeX - pointer.x;
  if (pointer.touch) return { press: { ...pointer, offset, live: false }, set: null, capture: false };
  // A mouse on the bars sets the width where it is pressed; on a grip it only takes hold of the edge.
  return { press: { ...pointer, offset, live: true }, set: edgeX === null ? pointer.x : null, capture: true };
}

/** The pressed pointer moved. Another pointer's move, or a move with nothing pressed, changes nothing. */
export function pressMove(press: Press | null, pointer: Readonly<{ id: number; x: number; y: number }>): Step {
  if (!press || press.id !== pointer.id) return { press, set: null, capture: false };
  if (press.live) return { press, set: pointer.x + press.offset, capture: false };
  const across = Math.abs(pointer.x - press.x);
  const down = Math.abs(pointer.y - press.y);
  if (across < DRAG_START_PX || across <= down) return { press, set: null, capture: false };
  return { press: { ...press, live: true }, set: pointer.x + press.offset, capture: true };
}
