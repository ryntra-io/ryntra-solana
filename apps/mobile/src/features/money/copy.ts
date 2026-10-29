/**
 * The words of «Гроші» — the web's own, from its Send and Receive cards, its
 * payment page and its recipient check (`app/solana/workspace/send`,
 * `…/receive`, `lib/site/pay-copy.ts`, `…/evidence/risk-words.ts`), said to
 * one person the way the phone speaks («ти»). A line the web does not have —
 * the scanner, a recipient problem the web never had to name — is written once
 * here in the same plain voice. Nothing explains a protocol.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { PayLinkExpiration, PayLinkStatus, RecipientProblem } from '../../lib/api/v1/types.ts'

export type MoneyPage = 'topUp' | 'send' | 'receive' | 'link'

export type EvidenceSummary =
  'nothing-found' | 'evidence-found' | 'sanctioned' | 'partly-checked' | 'unsupported' | 'unavailable'

export type MoneyCopy = Readonly<{
  /** «Гроші», the place of the bar, and its doors. */
  money: string
  pages: Readonly<Record<MoneyPage, string>>

  /* ---- Send ---- */
  sendTitle: string
  to: string
  recipientPlaceholder: string
  paste: string
  scan: string
  amount: string
  available: (figure: string) => string
  max: string
  asset: string
  chooseAsset: string
  yourAssets: string
  noAssets: string
  /** The one action, by what it still needs. */
  reviewTransfer: string
  enterRecipient: string
  checkRecipient: string
  enterDifferent: string
  enterAmount: string
  notEnough: (symbol: string) => string
  cannotBeSent: string
  checkingRecipient: string
  preparing: string
  waitingWallet: string
  sending: string
  confirmInWallet: string
  waitingEarlier: string
  connectToSend: string
  /** «Перевірка» — the server's rows, labelled. */
  reviewTitle: string
  youSend: string
  issuerFee: string
  recipientGets: string
  from: string
  networkFee: string
  accountSetup: string
  newAddressMinimum: string
  opensAccount: string
  cancel: string
  /* Outcome. */
  sent: string
  notSent: string
  notConfirmed: string
  neverReached: string
  rejected: string
  notConfirmedYet: string
  earlierOpen: string
  checkingEarlier: string
  explorer: string
  /** A past transfer's eyebrow — a noun, not the imperative «Надіслати». */
  transfer: string
  selfLink: string
  /** An Ethereum «0x…» address typed into a Solana send. */
  evmAddress: string
  sendAgain: string
  tryAgain: string
  /* Failures. */
  failures: Readonly<{
    rateLimited: string
    amount: string
    recipient: string
    window: string
    walletCancelled: string
    walletFailed: string
    /** The wallet gave no answer within the wait (M45). */
    walletTimeout: string
    /** Ledger's 6808: «Blind signing» off in its Solana app. */
    ledgerBlind: string
    /** Bytes a Ledger cannot sign yet; the wallet was not opened. */
    txVersion: string
    /** AG-2: the wallet answered late twice in a row — a transaction lives ~30 s. */
    deviceConfirm: string
    /** AG-2: a wallet that only sends (MWA 2.0 without `signTransactions`). */
    cannotSign: string
    /** AG-2: the server's bytes arrived with too little life for a wallet, twice. */
    bytesShort: string
    bytes: string
    earlier: string
    turnedOff: string
    unavailable: string
    network: string
    generic: string
    changed: string
    cannotSend: string
    /** M41.2: a `.skr` name read again before a step — gone, moved, unread before the wallet, unread before the Review. */
    nameGone: string
    nameMoved: string
    nameUnread: string
    /** The read after the signature did not answer in time: the signature was not used. */
    nameUnreadSigned: string
    nameUnchecked: string
  }>
  recipientProblems: Readonly<Record<RecipientProblem, string>>
  /** A Solana Pay request's own words, when the scan carried them. */
  asked: string
  askedNotHeld: string
  askedTooFine: string
  holdingsFailed: string
  amountFormat: string
  payUnconfirmed: string
  recheck: string
  linkChecking: string

  /* ---- The recipient check from the security source (one line). ---- */
  evidenceTitle: string
  evidenceChecking: string
  evidence: Readonly<Record<EvidenceSummary, string>>
  evidenceNotSafe: string

  /* ---- Scanner ---- */
  scanTitle: string
  cameraNeeded: string
  allowCamera: string
  openSettings: string

  /* ---- Receive ---- */
  receiveTitle: string
  myAddress: string
  requestPayment: string
  yourSolanaAddress: string
  networkWarning: string
  copyAddress: string
  copied: string
  share: string
  scanToPay: string
  connectWallet: string
  /** A guest's one line on Receive, over «Connect wallet»: what the page gives once a wallet is connected. */
  receiveGuest: string

  /* ---- Payment link ---- */
  token: string
  optional: string
  whatFor: string
  expiresIn: string
  expirations: Readonly<Record<PayLinkExpiration, string>>
  /** Behind «?» beside a payment link: who picks the amount and where the link goes. */
  payerChooses: string
  sendThisLink: string
  signInToPay: string
  signIn: string
  checkWallet: string
  createLink: string
  creating: string
  createFailed: string
  paymentLink: string
  copyLink: string
  scanToOpen: string
  validUntil: string
  newRequest: string
  status: Readonly<Record<PayLinkStatus, string>>
  pending: string
  notes: Readonly<{ UNDERPAID: string; WRONG_TOKEN: string; OVERPAID: string }>
  paidOn: string
  received: string
  yourLinks: string

  /* ---- Paying a Ryntra link from Send ---- */
  payRequest: string
  payTo: string
  anyAmount: string
  pay: string
  payPreparing: string
  paySent: string
  payAgainHint: string
  createsAccountNote: string
  payFailed: string
  payRefused: string
  paySelf: string
  payPending: string
  /** AG-2: the wallet answered after the payment's ~30 s twice in a row, or the bytes arrived too short-lived. */
  payLate: string
  /** AG-2: a wallet that only sends (MWA 2.0 without `signTransactions`). */
  payCannotSign: string
}>

