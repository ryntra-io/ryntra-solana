/**
 * The words of the new look's «Платежі» and the send in four steps (NEW-LOOK
 * §3 «Платежі», §8): «ти», neutral to gender; the server's check (M31) keeps
 * its own words.
 */

import type { Copy } from '../../lib/i18n.ts'

export type SendStep = 'to' | 'amount' | 'check' | 'done'

export type PayCopy = Readonly<{
  canSend: string
  network: string
  myQr: string
  actions: Readonly<{ send: string; receive: string; request: string; topUp: string }>
  recent: string
  newRecipient: string
  lastPayments: string
  all: string
  empty: string
  steps: Readonly<Record<SendStep, string>>
  next: string
  toPlaceholder: string
  /** The field's «×»: it empties the field, it closes nothing. */
  clear: string
  newAddress: string
  lookalike: string
  pasteAgain: string
  youSend: (amount: string) => string
  newAddressCheck: string
  irreversible: string
  showQr: string
}>

export const PAY_COPY: Copy<PayCopy> = {
  en: {
    canSend: 'You can send',
    network: 'Solana network',
    myQr: 'My QR',
    actions: { send: 'Send', receive: 'Receive', request: 'Request', topUp: 'Add funds' },
    recent: 'Recent',
    newRecipient: 'New',
    lastPayments: 'Latest payments',
    all: 'All',
    empty: 'No payments yet',
    steps: { to: 'To', amount: 'Amount', check: 'Review', done: 'Done' },
    next: 'Next',
    toPlaceholder: 'Address or payment link',
    clear: 'Clear',
    newAddress: 'New address · nothing was sent to it from this phone yet',
    lookalike: 'Looks like an address from your recent ones, but it is another. Check the whole address.',
    pasteAgain: 'Paste it again to go on.',
    youSend: (amount) => `You send ${amount}`,
    newAddressCheck: 'Nothing was sent to this address yet. Match its first and last characters with whoever gave it.',
    irreversible: 'A transfer cannot be undone.',
    showQr: 'Show QR',
  },
  uk: {
    canSend: 'Можна надіслати',
    network: 'мережа Solana',
    myQr: 'Мій QR',
    actions: { send: 'Надіслати', receive: 'Отримати', request: 'Попросити', topUp: 'Поповнити' },
    recent: 'Нещодавні',
    newRecipient: 'Новий',
    lastPayments: 'Останні платежі',
    all: 'Усі',
    empty: 'Платежів ще немає',
    steps: { to: 'Кому', amount: 'Сума', check: 'Перевірка', done: 'Готово' },
    next: 'Далі',
    toPlaceholder: 'Адреса або посилання на оплату',
    clear: 'Очистити',
    newAddress: 'Нова адреса · з цього телефона переказів на неї ще не було',
    lookalike: 'Схожа на адресу з нещодавніх, але інша. Перевір усю адресу.',
    pasteAgain: 'Встав її ще раз, щоб іти далі.',
    youSend: (amount) => `Надсилаєш ${amount}`,
    newAddressCheck: 'На цю адресу переказів ще не було. Звір перші й останні символи з тим, хто її дав.',
    irreversible: 'Переказ не скасувати.',
    showQr: 'Показати QR',
  },
}
