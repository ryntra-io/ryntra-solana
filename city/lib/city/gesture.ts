/**
 * The city's touch gestures (CITY-6a), the pure half: a tap that picks a tower, and the twist of two fingers that
 * turns the city. Pinch and the two-finger drag are the camera controls' own; this file decides only what they leave.
 */

export type Point = { x: number; y: number };

/** A tap: one finger the whole time, lifted within `ms` and no further than `px` from where it landed. */
export const TAP = Object.freeze({ px: 8, ms: 350 });

/**
 * One press on the canvas, from the first finger down to the last finger up. More than one finger at any moment
 * makes it a gesture (a pinch, a twist), never a tap, even if a finger is then lifted on its own.
 */
export class Press {
  private start: (Point & { t: number }) | null = null;
  private fingers = new Set<number>();
  private many = false;

  down(id: number, p: Point, t: number): void {
    if (!this.fingers.size) {
      this.start = { ...p, t };
      this.many = false;
    }
    this.fingers.add(id);
    if (this.fingers.size > 1) this.many = true;
  }

  /** Lifts a finger; true when that lift ends a tap. */
  up(id: number, p: Point, t: number): boolean {
    if (!this.fingers.delete(id)) return false;
    if (this.fingers.size) return false;
    const s = this.start;
    this.start = null;
    if (!s || this.many) return false;
    return Math.hypot(p.x - s.x, p.y - s.y) <= TAP.px && t - s.t < TAP.ms;
  }

  /**
   * A new first finger: whatever the last press left behind (a finger lifted off the canvas, over a sheet, is never
   * seen here) is forgotten.
   */
  reset(): void {
    this.fingers.clear();
    this.start = null;
    this.many = false;
  }

  /** A finger the browser took away (a system gesture, a scroll elsewhere): the press is no tap. */
  cancel(id: number): void {
    if (!this.fingers.delete(id)) return;
    this.many = true;
    if (!this.fingers.size) this.start = null;
  }
}

/**
 * How far two fingers turned between two moments, in radians, on the screen (y down, so clockwise is positive):
 * the angle of the line between them now minus before, kept within ±π so a turn across the ±π seam stays small.
 */
export function twist(a0: Point, b0: Point, a1: Point, b1: Point): number {
  const before = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const now = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  let d = now - before;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Fingers closer than this (CSS px) give no usable angle: their twist is noise. */
export const TWIST_MIN_SPAN = 40;
