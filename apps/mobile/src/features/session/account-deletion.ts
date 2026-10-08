/**
 * «Видалити дані акаунта» — the way the privacy policy names (ryntra.io/legal/privacy,
 * section 6): an e-mail to Ryntra's one inbox that mentions the wallet the person
 * signs in with; the data goes within 30 days of a verified request, and Ryntra
 * may ask for a signature to prove the wallet is theirs. The phone only writes
 * the letter — nothing is deleted or sent until the person sends it.
 */

export const SUPPORT_EMAIL = 'hello@ryntra.io'

/** Where the person reads the same terms when the phone has no mail app. */
export { PRIVACY_URL as DELETION_POLICY_URL } from '../../lib/legal.ts'

type Letter = Readonly<{ subject: string; body: (address: string | null) => string }>

const LETTER: Readonly<Record<'en' | 'uk', Letter>> = {
  en: {
    subject: 'Delete my Ryntra account data',
    body: (address) =>
      [
        'Please delete the data of my Ryntra account.',
        '',
        `The wallet I sign in with: ${address ?? '(write its address here)'}`,
        '',
        'I can prove this wallet is mine with a signature if you ask.',
      ].join('\n'),
  },
  uk: {
    subject: 'Видалити дані мого акаунта Ryntra',
    body: (address) =>
      [
        'Прошу видалити дані мого акаунта Ryntra.',
        '',
        `Гаманець, яким я входжу: ${address ?? '(впиши його адресу)'}`,
        '',
        'Якщо попросите, підтверджу підписом, що гаманець мій.',
      ].join('\n'),
  },
}

/** The `mailto:` that opens the letter, with the connected wallet's address when there is one. */
export function accountDeletionMailto(address: string | null, locale: 'en' | 'uk'): string {
  const letter = LETTER[locale]
  const query = `subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body(address))}`
  return `mailto:${SUPPORT_EMAIL}?${query}`
}
