/**
 * «Шлях компанії» on the phone — the pure half (M24; the web's
 * `RYN-COMPANY-PATH-001`, its `company-path-words.ts` and `company-path.tsx`).
 *
 * Where a company stands on its way from a private token to its stock on
 * Solana — **Приватна · PreStocks → IPO → Біржа → Solana**, each step passed,
 * current or not announced, with its day — and which step this page's token
 * is. The facts are the contract's only (`companyPath`, 1.17.0): the server
 * reads them from the company's filings, the issuer's notice and the token's
 * first pool; the phone says them in the web's words and days — «з 16.09.2025»,
 * «12.06.2026 · $135 за акцію», «Nasdaq · SPCX», «ще не оголошено».
 *
 * The page's own token stands at its step as «цей токен»; the company's other
 * token stands at its own step one tap from its page — SPACEX and SPCXx are
 * one company at two steps, each leading to the other, each saying what it is
 * («не акція · комісія 1%», «1:1 до акції · без голосу»). Under the steps, the
 * one line that matters to a holder: the private token's swap deadline with
 * the issuer's minute — on the private token's own page said to a holder as
 * «Обміняй …», to everyone else as «Власникам SPACEX: …» — or, for a company
 * still private, the issuer's rule after an IPO. Where each fact was read sits
 * one tap deeper, under «Джерела».
 *
 * What the answer states badly is not drawn: an unknown step, a token without
 * an address, a source without a secure link, a day that does not parse. No
 * judgement, no forecast. Pure: no fetch, no React; the clock is handed in, so
 * a deadline the phone's clock has passed reads as closed.
 */

import type { CompanyPath, PathToken } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { pathDay } from './company-facts.ts'
import type { CompanyPathCopy, PathStepId, PathStepState } from './company-path-copy.ts'

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

const STEP_IDS: readonly PathStepId[] = ['private', 'ipo', 'exchange', 'solana']
const STEP_STATES: readonly PathStepState[] = ['passed', 'current', 'unannounced']
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/
const SECURE_LINK = /^https:\/\/[^\s]+$/

const isStepId = (value: unknown): value is PathStepId => STEP_IDS.includes(value as PathStepId)
const isStepState = (value: unknown): value is PathStepState => STEP_STATES.includes(value as PathStepState)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** A token of the path as the answer names it — its address and its symbol — or null. */
function pathToken(value: unknown): PathToken | null {
  if (!value || typeof value !== 'object') return null
  const token = value as Record<string, unknown>
  return typeof token.mint === 'string' &&
    MINT.test(token.mint) &&
    typeof token.symbol === 'string' &&
    SYMBOL.test(token.symbol)
    ? { mint: token.mint, symbol: token.symbol }
    : null
}

/* ---- the words' figures ---- */

/** «$135» — the IPO's price as the web writes it. */
function usd(value: number, locale: Locale): string {
  return `$${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 2 }).format(value)}`
}

/** «12.03.2027, 23:59 UTC» — the issuer's cut-off with its minute; null when the time does not parse. */
export function pathDeadline(iso: string, locale: Locale): string | null {
  const day = pathDay(iso, locale)
  if (!day) return null
  const at = new Date(iso)
  return `${day}, ${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`
}

/**
 * What a token is, in the fewest words (canon §7): a private company's token is
 * not a share and pays the issuer's fee on every transfer — «не акція · комісія
 * 1%» where the chain states it; a listed share's token on Solana is backed one
 * to one and carries no vote.
 */
export function tokenNature(
  step: 'private' | 'solana',
  feeBps: number | null,
  words: CompanyPathCopy,
  locale: Locale,
): string {
  if (step === 'solana') return words.listedNature
  if (!isFiniteNumber(feeBps) || feeBps <= 0) return words.privateNature
  return words.privateNatureFee(
    `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 2 }).format(feeBps / 100)}%`,
  )
}

/* ---- the view ---- */

export type PathStepView = Readonly<{
  step: PathStepId
  state: PathStepState
  name: string
  /** The step's day and what happened on it, one or two lines. */
  lines: readonly string[]
  /**
   * The token at this step: the page's own — «цей токен» — or the company's
   * other one, a tap to its page; null on the steps between.
   */
  token: Readonly<{ mint: string; symbol: string; here: boolean; nature: string }> | null
}>

/** The line under the steps: the private token's swap deadline, or the issuer's rule while the company is private. */
export type PathLineView =
  Readonly<{ kind: 'swap'; text: string; open: boolean }> | Readonly<{ kind: 'rule'; text: string }>

export type PathSourceView = Readonly<{ key: string; line: string; url: string }>

export type CompanyPathView = Readonly<{
  /** The step this page's token stands at. */
  at: 'private' | 'solana'
  steps: readonly PathStepView[]
  line: PathLineView | null
  /** Where each fact was read, dated — one tap deeper. */
  sources: readonly PathSourceView[]
}>

/**
 * The line under a step: its day and what happened on it — «з 16.09.2025» for
 * the private token, «12.06.2026» and «$135 за акцію» for the IPO, «Nasdaq ·
 * SPCX» and «з 12.06.2026» for the exchange, «з 12.06.2026» for the token on
 * Solana; «ще не оголошено» for a step nobody announced; «зараз» for the step
 * the company stands at without a recorded day.
 */
