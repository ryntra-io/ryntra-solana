/**
 * The keyboard lift's arithmetic, apart from React so a test reads it: where
 * the keyboard's top edge stands and how far the page scrolls to keep the
 * button above it.
 */

/** Room kept between what must stay seen and the keyboard's top edge. */
export const EDGE = 12

export type Board = Readonly<{
  /** The keyboard's top edge in the window. */
  top: number
  /** What the page gains at its end while the keyboard is up — its height and the navigation bar under it. */
  room: number
}>

/**
 * Where the keyboard's top edge stands. Android reports the keyboard's height
 * without the navigation bar beneath it (`ReactRootView`: the IME inset less
 * the system bars), so the height alone puts the edge too low by that bar —
 * a three-button bar hides the button under the keys. The edge the event
 * gives (`screenY`, the visible frame's bottom) is taken; the height stands in
 * only when no edge is given.
 */
export function boardOf(screenY: number, height: number, screenHeight: number): Board {
  const top = screenY > 0 && screenY < screenHeight ? screenY : screenHeight - height
  return { top, room: Math.max(height, screenHeight - top) }
}

/**
 * How far the page scrolls, in its own coordinates, so `bottom` ends `EDGE`
 * above the keyboard — never past the point where `top` would leave the
 * frame's top (what is typed is never hidden to show the button); null when it
 * already stands clear. An absolute aim: a second look while the first scroll
 * still runs aims at the same place instead of adding to it.
 */
export function liftAim(
  at: Readonly<{
    /** The page's scroll now. */
    offset: number
    /** The scrolling frame's top edge in the window. */
    frameTop: number
    keyboardTop: number
    /** The field's top, in the page's coordinates. */
    topY: number
    /** The button's top and height, in the page's coordinates. */
    bottomY: number
    bottomHeight: number
  }>,
): number | null {
  const need = at.bottomY + at.bottomHeight + EDGE - (at.keyboardTop - at.frameTop)
  const aim = Math.max(0, Math.min(need, at.topY - EDGE))
  return aim > at.offset + 1 ? aim : null
}

/**
 * The aim a look acts on: null when the page was already sent to that very place (within a pixel) and nothing has
 * changed since — a second look while the scroll still runs does not start it again. The place sent to is forgotten
 * whenever the page's size changes, the keyboard comes or goes, the person scrolls or the target changes: a scroll the
 * page could not finish (its end not yet grown by the keyboard's room — ST-5 r7, «Своя сума» left under the keys on a
 * first focus) is sent again once there is room for it, rather than taken as done.
 */
export function freshAim(aim: number | null, sent: number | null): number | null {
  if (aim === null) return null
  return sent !== null && Math.abs(aim - sent) <= 1 ? null : aim
}
