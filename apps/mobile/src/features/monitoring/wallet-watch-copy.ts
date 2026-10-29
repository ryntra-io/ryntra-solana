import type { Copy } from '../../lib/i18n.ts'

/**
 * The words around a followed wallet's note (SOL-R4, 1.63.0) on the phone: the note itself is the server's; these
 * say how the wallet's trades are told and let it go. The phone has no list of followed wallets — the web's
 * «Гаманці» keeps it.
 */
const EN = {
  title: 'A wallet you follow',
  alerts: 'Notes about this wallet',
  alertsAll: 'Every trade',
  alertsSells: 'Only sales',
  alertsOff: 'Off',
  stop: 'Stop following',
  stopConfirmTitle: 'Stop following this wallet?',
  stopConfirmBody: 'No more notes about its trades. Following it again is on ryntra.io, in Markets → Wallets.',
  stopConfirm: 'Stop following',
  keep: 'Keep',
  stopped: 'Not followed any more.',
  saving: 'Saving…',
  saved: 'Saved.',
  failed: 'Couldn’t save — try again.',
  notFollowed: 'This wallet is not among those you follow.',
  readFailed: 'Couldn’t read how this wallet is told.',
  noNote: 'No note about this wallet yet.',
}

export type WalletWatchCopy = typeof EN

const UK: WalletWatchCopy = {
  title: 'Гаманець, за яким ти стежиш',
  alerts: 'Сповіщення про цей гаманець',
  alertsAll: 'Усі угоди',
  alertsSells: 'Лише продажі',
  alertsOff: 'Вимк.',
  stop: 'Не стежити',
  stopConfirmTitle: 'Перестати стежити за цим гаманцем?',
  stopConfirmBody: 'Сповіщень про його угоди більше не буде. Знову стежити можна на ryntra.io, у «Ринки → Гаманці».',
  stopConfirm: 'Не стежити',
  keep: 'Залишити',
  stopped: 'Більше не стежиш.',
  saving: 'Зберігаю…',
  saved: 'Збережено.',
  failed: 'Не вдалося зберегти — спробуй ще раз.',
  notFollowed: 'Цього гаманця немає серед тих, за якими ти стежиш.',
  readFailed: 'Не вдалося прочитати, як сповіщати про цей гаманець.',
  noNote: 'Сповіщень про цей гаманець ще немає.',
}

export const WALLET_WATCH_COPY: Copy<WalletWatchCopy> = { en: EN, uk: UK }
