/**
 * «Підпис і Ledger» (NEW-LOOK §4, PLAN §8, M45): the four items of the Settings screen — each one short line, the
 * detail behind «?» (ST-5: no wall of text, no fact dropped) — and the one sentence a
 * refused sign-in says. The wallet signs; a Ledger behind it is reached through the wallet (MWA), never by Ryntra.
 */

import type { Copy, Locale } from '../../lib/i18n.ts'
import type { SignInFailure } from '../session/session-client.ts'

/** One item of the screen: its title, one short line, and the detail behind «?». */
export type SigningLine = Readonly<{ title: string; line: string; body: string }>

export type SigningCopy = Readonly<{
  title: string
  lines: readonly [SigningLine, SigningLine, SigningLine, SigningLine]
  /** A sign-in the wallet failed to sign, or one it said a Ledger refused — never a plain decline. */
  signInRefused: string
}>

export const SIGNING_COPY: Copy<SigningCopy> = {
  en: {
    title: 'Signing and Ledger',
    lines: [
      {
        title: 'Your wallet signs',
        line: 'Ryntra never sees your keys.',
        body: 'Ryntra never sees or keeps your keys. Every operation is confirmed in your wallet.',
      },
      {
        title: 'A wallet on a Ledger',
        line: 'Confirm on the device within 20 seconds.',
        body: 'A transaction lives about 30 seconds — confirm on the device within 20. Ryntra waits up to 90 seconds and builds it again if needed; “Cancel” is always there.',
      },
      {
        title: 'A swap on a Ledger',
        line: 'Every sum is in “Review” before you sign.',
        body: 'A Ledger shows a swap as a hash, so every sum is in “Review” before you sign. A swap needs “Blind signing” on in the Solana app on the Ledger; after the app updates, turn it on again.',
      },
      {
        title: 'An outdated price',
        line: 'A new “Review” follows. An old signature is never sent.',
        body: 'If the price goes out of date while you confirm, a new “Review” follows; an old signature is never sent.',
      },
    ],
    signInRefused:
      'The wallet did not sign the sign-in — on a Ledger, update the Solana app on the device or sign in with another wallet.',
  },
  uk: {
    title: 'Підпис і Ledger',
    lines: [
      {
        title: 'Підписує твій гаманець',
        line: 'Ryntra не бачить твоїх ключів.',
        body: 'Ryntra не бачить і не зберігає твоїх ключів. Кожну операцію підтверджуєш у своєму гаманці.',
      },
      {
        title: 'Гаманець на Ledger',
        line: 'Підтверди на пристрої за 20 секунд.',
        body: 'Транзакція живе ~30 секунд — підтверди на пристрої за 20. Ryntra чекає до 90 секунд і за потреби збирає її наново; «Скасувати» є завжди.',
      },
      {
        title: 'Обмін на Ledger',
        line: 'Усі суми — у «Перевірці» до підпису.',
        body: 'Ledger показує обмін хешем, тому всі суми — у «Перевірці» до підпису. Для обміну в застосунку Solana на Ledger має бути ввімкнено «Blind signing»; після оновлення застосунку ввімкни його знову.',
      },
      {
        title: 'Ціна застаріла',
        line: 'Буде нова «Перевірка». Старий підпис не надсилається.',
        body: 'Якщо ціна застаріє, поки ти підтверджуєш, буде нова «Перевірка»; старий підпис ніколи не надсилається.',
      },
    ],
    signInRefused:
      'Гаманець не підписав вхід — якщо він на Ledger, онови застосунок Solana на пристрої або увійди іншим гаманцем.',
  },
}

/**
 * The Ukrainian of every line a sign-in or a wallet request may end with
 * (`session-client.ts`, `use-wallet.ts` say them in English, the engineer's
 * words); a line not listed here stays as it is.
 */
const UK_LINES: Readonly<Record<string, string>> = {
  'The wallet closed before it signed.': 'Гаманець закрився, не підписавши.',
  'You declined the sign-in in your wallet.': 'Вхід скасовано в гаманці.',
  'The wallet did not answer — try again.': 'Гаманець не відповів — спробуй ще раз.',
  'The sign-in did not finish. Try again.': 'Вхід не завершився. Спробуй ще раз.',
  'Sign-in needs the network. Try again when you are back online.':
    'Немає з’єднання з інтернетом — вхід не відбувся. Спробуй ще раз.',
  'Too many sign-in attempts. Wait a minute and try again.': 'Забагато спроб входу. Зачекай хвилину й спробуй знову.',
  'The sign-in took too long or was already used. Try again.':
    'Вхід тривав задовго або вже використаний. Спробуй знову.',
  'The server did not accept the signature. Try signing in again.': 'Сервер не прийняв підпис. Спробуй увійти знову.',
  'The server did not answer the sign-in.': 'Сервер не відповів на вхід.',
  'The sign-in message did not match this wallet.': 'Повідомлення для входу не відповідає цьому гаманцю.',
  'The wallet signed with a different account. Switch wallet and try again.':
    'Гаманець підписав іншим акаунтом. Зміни гаманець і спробуй знову.',
  'No Solana wallet is installed on this device.': 'На цьому пристрої немає гаманця Solana.',
  'The wallet signed a different message than the server issued.':
    'Гаманець підписав не те повідомлення, яке видав сервер.',
  'The wallet returned no usable signature.': 'Гаманець не повернув придатного підпису.',
  'The server answered with a session for another wallet.': 'Сервер відповів сесією іншого гаманця.',
  'The wallet declined the request.': 'Гаманець відхилив запит.',
  'The wallet closed before it finished.': 'Гаманець закрився, не завершивши.',
  'The wallet did not complete the request.': 'Гаманець не завершив запит.',
  'The wallet answered with another account — nothing was signed.':
    'Гаманець відповів іншим акаунтом — нічого не підписано.',
}

const OUTDATED = /^Update Ryntra to sign in — the server needs (?:version (\S+) or later|a newer version)\.$/

/** A sign-in's or a wallet request's one line in the person's language. */
export function failureLine(message: string, locale: Locale): string {
  if (locale !== 'uk') return message
  const outdated = OUTDATED.exec(message)
  if (outdated) {
    return outdated[1]
      ? `Онови Ryntra, щоб увійти, — потрібна версія ${outdated[1]} або новіша.`
      : 'Онови Ryntra, щоб увійти, — потрібна новіша версія.'
  }
  return UK_LINES[message] ?? message
}

/** A sign-in's failure in the person's language. */
export function signInFailureLine(failure: SignInFailure, locale: Locale): string {
  return failure.hint === 'ledger' ? SIGNING_COPY[locale].signInRefused : failureLine(failure.message, locale)
}