const EN: MoneyCopy = {
  money: 'Money',
  pages: { topUp: 'Add funds', send: 'Send', receive: 'Receive', link: 'Payment link' },

  sendTitle: 'Send',
  to: 'To',
  recipientPlaceholder: 'Solana address',
  paste: 'Paste',
  scan: 'Scan',
  amount: 'Amount',
  available: (figure) => `Available ${figure}`,
  max: 'MAX',
  asset: 'Asset',
  chooseAsset: 'Choose an asset',
  yourAssets: 'Your assets',
  noAssets: 'Nothing to send yet.',
  reviewTransfer: 'Review transfer',
  enterRecipient: 'Enter a recipient',
  checkRecipient: 'Check the recipient address',
  enterDifferent: 'Enter a different recipient',
  enterAmount: 'Enter an amount',
  notEnough: (symbol) => `Not enough ${symbol}`,
  cannotBeSent: 'Cannot be sent',
  checkingRecipient: 'Checking the recipient…',
  preparing: 'Preparing transfer…',
  waitingWallet: 'Waiting for the wallet…',
  sending: 'Sending…',
  confirmInWallet: 'Confirm in wallet',
  waitingEarlier: 'Waiting for an earlier transfer',
  connectToSend: 'Connect a wallet to send from it.',
  reviewTitle: 'Ready to sign',
  youSend: 'You send',
  issuerFee: 'Transfer fee',
  recipientGets: 'Recipient gets',
  from: 'From',
  networkFee: 'Network fee estimate',
  accountSetup: 'Account setup',
  newAddressMinimum: 'Minimum for a new address',
  opensAccount: 'First time this address gets this token: you pay a one-time setup cost.',
  cancel: 'Cancel',
  sent: 'Sent',
  notSent: 'Not sent',
  notConfirmed: 'Not confirmed',
  neverReached: 'This transfer never reached the network. Nothing moved.',
  rejected: 'The network rejected this transfer. Only the network fee was spent.',
  notConfirmedYet: 'This transfer is not confirmed yet. Check it on Solscan before sending again.',
  earlierOpen: 'An earlier transfer is still being confirmed. Do not send it again.',
  checkingEarlier: 'Checking an earlier transfer…',
  explorer: 'View on Solscan',
  transfer: 'Transfer',
  selfLink: 'This is your own payment link.',
  evmAddress: 'This is an Ethereum address. Ryntra sends on Solana here — enter a Solana address.',
  sendAgain: 'New transfer',
  tryAgain: 'Try again',
  failures: {
    rateLimited: 'Too many requests. Try again in a moment.',
    amount: 'That amount is unavailable.',
    recipient: 'Check the recipient address.',
    window: 'The transfer window closed. Review it again.',
    walletCancelled: 'Wallet approval was cancelled. Nothing was sent.',
    walletFailed: 'Your wallet did not approve this transfer.',
    walletTimeout: 'Your wallet did not answer within 90 seconds. Nothing was sent — review the transfer again.',
    deviceConfirm:
      'A transaction lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — try again.',
    bytesShort: 'The network was slow to prepare it. Nothing was sent — try again.',
    cannotSign:
      "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
    ledgerBlind:
      'The Ledger did not sign: “Blind signing” is off in its Solana app. Turn it on in the app’s settings and try again.',
    txVersion:
      'This transaction is in a format a Ledger cannot sign yet, so the wallet was not opened. Nothing was sent.',
    bytes: 'Your wallet returned a different transaction. Nothing was sent.',
    earlier: 'An earlier transfer is still being confirmed. Do not send it again.',
    turnedOff: 'Sending is turned off right now.',
    unavailable: 'Sending is unavailable right now. Try again later.',
    network: 'No connection. Nothing was sent.',
    generic: 'The transfer could not continue. Try again.',
    changed: 'Something changed since you reviewed this transfer. Review it again.',
    cannotSend: 'This transfer cannot be sent.',
    nameGone: 'The .skr name no longer points to a wallet. Nothing was sent.',
    nameMoved: 'The name now points to another address. Check it and review again.',
    nameUnread: 'The name could not be checked again before signing. Nothing was sent.',
    nameUnreadSigned: 'The name could not be checked again before sending. Your signature was not used — nothing was sent.',
    nameUnchecked: 'The name could not be checked right now.',
  },
  recipientProblems: {
    EMPTY: 'Enter a recipient.',
    NOT_AN_ADDRESS: 'That is not a Solana address.',
    MISREAD_CHARACTER: 'A Solana address never has 0, O, I or l. Copy it rather than retyping it.',
    WRONG_LENGTH: 'That address is the wrong length. Copy it again.',
    REQUEST_INVALID: 'This code is not a payment Ryntra can read.',
    REQUEST_UNSUPPORTED: 'Pay this request in your wallet app.',
    REFERENCE_UNSUPPORTED: 'Pay this request in your wallet app.',
    LINK_INVALID: 'This payment link does not exist.',
    LINK_NOT_FOUND: 'This payment link does not exist.',
    LINK_PAID: 'This payment link is already paid.',
    LINK_EXPIRED: 'This payment link has expired.',
    LINK_MISMATCH: 'This code does not match its payment link. Ask for a new one.',
    LINK_UNCONFIRMED: 'This payment link could not be checked — it may already be paid. Try again.',
    SELF: 'This is your own wallet. Enter a different recipient.',
    MINT_UNREADABLE: 'This token could not be read.',
    UNSAFE_SOL_RECIPIENT: 'This address cannot receive SOL. Check the recipient address.',
    RECIPIENT_MINT_MISMATCH: 'This account holds a different token. Check the recipient address.',
    RECIPIENT_PROGRAM_MISMATCH: 'This account cannot receive this token. Check the recipient address.',
    RECIPIENT_ACCOUNT_MALFORMED: 'This account cannot receive this token. Check the recipient address.',
    OFF_CURVE_OWNER_UNSUPPORTED: 'Ryntra cannot send this token to this kind of address.',
    RECIPIENT_FROZEN: "The recipient's account for this token is frozen.",
    RECIPIENT_UNREADABLE: 'The recipient could not be checked. Try again.',
  },
  asked: 'Asked for',
  askedNotHeld: 'This request asks for a token your wallet does not hold.',
  askedTooFine: 'This request asks for a finer amount than the token can carry.',
  holdingsFailed: 'Your balances could not be read.',
  amountFormat: 'Enter the amount as a number.',
  payUnconfirmed: 'The payment is not confirmed yet. The link updates on its own — do not pay it again.',
  recheck: 'Check again',
  linkChecking: 'This link is still being checked — it updates on its own.',

  evidenceTitle: 'Recipient check',
  evidenceChecking: 'Checking the address with an external source…',
  evidence: {
    'nothing-found': 'Nothing found among what the source keeps',
    'evidence-found': 'Risk evidence found',
    sanctioned: 'On a sanctions list the source keeps',
    'partly-checked': 'Partly checked',
    unsupported: 'The source cannot analyse this kind of address',
    unavailable: 'Unable to verify this address right now',
  },
  evidenceNotSafe: 'not a guarantee — one source, today',

  scanTitle: 'Scan',
  cameraNeeded: 'The camera is needed to scan a code.',
  allowCamera: 'Allow camera',
  openSettings: 'Open settings',

  receiveTitle: 'Receive',
  myAddress: 'My address',
  requestPayment: 'Request a payment',
  yourSolanaAddress: 'Your Solana address',
  networkWarning: 'Solana network only: funds sent from another network are lost.',
  copyAddress: 'Copy address',
  copied: 'Copied',
  share: 'Share',
  scanToPay: 'Scan to pay this address',
  connectWallet: 'Connect wallet',
  receiveGuest: 'Your address and QR to receive — from your wallet',

  token: 'Token',
  optional: 'optional',
  whatFor: 'What is it for',
  expiresIn: 'Expires in',
  expirations: { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days' },
  payerChooses: 'The payer chooses the amount.',
  sendThisLink: 'Send this link to the person who should pay. It opens in any browser, no app needed.',
  signInToPay: 'Sign in with your wallet to pay this link.',
  signIn: 'Sign in with your wallet',
  checkWallet: 'Check your wallet…',
  createLink: 'Create payment link',
  creating: 'Creating…',
  createFailed: 'The payment link could not be created.',
  paymentLink: 'Payment link',
  copyLink: 'Copy payment link',
  scanToOpen: 'Scan to open this payment link',
  validUntil: 'Valid until',
  newRequest: 'New request',
  status: {
    AWAITING: 'Awaiting payment',
    PAID: 'Paid',
    EXPIRED: 'Expired',
    CHECKING: 'Checking',
    UNKNOWN: 'Unknown',
  },
  pending: 'Payment sent, waiting for the network',
  notes: {
    UNDERPAID: 'A payment arrived, but less than this request asks for.',
    WRONG_TOKEN: 'A payment arrived in a different token than this request asks for.',
    OVERPAID: 'More arrived than this request asked for.',
  },
  paidOn: 'Paid on',
  received: 'Received',
  yourLinks: 'Your payment links',

  payRequest: 'Payment request',
  payTo: 'Pay to',
  anyAmount: 'Any amount',
  pay: 'Pay',
  payPreparing: 'Preparing the transaction…',
  paySent: 'Sent. Waiting for the network to confirm.',
  payAgainHint: 'The link updates on its own once the payment is confirmed.',
  createsAccountNote: 'The recipient has never held this token — this payment also pays its one-time setup.',
  payFailed: 'The payment could not be prepared.',
  payRefused: 'The wallet did not sign. Nothing was sent.',
  payLate:
    'A payment lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — pay again.',
  payCannotSign:
    "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
  paySelf: 'This request is addressed to the wallet you connected.',
  payPending: 'A payment for this link is already on its way.',
}

const UK: MoneyCopy = {
  money: 'Гроші',
  pages: { topUp: 'Поповнити', send: 'Надіслати', receive: 'Отримати', link: 'Посилання на оплату' },

  sendTitle: 'Надіслати',
  to: 'Кому',
  recipientPlaceholder: 'Адреса Solana',
  paste: 'Вставити',
  scan: 'Сканувати',
  amount: 'Сума',
  available: (figure) => `Доступно ${figure}`,
  max: 'МАКС',
  asset: 'Актив',
  chooseAsset: 'Обери актив',
  yourAssets: 'Твої активи',
  noAssets: 'Поки що нічого надіслати.',
  reviewTransfer: 'Перевірити переказ',
  enterRecipient: 'Введи отримувача',
  checkRecipient: 'Перевір адресу отримувача',
  enterDifferent: 'Введи іншого отримувача',
  enterAmount: 'Введи суму',
  notEnough: (symbol) => `Недостатньо ${symbol}`,
  cannotBeSent: 'Надіслати неможливо',
  checkingRecipient: 'Перевіряємо отримувача…',
  preparing: 'Готуємо переказ…',
  waitingWallet: 'Очікування гаманця…',
  sending: 'Надсилаємо…',
  confirmInWallet: 'Підтвердити в гаманці',
  waitingEarlier: 'Чекаємо на попередній переказ',
  connectToSend: 'Під’єднай гаманець, щоб надсилати з нього.',
  reviewTitle: 'Готово до підпису',
  youSend: 'Надсилаєш',
  issuerFee: 'Комісія емітента',
  recipientGets: 'Отримувач отримає',
  from: 'Звідки',
  networkFee: 'Комісія мережі (оцінка)',
  accountSetup: 'Відкриття рахунку',
  newAddressMinimum: 'Мінімум для нової адреси',
  opensAccount: 'Ця адреса вперше отримує цей токен: ти одноразово платиш за відкриття.',
  cancel: 'Скасувати',
  sent: 'Надіслано',
  notSent: 'Не надіслано',
  notConfirmed: 'Не підтверджено',
  neverReached: 'Цей переказ так і не дійшов до мережі. Нічого не переміщено.',
  rejected: 'Мережа відхилила цей переказ. Списано лише плату мережі.',
  notConfirmedYet: 'Цей переказ ще не підтверджено. Перевір його в Solscan, перш ніж надсилати ще раз.',
  earlierOpen: 'Попередній переказ ще підтверджується. Не надсилай його вдруге.',
  checkingEarlier: 'Перевіряємо попередній переказ…',
  explorer: 'Переглянути в Solscan',
  transfer: 'Переказ',
  selfLink: 'Це твоє власне посилання на оплату.',
  evmAddress: 'Це адреса Ethereum. Тут Ryntra надсилає в мережі Solana — введи адресу Solana.',
  sendAgain: 'Новий переказ',
  tryAgain: 'Спробувати ще раз',
  failures: {
    rateLimited: 'Забагато запитів. Спробуй за мить.',
    amount: 'Ця сума недоступна.',
    recipient: 'Перевір адресу отримувача.',
    window: 'Вікно переказу закрилося. Перевір його ще раз.',
    walletCancelled: 'Підтвердження в гаманці скасовано. Нічого не надіслано.',
    walletFailed: 'Гаманець не підтвердив цей переказ.',
    walletTimeout: 'Гаманець не відповів за 90 секунд. Нічого не надіслано — перевір переказ ще раз.',
    deviceConfirm:
      'Транзакція живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — спробуй ще раз.',
    bytesShort: 'Мережа надто довго готувала транзакцію. Нічого не надіслано — спробуй ще раз.',
    cannotSign:
      'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
    ledgerBlind:
      'Ledger не підписав: у застосунку Solana на Ledger вимкнено «Blind signing». Увімкни його в налаштуваннях застосунку й спробуй знову.',
    txVersion: 'Цю транзакцію Ledger ще не вміє підписати, тож гаманець не відкрито. Нічого не надіслано.',
    bytes: 'Гаманець повернув іншу транзакцію. Нічого не надіслано.',
    earlier: 'Попередній переказ ще підтверджується. Не надсилай його вдруге.',
    turnedOff: 'Надсилання зараз вимкнено.',
    unavailable: 'Надсилання зараз недоступне. Спробуй пізніше.',
    network: 'Немає з’єднання. Нічого не надіслано.',
    generic: 'Переказ не вдалося продовжити. Спробуй ще раз.',
    changed: 'Від моменту перевірки цього переказу дещо змінилося. Перевір його ще раз.',
    cannotSend: 'Цей переказ неможливо надіслати.',
    nameGone: 'Ім’я .skr більше не веде до гаманця. Нічого не надіслано.',
    nameMoved: 'Ім’я тепер веде на іншу адресу. Перевір її й переглянь ще раз.',
    nameUnread: 'Ім’я не вдалося перевірити ще раз перед підписом. Нічого не надіслано.',
    nameUnreadSigned: 'Ім’я не вдалося перевірити ще раз перед надсиланням. Твій підпис не використано — нічого не надіслано.',
    nameUnchecked: 'Ім’я зараз не вдалося перевірити.',
  },
  recipientProblems: {
    EMPTY: 'Введи отримувача.',
    NOT_AN_ADDRESS: 'Це не адреса Solana.',
    MISREAD_CHARACTER: 'В адресі Solana не буває 0, O, I чи l. Скопіюй її, а не передруковуй.',
    WRONG_LENGTH: 'Адреса неправильної довжини. Скопіюй її ще раз.',
    REQUEST_INVALID: 'Ryntra не може прочитати цей код оплати.',
    REQUEST_UNSUPPORTED: 'Оплати цей запит у застосунку гаманця.',
    REFERENCE_UNSUPPORTED: 'Оплати цей запит у застосунку гаманця.',
    LINK_INVALID: 'Такого посилання на оплату немає.',
    LINK_NOT_FOUND: 'Такого посилання на оплату немає.',
    LINK_PAID: 'Це посилання вже оплачено.',
    LINK_EXPIRED: 'Термін цього посилання минув.',
    LINK_MISMATCH: 'Цей код не збігається зі своїм посиланням. Попроси нове.',
    LINK_UNCONFIRMED: 'Не вдалося перевірити посилання — можливо, його вже оплачено. Спробуй ще раз.',
    SELF: 'Це твій власний гаманець. Введи іншого отримувача.',
    MINT_UNREADABLE: 'Не вдалося прочитати цей токен.',
    UNSAFE_SOL_RECIPIENT: 'Ця адреса не може отримати SOL. Перевір адресу отримувача.',
    RECIPIENT_MINT_MISMATCH: 'Цей рахунок тримає інший токен. Перевір адресу отримувача.',
    RECIPIENT_PROGRAM_MISMATCH: 'Цей рахунок не може отримати цей токен. Перевір адресу отримувача.',
    RECIPIENT_ACCOUNT_MALFORMED: 'Цей рахунок не може отримати цей токен. Перевір адресу отримувача.',
    OFF_CURVE_OWNER_UNSUPPORTED: 'Ryntra не надсилає цей токен на такий тип адреси.',
    RECIPIENT_FROZEN: 'Рахунок отримувача для цього токена заморожено.',
    RECIPIENT_UNREADABLE: 'Не вдалося перевірити отримувача. Спробуй ще раз.',
  },
  asked: 'Просять',
  askedNotHeld: 'Цей запит просить токен, якого немає в гаманці.',
  askedTooFine: 'Цей запит просить точнішу суму, ніж підтримує токен.',
  holdingsFailed: 'Не вдалося прочитати баланси.',
  amountFormat: 'Введи суму числом.',
  payUnconfirmed: 'Платіж ще не підтверджено. Посилання оновиться саме — не оплачуй його вдруге.',
  recheck: 'Перевірити ще раз',
  linkChecking: 'Посилання ще перевіряється — воно оновиться саме.',

  evidenceTitle: 'Перевірка отримувача',
  evidenceChecking: 'Перевіряємо адресу в зовнішньому джерелі…',
  evidence: {
    'nothing-found': 'Нічого не знайдено серед того, що веде джерело',
    'evidence-found': 'Знайдено свідчення ризику',
    sanctioned: 'У санкційному списку, який веде джерело',
    'partly-checked': 'Перевірено частково',
    unsupported: 'Джерело не може проаналізувати такий тип адреси',
    unavailable: 'Зараз перевірити цю адресу неможливо',
  },
  evidenceNotSafe: 'не гарантія — одне джерело, сьогодні',

  scanTitle: 'Сканувати',
  cameraNeeded: 'Щоб сканувати код, потрібна камера.',
  allowCamera: 'Дозволити камеру',
  openSettings: 'Відкрити налаштування',

  receiveTitle: 'Отримати',
  myAddress: 'Моя адреса',
  requestPayment: 'Запит на оплату',
  yourSolanaAddress: 'Твоя адреса Solana',
  networkWarning: 'Лише мережа Solana: кошти з іншої мережі загубляться.',
  copyAddress: 'Копіювати адресу',
  copied: 'Скопійовано',
  share: 'Поділитися',
  scanToPay: 'Скануй, щоб надіслати на цю адресу',
  connectWallet: 'Під’єднати гаманець',
  receiveGuest: 'Адреса й QR для поповнення — з твого гаманця',

  token: 'Токен',
  optional: 'необов’язково',
  whatFor: 'За що',
  expiresIn: 'Термін дії',
  expirations: { '1h': '1 година', '24h': '24 години', '7d': '7 днів', '30d': '30 днів' },
  payerChooses: 'Платник обирає суму.',
  sendThisLink:
    'Надішли це посилання тому, хто має заплатити. Воно відкривається в будь-якому браузері, без застосунку.',
  signInToPay: 'Увійди гаманцем, щоб оплатити це посилання.',
  signIn: 'Увійти гаманцем',
  checkWallet: 'Перевір гаманець…',
  createLink: 'Створити посилання на оплату',
  creating: 'Створюємо…',
  createFailed: 'Не вдалося створити посилання на оплату.',
  paymentLink: 'Посилання на оплату',
  copyLink: 'Копіювати посилання на оплату',
  scanToOpen: 'Скануй, щоб відкрити посилання на оплату',
  validUntil: 'Дійсне до',
  newRequest: 'Новий запит',
  status: {
    AWAITING: 'Очікує оплати',
    PAID: 'Оплачено',
    EXPIRED: 'Термін минув',
    CHECKING: 'Перевіряємо',
    UNKNOWN: 'Невідомо',
  },
  pending: 'Платіж надіслано, чекаємо мережу',
  notes: {
    UNDERPAID: 'Платіж надійшов, але менший за суму запиту.',
    WRONG_TOKEN: 'Платіж надійшов в іншому токені, ніж просить цей запит.',
    OVERPAID: 'Надійшло більше, ніж просив цей запит.',
  },
  paidOn: 'Дата оплати',
  received: 'Надійшло',
  yourLinks: 'Твої посилання на оплату',

  payRequest: 'Запит на оплату',
  payTo: 'Кому',
  anyAmount: 'Будь-яка сума',
  pay: 'Оплатити',
  payPreparing: 'Готуємо транзакцію…',
  paySent: 'Надіслано. Чекаємо підтвердження мережі.',
  payAgainHint: 'Посилання оновиться саме, щойно платіж підтвердиться.',
  createsAccountNote: 'Отримувач ще не мав цього токена — цей платіж також оплачує одноразове відкриття.',
  payFailed: 'Не вдалося підготувати платіж.',
  payRefused: 'Гаманець не підписав. Нічого не надіслано.',
  payLate:
    'Оплата живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — оплати ще раз.',
  payCannotSign:
    'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
  paySelf: 'Цей запит адресований гаманцю, що зараз під’єднаний.',
  payPending: 'Платіж за цим посиланням уже в дорозі.',
}

export const MONEY_COPY: Copy<MoneyCopy> = { en: EN, uk: UK }
