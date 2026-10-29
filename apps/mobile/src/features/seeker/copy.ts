/**
 * The words of «Перевірено Seeker» and of `.skr` names (M41.2) — the web's own
 * (`app/solana/workspace/i18n/catalog.ts`, SKR-3 and SKR-4), said to one person
 * the way the phone speaks («ти»). The mark explains itself one tap deep,
 * behind «?», never in a line.
 */

import type { Copy } from '../../lib/i18n.ts'

export type SeekerCopy = Readonly<{
  /** The mark under the signed-in line. */
  verified: string
  /** Behind its «?»: what the mark is and what it is not. */
  verifiedHelp: string
  /** A screen reader's words for a `.skr` name standing where an address used to. */
  name: (name: string) => string
  /* «Кому»: a typed `.skr` name — offered only where the server serves names. */
  toPlaceholder: string
  findingName: string
  noSuchName: string
  nameUnchecked: string
  checkName: string
}>

export const SEEKER_COPY: Copy<SeekerCopy> = {
  en: {
    verified: 'Verified Seeker',
    verifiedHelp:
      'This wallet holds a Seeker Genesis Token — Ryntra read it on the Solana chain. It is a mark only: it opens and pays nothing.',
    name: (name) => `Name ${name}`,
    toPlaceholder: 'Address, .skr name or payment link',
    findingName: 'Finding the name…',
    noSuchName: 'No such .skr name',
    nameUnchecked: 'The name could not be checked right now.',
    checkName: 'Check the name',
  },
  uk: {
    verified: 'Перевірено Seeker',
    verifiedHelp:
      'Цей гаманець тримає Seeker Genesis Token — Ryntra прочитала це в блокчейні Solana. Це лише позначка: вона нічого не відкриває й не платить.',
    name: (name) => `Ім’я ${name}`,
    toPlaceholder: 'Адреса, ім’я .skr або посилання на оплату',
    findingName: 'Шукаю ім’я…',
    noSuchName: 'Такого імені .skr немає',
    nameUnchecked: 'Ім’я зараз не вдалося перевірити.',
    checkName: 'Перевір ім’я',
  },
}
