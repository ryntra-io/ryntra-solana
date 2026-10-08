import type { Copy } from '../../lib/i18n.ts'

/**
 * The words of «Шлях компанії» — the web's own for the same strip
 * (its `company-path-words.ts`), word for word, so the
 * phone and ryntra.io say one thing: the steps' names, the line under each,
 * what each token is, the swap's deadline and the issuer's rule, where each
 * fact was read. No judgement, no advice.
 */

export type PathStepId = 'private' | 'ipo' | 'exchange' | 'solana'
export type PathStepState = 'passed' | 'current' | 'unannounced'

export type CompanyPathCopy = Readonly<{
  title: string
  steps: Readonly<Record<PathStepId, string>>
  /** «з 16.09.2025» — the day a step began. */
  since: (day: string) => string
  /** «$135 за акцію» — the IPO's offering price. */
  perShare: (usd: string) => string
  notAnnounced: string
  now: string
  thisToken: string
  /** What a listed share's token on Solana is. */
  listedNature: string
  /** What a private company's token is — with the issuer's fee on every transfer where the chain states one. */
  privateNature: string
  privateNatureFee: (fee: string) => string
  /** The private token's swap, said to a holder of it — on its own page. */
  swapHolder: (from: string, into: string | null, by: string) => string
  /** The private token's swap, said to everyone else. */
  swapEveryone: (from: string, into: string | null, by: string) => string
  swapClosed: (from: string, day: string) => string
  /** The issuer's rule while the company is private. */
  swapRule: (months: number) => string
  sources: string
  /** «прочитано 25.09.2026» — the day Ryntra read a source. */
  read: (day: string) => string
  /* for a screen reader */
  stepState: Readonly<Record<PathStepState, string>>
  openToken: (symbol: string) => string
  openSource: string
}>

const EN: CompanyPathCopy = {
  title: 'The company’s path',
  steps: { private: 'Private · PreStocks', ipo: 'IPO', exchange: 'Exchange', solana: 'Solana' },
  since: (day) => `since ${day}`,
  perShare: (usd) => `${usd} a share`,
  notAnnounced: 'not announced yet',
  now: 'now',
  thisToken: 'this token',
  listedNature: 'backed 1:1 · no vote',
  privateNature: 'not a share',
  privateNatureFee: (fee) => `not a share · ${fee} fee`,
  swapHolder: (from, into, by) =>
    `Swap your ${from}${into ? ` for ${into}` : ''} by ${by} — after the deadline the token expires worthless.`,
  swapEveryone: (from, into, by) =>
    `${from} holders: swap${into ? ` for ${into}` : ''} by ${by} — after the deadline ${from} expires worthless.`,
  swapClosed: (from, day) =>
    `The swap deadline for ${from} passed on ${day} — the issuer no longer supports the token.`,
  swapRule: (months) => `After an IPO — up to ${months} month${months === 1 ? '' : 's'} to swap the token.`,
  sources: 'Sources',
  read: (day) => `read ${day}`,
  stepState: { passed: 'passed', current: 'current step', unannounced: 'not announced yet' },
  openToken: (symbol) => `Open ${symbol}`,
  openSource: 'Opens the source in the browser',
}

const UK: CompanyPathCopy = {
  title: 'Шлях компанії',
  steps: { private: 'Приватна · PreStocks', ipo: 'IPO', exchange: 'Біржа', solana: 'Solana' },
  since: (day) => `з ${day}`,
  perShare: (usd) => `${usd} за акцію`,
  notAnnounced: 'ще не оголошено',
  now: 'зараз',
  thisToken: 'цей токен',
  listedNature: '1:1 до акції · без голосу',
  privateNature: 'не акція',
  privateNatureFee: (fee) => `не акція · комісія ${fee}`,
  swapHolder: (from, into, by) => `Обміняй ${from}${into ? ` на ${into}` : ''} до ${by} — після строку токен згорить.`,
  swapEveryone: (from, into, by) =>
    `Власникам ${from}: обміняти${into ? ` на ${into}` : ''} до ${by} — після строку ${from} згорить.`,
  swapClosed: (from, day) => `Строк обміну ${from} минув ${day} — емітент більше не підтримує токен.`,
  swapRule: (months) => `Після IPO — до ${months} ${months === 1 ? 'місяця' : 'місяців'}, щоб обміняти токен.`,
  sources: 'Джерела',
  read: (day) => `прочитано ${day}`,
  stepState: { passed: 'пройдено', current: 'поточний крок', unannounced: 'ще не оголошено' },
  openToken: (symbol) => `Відкрити ${symbol}`,
  openSource: 'Відкриває джерело в браузері',
}

export const COMPANY_PATH_COPY: Copy<CompanyPathCopy> = { en: EN, uk: UK }
