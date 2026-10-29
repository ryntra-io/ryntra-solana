/**
 * The swap's stopwatch (ST-3): each step a person waits on — the price, «Перевірка», the wallet opening, its answer,
 * «Готово» — marked with the moment it happened, so a development build's log reads how long each one took. A
 * person never sees it, a release build writes nothing, and no figure, address or secret is in a mark.
 */

let started = 0
let last = 0

/** Mark one step. `begin` starts a new run (a key pressed, «Перевірка» pressed, the wallet asked). */
export function clockMark(step: string, begin = false): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return
  const now = Date.now()
  if (begin || started === 0) started = now
  const since = now - started
  const gap = last === 0 ? 0 : now - last
  last = now
  console.log(`[clock] ${now} ${step} +${since}ms (gap ${gap}ms)`)
}
