/**
 * Words heard by the phone's speech to text joined to what is already in the composer — pure. Voice is input only:
 * the result is the person's to read and edit, never sent by itself. A space between, the heard words' first letter
 * kept as heard, the whole cut at the question's limit.
 */
export function withSpokenWords(current: string, heard: string, max: number): string {
  const words = heard.replace(/\s+/g, ' ').trim()
  if (!words) return current
  const before = current.replace(/\s+$/, '')
  const joined = before ? `${before} ${words}` : words
  return joined.slice(0, max)
}

/**
 * When the next brief comes, said in the brief's own zone (the time the person chose, «09:00 за Києвом»), never in the
 * phone's: «today», «tomorrow» or the day, and the clock there. Null when the moment cannot be read.
 */
export function briefMomentInZone(
  iso: string | null,
  zone: string,
  now: number,
): Readonly<{ day: 'today' | 'tomorrow' | string; time: string }> | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  try {
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false })
    const day = dayOf.format(new Date(at))
    const today = dayOf.format(new Date(now))
    const tomorrow = dayOf.format(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000))
    return { day: day === today ? 'today' : day === tomorrow ? 'tomorrow' : day, time: clock.format(new Date(at)) }
  } catch {
    return null
  }
}

/* ── The language spoken, and the paid fallback: a recording heard on Ryntra's server (AI-08, 1.64.0) ── */

/**
 * The language the microphone listens in — the person's, not the app's (the operator, 21.10: «привіт, як діла» heard by
 * an English recogniser as «private private yoga»): the one the person chose; before a choice, Ukrainian when the
 * phone's own language is Ukrainian or the app speaks it, else the app's.
 */
export function speechLanguage(appLocale: 'en' | 'uk', deviceTag: string, stored: string | null): 'en' | 'uk' {
  if (stored === 'uk' || stored === 'en') return stored
  if (deviceTag.toLowerCase().split(/[-_]/)[0] === 'uk') return 'uk'
  return appLocale
}

/** The longest recording the server hears (contract `ASSISTANT_VOICE_MAX_SECONDS`). */
export const RECORDING_MAX_SECONDS = 120
/** Credits are counted per each started block of this many seconds. */
export const RECORDING_BLOCK_SECONDS = 30

/** What hearing `seconds` costs: `perBlock` credits (`prices.voice`) for each started 30 s — 1 s … 30 s is one block. */
export function recordingCredits(seconds: number, perBlock: number): number {
  return Math.ceil(Math.max(1, Math.ceil(seconds)) / RECORDING_BLOCK_SECONDS) * perBlock
}

/** `0:07`, `1:30` — a recording's length as the line reads it. */
export const clockOf = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/**
 * Why a recording did not become words: the microphone, the length, a recording the server could not read, the
 * credits, the day's ceiling, the deployment's day of voice, the price that moved, nothing heard, or the server.
 */
export type RecordingProblem =
  | 'denied'
  | 'recorder'
  | 'failed'
  | 'silence'
  | 'tooLong'
  | 'unreadable'
  | 'noCredits'
  | 'dayCap'
  | 'daySpent'
  | 'priceChanged'

export function recordingProblemOf(code: string | null | undefined): RecordingProblem {
  switch (code) {
    case 'VOICE_TOO_LONG':
      return 'tooLong'
    case 'VOICE_NOT_HEARD':
      return 'silence'
    case 'VALIDATION_ERROR':
      return 'unreadable'
    case 'AGENT_BUDGET_EXHAUSTED':
      return 'noCredits'
    case 'CREDITS_DAY_CAP':
      return 'dayCap'
    case 'VOICE_DAY_SPENT':
      return 'daySpent'
    case 'VOICE_PRICE_NOT_SHOWN':
      return 'priceChanged'
    default:
      return 'failed'
  }
}

/**
 * A recording waits to be sent again only where a second press can work: the price moved (read anew) or the server
 * did not answer — sent again under its own id, it is never charged twice. Any other refusal lets it go.
 */
export const recordingKept = (problem: RecordingProblem): boolean => problem === 'priceChanged' || problem === 'failed'

/** A recording's own id, made when it stops: sent again, the server answers it with the same words and charges nothing. */
export function recordingId(random: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = random(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
