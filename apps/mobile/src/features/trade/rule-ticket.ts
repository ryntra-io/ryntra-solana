/**
 * Trade as a rule's purchase, and «Ринок · Регулярно».
 *
 * **«Ринок · Регулярно».** Beside the market order stands the recurring buy on
 * every token — a company, a coin, a meme or a new token — the rule's own
 * flow inside Trade: written there, managed there, its floor and its facts of
 * risk before the button.
 *
 * **Under a rule's reminder** (`/trade?mint=&rule=&due=` — where a token's
 * reminder lands) the ticket is the rule's purchase: a Buy, paid in USDC, the
 * rule's sum and nothing else, `origin.rule` on the order — the server judges
 * the reminder, the month's budget, the price condition and the floor again —
 * and the wallet's own signature on a fresh «Перевірка», as every purchase.
 * Anything but an open reminder of this market's rule is said in one line, and
 * no plain order stands in its place until the person leaves the rule.
 *
 * The words are the web's own (`app/solana/workspace/i18n/catalog.ts`); the
 * phone signs in its wallet where the web confirms it. Pure.
 */

import type { Copy, Locale } from '../../lib/i18n.ts'
import { ruleBuyState, type RuleBuyState } from '../autoinvest/rule-model.ts'

export const ORDER_TYPES = ['market', 'recurring'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export function orderTypeOf(value: unknown): OrderType {
  return value === 'recurring' ? 'recurring' : 'market'
}

/** The rule's purchase as the ticket reads it: the rule's own state, or a rule whose token is not this market. */
export type TicketRuleState = RuleBuyState | Readonly<{ kind: 'wrong-market' }>

export function ticketRuleState(input: Parameters<typeof ruleBuyState>[0] & Readonly<{ mint: string | null }>): TicketRuleState {
  const state = ruleBuyState(input)
  if ('rule' in state && state.rule.asset.mint !== input.mint) return { kind: 'wrong-market' }
  return state
}

/** A refusal of the order route under a rule, in the rule's words — never a plan's or an issuer's. Null for any other. */
export type TicketRuleRefusal =
  | 'floorWaits'
  | 'conditionWaits'
  | 'budgetWaits'
  | 'reminderNoLonger'
  | 'tokenUnreadable'
  | 'tokenFlagged'

export function ticketRuleRefusal(code: string | null | undefined): TicketRuleRefusal | null {
  switch (code) {
    case 'RULE_LIQUIDITY_LOW':
      return 'floorWaits'
    case 'RULE_PRICE_CONDITION':
      return 'conditionWaits'
    case 'RULE_BUDGET_EXHAUSTED':
      return 'budgetWaits'
    case 'RULE_NOT_DUE':
    case 'RULE_NOT_FOUND':
    case 'RULE_MISMATCH':
      return 'reminderNoLonger'
    // Under a rule these two are the rule's own: a token's figures unread, or a token flagged since the rule was written.
    case 'UNAVAILABLE':
      return 'tokenUnreadable'
    case 'ASSET_NOT_OFFERED':
      return 'tokenFlagged'
    default:
      return null
  }
}

export type RuleTicketCopy = Readonly<{
  orderType: string
  market: string
  recurring: string
  recurringGuest: string
  readingRule: string
  rulesDown: string
  notUnderRule: string
  byYourRule: string
  boughtByRule: string
  yourRule: string
  tradeWithoutRule: string
  signInForRule: string
  ruleGone: string
  wrongMarket: string
  reminderBought: string
  reminderPending: string
  ruleWaits: string
  reminderClosed: string
  rulePaused: string
  ruleHeld: string
  ruleReadFailed: string
  floorWaits: string
  conditionWaits: string
  budgetWaits: string
  reminderNoLonger: string
  tokenUnreadable: string
  tokenFlagged: string
}>

/** The one line a rule's chip says when the ticket is not its purchase — why, as the web's chip says it. */
export function ticketRuleLine(state: TicketRuleState, words: RuleTicketCopy): string | null {
  switch (state.kind) {
    case 'reading':
      return words.readingRule
    case 'read-failed':
      return words.ruleReadFailed
    case 'gone':
      return words.ruleGone
    case 'wrong-market':
      return words.wrongMarket
    case 'bought':
      return words.reminderBought
    case 'pending':
      return words.reminderPending
    case 'deferred':
      return words.ruleWaits
    case 'held':
      return words.ruleHeld
    case 'paused':
      return words.rulePaused
    case 'closed':
      return words.reminderClosed
    default:
      return null
  }
}

export const RULE_TICKET_COPY: Copy<RuleTicketCopy> = {
  en: {
    orderType: 'Order type',
    market: 'Market',
    recurring: 'Recurring',
    recurringGuest: 'A rule reminds you on its day — you sign every purchase. Your money stays in your wallet.',
    readingRule: 'Reading the rule…',
    rulesDown: 'Your rules could not be read right now.',
    notUnderRule: 'Not under this rule',
    byYourRule: 'By your rule',
    boughtByRule: 'Bought by your rule',
    yourRule: 'Your rule',
    tradeWithoutRule: 'Trade without the rule',
    signInForRule: 'Sign in with your wallet to buy by your rule.',
    ruleGone: 'This rule is no longer in your wallet.',
    wrongMarket: 'This market is not the rule’s token.',
    reminderBought: 'This reminder’s purchase is already bought.',
    reminderPending: 'A purchase under this reminder is already on its way.',
    ruleWaits: 'The rule’s purchase waits — its rule says why.',
    reminderClosed: 'This reminder has closed. The next one comes on the rule’s day.',
    rulePaused: 'This rule is paused — no reminders come.',
    ruleHeld: 'What is left of this month’s budget does not cover the rule’s purchase.',
    ruleReadFailed: 'Your rule could not be read right now.',
    floorWaits: 'The token’s pool is under the floor for a recurring buy now — the rule’s purchase waits.',
    conditionWaits: 'The rule’s price condition is not met right now — its purchase waits.',
    budgetWaits: 'What is left of this month’s budget does not cover the rule’s purchase.',
    reminderNoLonger: 'This reminder can no longer be bought — read the rule again.',
    tokenUnreadable: 'The token’s liquidity or price cannot be read right now — try again in a moment.',
    tokenFlagged: 'Jupiter’s audit flags this token, or Ryntra no longer supports it — the rule does not buy it.',
  },
  uk: {
    orderType: 'Тип ордера',
    market: 'Ринок',
    recurring: 'Регулярно',
    recurringGuest: 'Правило нагадає в його день — кожну купівлю підписуєш ти. Гроші лишаються у твоєму гаманці.',
    readingRule: 'Читаємо правило…',
    rulesDown: 'Правила зараз не вдалося прочитати.',
    notUnderRule: 'Не за цим правилом',
    byYourRule: 'За правилом',
    boughtByRule: 'Куплено за правилом',
    yourRule: 'Твоє правило',
    tradeWithoutRule: 'Купити без правила',
    signInForRule: 'Увійди гаманцем, щоб купити за правилом.',
    ruleGone: 'Цього правила вже немає у твоєму гаманці.',
    wrongMarket: 'Цей ринок — не токен правила.',
    reminderBought: 'Купівлю за цим нагадуванням уже зроблено.',
    reminderPending: 'Купівля за цим нагадуванням уже в дорозі.',
    ruleWaits: 'Купівля за правилом чекає — чому, сказано в правилі.',
    reminderClosed: 'Це нагадування вже не діє. Наступне прийде в день правила.',
    rulePaused: 'Це правило на паузі — нагадування не приходять.',
    ruleHeld: 'Залишок бюджету місяця не покриває купівлю за правилом.',
    ruleReadFailed: 'Правило зараз не вдалося прочитати.',
    floorWaits: 'Пул токена зараз нижче порогу регулярної купівлі — купівля за правилом чекає.',
    conditionWaits: 'Умова ціни правила зараз не виконана — купівля чекає.',
    budgetWaits: 'Залишок бюджету місяця не покриває купівлю за правилом.',
    reminderNoLonger: 'За цим нагадуванням уже не купити — прочитай правило знову.',
    tokenUnreadable: 'Ліквідність чи ціну токена зараз не прочитати — спробуй за мить.',
    tokenFlagged: 'Аудит Jupiter позначає цей токен або Ryntra його більше не підтримує — правило його не купує.',
  },
}

/** «Щотижня · ср о 19:00» → «щотижня · ср о 19:00»: only the first letter, so «Wed» keeps its own. */
export function lowerFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

/** The sum as typed by hand into the ticket, in the field's own language: «5», «5.50» · «5,50» — never «5.00». */
export function ruleSumText(usd: number, locale: Locale): string {
  const text = Number.isInteger(usd) ? String(usd) : usd.toFixed(2)
  return locale === 'uk' ? text.replace('.', ',') : text
}
