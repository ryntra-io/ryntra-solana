import { ApiError, isNetworkError } from '../../lib/api.ts'
import type {
  AssistantMemoryNote,
  AssistantMemoryResponse,
  AssistantProfile,
  AssistantProfileResponse,
  AssistantProfileUpdate,
  AssistantWalletPicture,
  QuietHours,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { MEMORY_COPY } from './memory-copy.ts'

/** The server's limits (1.59.0): «Про мене» up to 600 characters, a note up to 160 and at least 2. */
export const ABOUT_MAX = 600
export const NOTE_MAX = 160
export const NOTE_MIN = 2

export type Goal = NonNullable<AssistantProfile['goal']>
export type Experience = NonNullable<AssistantProfile['experience']>
export type Horizon = NonNullable<AssistantProfile['horizon']>
export type RiskPct = NonNullable<AssistantProfile['riskPct']>

export const GOALS: readonly Goal[] = ['learn', 'trade', 'hold']
export const EXPERIENCES: readonly Experience[] = ['new', 'some', 'pro']
export const RISKS: readonly RiskPct[] = [0.5, 1, 2]
export const HORIZONS: readonly Horizon[] = ['hours', 'days', 'weeks']

/** «0,5» in Ukrainian, «0.5» in English. */
export function pctText(value: number, locale: Locale): string {
  return locale === 'uk' ? String(value).replace('.', ',') : String(value)
}

/**
 * The answers of «Знайомство» in one line — «Ти: вчуся · новачок · ризик 1 % · дні» — or null when there are none
 * (never answered, skipped, or an answer missing).
 */
export function profileSummary(profile: AssistantProfile | null | undefined, locale: Locale): string | null {
  if (!profile || profile.skipped) return null
  const { goal, experience, riskPct, horizon } = profile
  if (goal === null || experience === null || riskPct === null || horizon === null) return null
  const copy = MEMORY_COPY[locale]
  return copy.summaryYou(
    [
      copy.summaryGoal[goal],
      copy.summaryExp[experience],
      copy.summaryRisk(pctText(riskPct, locale)),
      copy.summaryHorizon[horizon],
    ].join(' · '),
  )
}

/** The steps' answers as the card holds them; null where a question is not answered yet. */
export type MeetAnswers = Readonly<{
  goal: Goal | null
  experience: Experience | null
  riskPct: RiskPct
  horizon: Horizon | null
  telegram: boolean
  push: boolean
  quiet: boolean
}>

/** The window the quiet hours keep: the person's own where Нагляд has one, 23:00–08:00 by the phone's clock otherwise. */
export function quietWindowOf(read: AssistantProfileResponse, zone: string): QuietHours {
  return read.delivery.quietHours ?? { start: '23:00', end: '08:00', timezone: zone }
}

/** Where the card starts: the saved answers (1 % suggested), the delivery as read; quiet on for a first meeting. */
export function initialAnswers(read: AssistantProfileResponse): MeetAnswers {
  const profile = read.profile && !read.profile.skipped ? read.profile : null
  return {
    goal: profile?.goal ?? null,
    experience: profile?.experience ?? null,
    riskPct: profile?.riskPct ?? 1,
    horizon: profile?.horizon ?? null,
    telegram: read.delivery.telegram,
    push: read.delivery.push,
    quiet: read.delivery.quietHours !== null || profile === null,
  }
}

/** «Пропустити» — an answer too. */
export const SKIP_UPDATE: AssistantProfileUpdate = { skipped: true }

/** The `PUT` body of the four answers with where notes go; null while a question is unanswered. */
export function profileUpdateOf(answers: MeetAnswers, quietWindow: QuietHours): AssistantProfileUpdate | null {
  const { goal, experience, riskPct, horizon } = answers
  if (goal === null || experience === null || horizon === null) return null
  return {
    goal,
    experience,
    riskPct,
    horizon,
    delivery: { telegram: answers.telegram, push: answers.push, quietHours: answers.quiet ? quietWindow : null },
  }
}

/** Where a note came from, in words: «з розмови», «на твоє прохання», «додано вручну». */
export function noteSourceText(source: AssistantMemoryNote['source'], locale: Locale): string {
  return MEMORY_COPY[locale].memSource[source]
}

/** The notes newest first, as the sheet lists them. */
export function notesNewestFirst(notes: readonly AssistantMemoryNote[]): AssistantMemoryNote[] {
  return [...notes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** The notes of `after` whose id `before` did not hold — what a message just left. */
export function newNotes(before: ReadonlySet<string>, after: readonly AssistantMemoryNote[]): AssistantMemoryNote[] {
  return after.filter((note) => !before.has(note.id))
}

/** What the wallet shows now, in one quiet line; a dash when it was not read. */
export function walletLine(picture: AssistantWalletPicture | null | undefined, locale: Locale): string {
  const copy = MEMORY_COPY[locale]
  if (!picture || picture.state !== 'current' || picture.tokens === null) return copy.memWallet('—')
  const tokens = copy.memTokens(picture.tokens)
  const largest = picture.largest.slice(0, 3).map((row) => row.symbol)
  return copy.memWallet(largest.length > 0 ? copy.memWalletHolds(tokens, largest.join(', ')) : tokens)
}

/** A write's answer carries no fresh wallet read: the picture already shown stays. */
export function mergeMemory(
  before: AssistantMemoryResponse | undefined,
  next: AssistantMemoryResponse,
): AssistantMemoryResponse {
  return before && next.wallet.state !== 'current' ? { ...next, wallet: before.wallet } : next
}

/** Why a memory write failed: a secret the server refused, the network, or anything else. */
export type MemoryFailure = 'secret' | 'network' | 'failed'

export function memoryFailureOf(error: unknown): MemoryFailure {
  if (error instanceof ApiError && error.code === 'MEMORY_SECRET_REFUSED') return 'secret'
  return isNetworkError(error) ? 'network' : 'failed'
}
