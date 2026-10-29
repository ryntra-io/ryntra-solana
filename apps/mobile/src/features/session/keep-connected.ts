/**
 * «Тримати під’єднаним» — how long the connected wallet and its sign-in stay
 * on this phone. Pure: the choice, when the
 * chosen time started, and whether it has run out — the store and the
 * binders around it hand in the clock.
 *
 * Nothing ends the connection but the person: «Відключити гаманець», or the
 * time the person chose here running out. A restart, a lost network or the
 * wallet app closed end nothing.
 */

export type KeepFor = 'hour' | 'twoHours' | 'day' | 'untilSignOut'

/** In the order the row draws them. */
export const KEEP_CHOICES: readonly KeepFor[] = ['hour', 'twoHours', 'day', 'untilSignOut']

/** A wallet connected is kept until the person signs out, unless the person chose a time. */
export const KEEP_DEFAULT: KeepFor = 'untilSignOut'

const HOUR_MS = 60 * 60 * 1000

/** How long each choice keeps the wallet; «поки не вийду» has no end of its own. */
export const KEEP_MS: Readonly<Record<KeepFor, number | null>> = {
  hour: HOUR_MS,
  twoHours: 2 * HOUR_MS,
  day: 24 * HOUR_MS,
  untilSignOut: null,
}

/** The choice and the moment its time started: the choice itself or a connect, whichever came last. */
export type KeepChoice = Readonly<{ keep: KeepFor; since: number }>

export function keepChoice(keep: KeepFor, since: number): KeepChoice {
  return { keep, since }
}

/**
 * The person taps a choice: a different one starts its time now; the one
 * already chosen changes nothing — a tap on the selected «2 год» never moves
 * the end it shows.
 */
export function rechoose(current: KeepChoice, keep: KeepFor, now: number): KeepChoice {
  return current.keep === keep ? current : keepChoice(keep, now)
}

/**
 * A connect that did not happen (cancelled in the wallet, refused, failed):
 * the clock it started is taken back and the choice before it returns — but
 * only while the store still holds what that connect wrote, so a choice made
 * meanwhile is never undone.
 */
export function afterFailedConnect(current: KeepChoice, started: KeepChoice, previous: KeepChoice): KeepChoice {
  return current.keep === started.keep && current.since === started.since ? previous : current
}

/** When the chosen time runs out, or null when the person keeps the wallet until signing out. */
export function keepUntil(choice: KeepChoice): number | null {
  const span = KEEP_MS[choice.keep]
  return span === null ? null : choice.since + span
}

/** True once the chosen time has run out — the one moment the phone ends the connection itself. */
export function keepEnded(choice: KeepChoice, now: number): boolean {
  const until = keepUntil(choice)
  return until !== null && now >= until
}

/** The stored choice back into a value; anything unreadable is the default, never an end. */
export function parseKeepChoice(raw: string | null | undefined, now: number): KeepChoice {
  if (!raw) return keepChoice(KEEP_DEFAULT, now)
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return keepChoice(KEEP_DEFAULT, now)
    const { keep, since } = value as Record<string, unknown>
    if (typeof keep !== 'string' || !(KEEP_CHOICES as readonly string[]).includes(keep)) {
      return keepChoice(KEEP_DEFAULT, now)
    }
    // A start in the future (a clock set back) counts from now, so the time never runs longer than chosen.
    const start = typeof since === 'number' && Number.isFinite(since) ? Math.min(since, now) : now
    return keepChoice(keep as KeepFor, start)
  } catch {
    return keepChoice(KEEP_DEFAULT, now)
  }
}

export function serializeKeepChoice(choice: KeepChoice): string {
  return JSON.stringify({ keep: choice.keep, since: choice.since })
}

/** Timers past this are clamped (a JS timer overflows at 2^31 − 1 ms); the timer is set again when it fires. */
export const LONGEST_TIMER_MS = 2_147_483_647

/** The wait before a timer for `at`, from `now`: at least a second, never past what a timer can hold. */
export function timerDelay(at: number, now: number): number {
  return Math.min(LONGEST_TIMER_MS, Math.max(1_000, at - now))
}
