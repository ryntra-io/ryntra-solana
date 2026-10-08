/**
 * «Поскаржитися на токен» — a token launched on Ryntra carries what its
 * creator wrote and chose: the name, the ticker, the picture, the description
 * and the links. A person who finds any of it offensive, an impersonation or
 * a scam writes to Ryntra's one inbox from the token's page; the letter names
 * the token by its address and its page, so the team reads the same token.
 * The phone only writes the letter — nothing is sent until the person sends it.
 */

import { SUPPORT_EMAIL } from '../session/account-deletion.ts'

/** Where the person finds the same inbox when the phone has no mail app. */
export const SUPPORT_PAGE_URL = 'https://ryntra.io/support'

type Facts = Readonly<{ mint: string; symbol: string; name: string; page: string; reporter: string | null }>

const LETTER = {
  en: {
    subject: (facts: Facts) => `Report a token: $${facts.symbol}`,
    body: (facts: Facts) =>
      [
        `Token: ${facts.name} ($${facts.symbol})`,
        `Address: ${facts.mint}`,
        `Page: ${facts.page}`,
        '',
        'What is wrong (an impersonation, an offensive picture or text, a scam, something else):',
        '',
        '',
        ...(facts.reporter ? [`My wallet: ${facts.reporter}`] : []),
      ].join('\n'),
  },
  uk: {
    subject: (facts: Facts) => `Скарга на токен: $${facts.symbol}`,
    body: (facts: Facts) =>
      [
        `Токен: ${facts.name} ($${facts.symbol})`,
        `Адреса: ${facts.mint}`,
        `Сторінка: ${facts.page}`,
        '',
        'Що не так (видає себе за когось, образлива картинка чи текст, шахрайство, інше):',
        '',
        '',
        ...(facts.reporter ? [`Мій гаманець: ${facts.reporter}`] : []),
      ].join('\n'),
  },
} as const

/** The `mailto:` of a report on a launched token, in the person's language. */
export function reportTokenMailto(facts: Facts, locale: 'en' | 'uk'): string {
  const letter = LETTER[locale]
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(letter.subject(facts))}&body=${encodeURIComponent(letter.body(facts))}`
}