export function stepLines(
  step: Readonly<{
    step: PathStepId
    state: PathStepState
    date: string | null
    priceUsd?: number | null
    exchange?: string | null
    ticker?: string | null
  }>,
  words: CompanyPathCopy,
  locale: Locale,
): readonly string[] {
  if (step.state === 'unannounced') return [words.notAnnounced]
  const day = step.date ? pathDay(step.date, locale) : null
  const since = day ? words.since(day) : null
  const lines: (string | null)[] =
    step.step === 'ipo'
      ? [day, isFiniteNumber(step.priceUsd) ? words.perShare(usd(step.priceUsd, locale)) : null]
      : step.step === 'exchange'
        ? [[step.exchange, step.ticker].filter(isText).join(' · '), since]
        : [since ?? (step.state === 'current' ? words.now : null)]
  return lines.filter(isText)
}

/**
 * The other token on the path — the company's token at the step this page's
 * token does not stand at: SPCXx on SPACEX's page, SPACEX on SPCXx's — or null.
 * Its own row says what it is (its issuer's fee), so the page reads it.
 */
export function otherPathToken(path: CompanyPath | null | undefined): PathToken | null {
  if (!path || !Array.isArray(path.steps as unknown)) return null
  const step = path.steps.find(
    (entry) => entry.step !== path.at && (entry.step === 'private' || entry.step === 'solana'),
  )
  return step ? pathToken(step.token) : null
}

/**
 * The strip a company's page draws from its row's `companyPath`, or null where
 * there is nothing to say. `privateFeeBps` is the private token's issuer fee as
 * the chain states it — the page's own on the private token's page, the private
 * token's own row on the listed token's; `holder` — the wallet holds this
 * page's token, so on the private token's own page its swap is said to a
 * holder.
 */
export function companyPathView(
  path: CompanyPath | null | undefined,
  input: Readonly<{ mint: string; privateFeeBps: number | null; holder: boolean; nowMs: number }>,
  words: CompanyPathCopy,
  locale: Locale,
): CompanyPathView | null {
  const at = path?.at === 'private' ? 'private' : path?.at === 'solana' ? 'solana' : null
  if (!path || !at || !Array.isArray(path.steps as unknown)) return null
  const steps: PathStepView[] = []
  for (const raw of path.steps) {
    if (!raw || !isStepId(raw.step) || !isStepState(raw.state)) continue
    const step = raw.step
    const token = step === 'private' || step === 'solana' ? pathToken(raw.token) : null
    steps.push({
      step,
      state: raw.state,
      name: words.steps[step],
      lines: stepLines(
        {
          step,
          state: raw.state,
          date: typeof raw.date === 'string' ? raw.date : null,
          priceUsd: raw.priceUsd,
          exchange: raw.exchange,
          ticker: raw.ticker,
        },
        words,
        locale,
      ),
      token:
        token && (step === 'private' || step === 'solana')
          ? {
              ...token,
              // The page's own step, and never a link to the page it is on.
              here: step === at || token.mint === input.mint,
              nature: tokenNature(step, step === 'private' ? input.privateFeeBps : null, words, locale),
            }
          : null,
    })
  }
  if (steps.length === 0) return null
  return { at, steps, line: pathLine(path, input, words, locale), sources: pathSources(path, words, locale) }
}

/**
 * The line under the steps (the web's `swapLines` and `swapRuleLine`): the
 * private token's swap with the issuer's minute — «Обміняй SPACEX на SPCXx до
 * 12.03.2027, 23:59 UTC — після строку токен згорить.» to a holder on its own
 * page, «Власникам SPACEX: обміняти на SPCXx до …» to everyone else — a closed
 * window said as closed, once the server or the phone's clock says so; for a
 * company still private, «Після IPO — до 9 місяців, щоб обміняти токен.»
 */
function pathLine(
  path: CompanyPath,
  input: Readonly<{ mint: string; holder: boolean; nowMs: number }>,
  words: CompanyPathCopy,
  locale: Locale,
): PathLineView | null {
  const swap = path.swap ?? null
  const from = swap ? pathToken(swap.from) : null
  const day = swap && typeof swap.deadline === 'string' ? pathDay(swap.deadline, locale) : null
  const by = swap && day ? pathDeadline(swap.deadline, locale) : null
  if (swap && from && day && by) {
    const open = swap.open === true && Date.parse(swap.deadline) > input.nowMs
    if (!open) return { kind: 'swap', text: words.swapClosed(from.symbol, day), open }
    const into = pathToken(swap.into)?.symbol ?? null
    const toHolder = input.holder && path.at === 'private' && from.mint === input.mint
    return {
      kind: 'swap',
      text: toHolder ? words.swapHolder(from.symbol, into, by) : words.swapEveryone(from.symbol, into, by),
      open,
    }
  }
  const months = path.swapMonths
  if (isFiniteNumber(months) && Number.isInteger(months) && months > 0)
    return { kind: 'rule', text: words.swapRule(months) }
  return null
}

/** A source's line: its name, the document's own day where it has one, and the day Ryntra read it. */
function pathSources(path: CompanyPath, words: CompanyPathCopy, locale: Locale): readonly PathSourceView[] {
  const list = path.sources
  if (!list || !Array.isArray(list as unknown)) return []
  return list.flatMap((source, index) => {
    if (!source || !isText(source.label) || typeof source.url !== 'string' || !SECURE_LINK.test(source.url)) return []
    const published = source.publishedAt ? pathDay(source.publishedAt, locale) : null
    const read = typeof source.readAt === 'string' ? pathDay(source.readAt, locale) : null
    const line = [source.label.trim(), published, read ? words.read(read) : null].filter(isText).join(' · ')
    return [{ key: `${index}-${source.url}`, line, url: source.url }]
  })
}
