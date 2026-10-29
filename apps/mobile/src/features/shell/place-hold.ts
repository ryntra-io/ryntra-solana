/**
 * While money is moving — a purchase, a sale, a swap or a send being prepared, signed, sent or checked — a place of the
 * bar asked for from outside the screen (a push note's tap, the launcher's quick action) waits: opening it closes the
 * screens over the bar, and with them the sheet the operation stands on. Each operation holds the places while it runs
 * (`usePlaceHold`); when the last one lets go, what waited opens. Pure: no React, no router.
 */

const holds = new Set<symbol>()
const listeners = new Set<() => void>()

/** Holds the places until the returned function is called; calling it again does nothing. */
export function holdPlaces(): () => void {
  const hold = Symbol('place-hold')
  holds.add(hold)
  return () => {
    if (!holds.delete(hold) || holds.size > 0) return
    for (const listener of [...listeners]) listener()
  }
}

/** Whether an operation holds the places now. */
export function placesHeld(): boolean {
  return holds.size > 0
}

/** Called each time the last hold lets go; returns the unsubscribe. */
export function onPlacesFree(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
