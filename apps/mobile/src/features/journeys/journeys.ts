/**
 * Journeys — the app's own record of where a person went, pure.
 *
 * Home is judged by whether it shortens the way to an asset, a plan, a
 * Review and back from a note. The phone keeps a short ring of those
 * transitions for the person who tests it and for the founder who reads the
 * test: the name of the step, where it started, where it led, the account
 * state, the time — and nothing else. No address, no session, no amount,
 * no plan text, no note text and no identifier of a record ever enters a
 * journey; the sanitizer refuses them by shape. The record lives on the
 * device only until the web line publishes an events route (request 25).
 */

export const JOURNEY_NAMES = [
  /** Home came on screen, with the account's state. */
  'home_view',
  /** A tap on Home led somewhere: `to` names the surface. */
  'home_go',
  /** A note or a card was opened from a surface: `from` names it, `target` what it resolved to. */
  'note_open',
  /** A push notification was tapped. */
  'note_tap',
  /** The resolver screen opened for a link the phone received. */
  'note_resolve',
  /** A plan's Review was started from its detail. */
  'plan_review',
] as const

export type JourneyName = (typeof JOURNEY_NAMES)[number]

export type Journey = Readonly<{
  at: string
  name: JourneyName
  state?: 'guest' | 'connected' | 'signed-in'
  from?: string
  to?: string
  target?: string
}>

/** How many journeys the device keeps; the oldest leaves first. */
export const JOURNEY_LIMIT = 200

const WORD = /^[a-z][a-z0-9-]{0,31}$/
const STATES = new Set(['guest', 'connected', 'signed-in'])

/** A short lower-case word only: a surface, a kind — never an id, an address or a sentence. */
function word(value: unknown): string | undefined {
  return typeof value === 'string' && WORD.test(value) ? value : undefined
}

/**
 * The entry as it may be kept — or null when it is not a journey. Every
 * field is a word from a closed shape; anything else is dropped, so a
 * caller cannot leak a figure or a text by mistake.
 */
export function sanitizeJourney(entry: unknown): Journey | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  if (typeof raw.name !== 'string' || !(JOURNEY_NAMES as readonly string[]).includes(raw.name)) return null
  if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) return null
  const journey: { -readonly [K in keyof Journey]: Journey[K] } = { at: raw.at, name: raw.name as JourneyName }
  const state = typeof raw.state === 'string' && STATES.has(raw.state) ? (raw.state as Journey['state']) : undefined
  if (state) journey.state = state
  const from = word(raw.from)
  if (from) journey.from = from
  const to = word(raw.to)
  if (to) journey.to = to
  const target = word(raw.target)
  if (target) journey.target = target
  return journey
}

/** The list with one more at the end, the oldest dropped past the limit. */
export function appendJourney(list: readonly Journey[], entry: Journey, limit = JOURNEY_LIMIT): readonly Journey[] {
  const next = [...list, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** Whatever the store held, back into journeys — the ones that pass the sanitizer, never a crash. */
export function parseJourneys(stored: string | null | undefined): readonly Journey[] {
  if (!stored) return []
  try {
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value)) return []
    return value.map(sanitizeJourney).filter((entry): entry is Journey => entry !== null)
  } catch {
    return []
  }
}

export function serializeJourneys(list: readonly Journey[]): string {
  return JSON.stringify(list)
}

export type JourneySummary = Readonly<{
  count: number
  byName: Readonly<Record<JourneyName, number>>
  /** Where Home's taps led, by surface. */
  homeGoTo: Readonly<Record<string, number>>
  first: string | null
  last: string | null
}>

/** The counts a reader wants first: how many, of what, where Home led. */
export function summarizeJourneys(list: readonly Journey[]): JourneySummary {
  const byName = Object.fromEntries(JOURNEY_NAMES.map((name) => [name, 0])) as Record<JourneyName, number>
  const homeGoTo: Record<string, number> = {}
  for (const entry of list) {
    byName[entry.name] += 1
    if (entry.name === 'home_go' && entry.to) homeGoTo[entry.to] = (homeGoTo[entry.to] ?? 0) + 1
  }
  return {
    count: list.length,
    byName,
    homeGoTo,
    first: list[0]?.at ?? null,
    last: list[list.length - 1]?.at ?? null,
  }
}

/** One journey as a line a reader scans: the time, the name, the words it carries. */
export function journeyLine(entry: Journey): string {
  const parts: string[] = [entry.name]
  if (entry.state) parts.push(entry.state)
  if (entry.from) parts.push(`from ${entry.from}`)
  if (entry.to) parts.push(`→ ${entry.to}`)
  if (entry.target) parts.push(`(${entry.target})`)
  return parts.join(' ')
}
