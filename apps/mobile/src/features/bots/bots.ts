/**
 * «Боти» — everything that runs on a person's rule, in one place,
 * the web's own (`app/app/bots`): «Мої боти» gathers the recurring-buy rules
 * (Ryntra reminds, the person signs every buy) and the trade plans, each plan
 * with its result on its card; «Каталог» holds what can be set up today.
 * Pure: the words, the tabs and a plan's result line.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { PlanNoTradeReason, PlanResultsResponse, RuleStatus } from '../../lib/api/v1/types.ts'

export const BOTS_TABS = ['mine', 'catalog'] as const
export type BotsTab = (typeof BOTS_TABS)[number]

export function botsTabOf(value: unknown): BotsTab {
  return value === 'catalog' ? 'catalog' : 'mine'
}

/** How many things run now: the rules that are on and the plans that are active — nothing counted that is not stated. */
export function activeCount(
  rules: readonly Readonly<{ status: RuleStatus }>[] | null,
  plans: readonly Readonly<{ status: string }>[] | null,
): number | null {
  if (rules === null && plans === null) return null
  return (
    (rules ?? []).filter((rule) => rule.status === 'active').length +
    (plans ?? []).filter((plan) => plan.status === 'active').length
  )
}

export type PlanResultLine = Readonly<{ text: string; tone: 'fg' | 'success' | 'danger' | 'muted' }>

/**
 * A plan's result as its card says it — the server's figures, never
 * recomputed: a closed position's realised sum, an open one's cost of entry,
 * a plan that made no trade and why. Null where the results say nothing of it.
 */
export function planResultLine(
  feed: PlanResultsResponse | null,
  planId: string,
  words: Readonly<{
    open: string
    closed: string
    costBasis: string
    realised: string
    noTrade: Readonly<Record<PlanNoTradeReason, string>>
    usd: (value: number) => string
    signed: (value: number) => string
  }>,
): PlanResultLine | null {
  if (!feed) return null
  const row = feed.positions.find((candidate) => candidate.planId === planId)
  if (row) {
    const position = row.position
    if (position.state === 'closed') {
      const realised = position.realisedUsd
      return {
        text: realised === null ? words.closed : `${words.closed} · ${words.realised} ${words.signed(realised)}`,
        tone: realised === null ? 'muted' : realised > 0 ? 'success' : realised < 0 ? 'danger' : 'fg',
      }
    }
    const basis = position.costBasisUsd
    return { text: basis === null ? words.open : `${words.open} · ${words.costBasis} ${words.usd(basis)}`, tone: 'fg' }
  }
  const outcome = feed.outcomes.find((candidate) => candidate.planId === planId)
  if (outcome) return { text: words.noTrade[outcome.reason] ?? words.noTrade['entry-bound-unmet'], tone: 'muted' }
  return null
}

export type BotsCopy = Readonly<{
  title: string
  tabs: Readonly<Record<BotsTab, string>>
  plans: string
  createPlan: string
  results: string
  recurring: string
  recurringWhat: string
  recurringHow: string
  recurringFor: string
  pickToken: string
  /** The search sheet «Обрати токен» opens over Bots: what the token is chosen for. */
  pickTokenFor: string
  myRules: string
  planName: string
  planWhat: string
  askRyntra: string
  /** What the wallet gate says is private: the person's own bots. */
  gateWhat: string
  positionOpen: string
  positionClosed: string
}>

/** The web's words (`app/app/bots/bots-words.ts`), in both languages; the Ukrainian speaks «ти». */
export const BOTS_COPY: Copy<BotsCopy> = {
  en: {
    title: 'Bots',
    tabs: { mine: 'My bots', catalog: 'Catalog' },
    plans: 'Trade plans',
    createPlan: 'Create a plan',
    results: 'Results',
    recurring: 'Recurring buy',
    recurringWhat:
      'Buys any token every day, week or month, when its price falls or from every payment — within a monthly budget you set.',
    recurringHow: 'Ryntra reminds you; you sign each buy. Your money stays in your wallet.',
    recurringFor:
      'Stocks, coins and memes. A meme or a new token needs $25,000 of liquidity and 24 hours on the market.',
    pickToken: 'Choose a token',
    pickTokenFor: 'Token for a recurring buy',
    myRules: 'My rules',
    planName: 'Trade plan',
    planWhat: 'Your own rules for one trade: entry, size, stop and target.',
    askRyntra: 'Ask Ryntra',
    gateWhat: 'Your bots',
    positionOpen: 'Position open',
    positionClosed: 'Position closed',
  },
  uk: {
    title: 'Боти',
    tabs: { mine: 'Мої боти', catalog: 'Каталог' },
    plans: 'Плани угод',
    createPlan: 'Створити план',
    results: 'Результати',
    recurring: 'Регулярна купівля',
    recurringWhat:
      'Купує будь-який токен щодня, щотижня, щомісяця, коли ціна впаде або з кожної оплати — у межах бюджету місяця, який ставиш ти.',
    recurringHow: 'Ryntra нагадує, кожну купівлю підписуєш ти. Гроші лишаються у твоєму гаманці.',
    recurringFor: 'Акції, монети й меми. Мем чи новий токен — від $25 000 ліквідності й 24 годин на ринку.',
    pickToken: 'Обрати токен',
    pickTokenFor: 'Токен для регулярної купівлі',
    myRules: 'Мої правила',
    planName: 'План угоди',
    planWhat: 'Твої правила однієї угоди: вхід, розмір, стоп і ціль.',
    askRyntra: 'Спитати Ryntra',
    gateWhat: 'Твої боти',
    positionOpen: 'Позиція відкрита',
    positionClosed: 'Позиція закрита',
  },
}
