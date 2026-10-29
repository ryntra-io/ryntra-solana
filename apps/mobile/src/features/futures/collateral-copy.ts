/**
 * The words of Phoenix collateral on the phone (C4c) in both languages — the web's B6 words (`futures-words.ts` on
 * line A: the collateral block and its `fail.*`) said the phone's way: «ти», neutral to gender, «Перевірка» for the
 * Review as every other operation of the app says it. Phoenix, USDC, SOL and Perps are names, never translated.
 */

import type { Copy } from '../../lib/i18n.ts'

import type { CollateralBlock, CollateralFailure } from './collateral-model.ts'

export type CollateralCopy = Readonly<{
  deposit: string
  withdraw: string
  depositTitle: string
  withdrawTitle: string
  /** The account card's line when the account holds no collateral yet: its one next action is a deposit. */
  emptyLine: string
  amount: string
  max: string
  inWallet: (held: string) => string
  canWithdraw: (held: string) => string
  review: string
  preparing: string
  blocks: Readonly<Record<CollateralBlock, string>>
  canaryAmount: (amount: string) => string
  closed: string
  /* C4e: a deposit the wallet cannot carry — said, with the next step in the app */
  walletShort: string
  buyUsdc: string
  receiveUsdc: string
  /** Collateral already free on Phoenix, with its time: a trade needs no deposit first. */
  freeNow: (held: string) => string
  toTrade: string
  /* the Review */
  check: string
  reviewDeposit: (amount: string) => string
  reviewWithdraw: (amount: string) => string
  pay: string
  get: string
  payWallet: (amount: string) => string
  payAccount: (amount: string) => string
  getAccount: (amount: string) => string
  getWallet: (amount: string) => string
  freeAfter: string
  marginAfter: string
  closerToLiquidation: string
  costRyntra: string
  costPhoenix: string
  costNetwork: string
  costRent: string
  costNone: string
  costsTotal: (sol: string) => string
  whatIs: string
  whatDeposit: string
  whatWithdraw: string
  rentNote: string
  risk: string
  validFor: (left: string) => string
  stale: string
  renewing: string
  details: string
  traderAccount: string
  program: string
  wallet: string
  confirm: string
  /* the receipt */
  receiptDeposit: string
  receiptWithdraw: string
  receiptPending: string
  receiptFailed: string
  receiptNothing: string
  notSent: string
  expected: string
  pendingLine: string
  pendingStopped: string
  network: string
  explorer: string
  again: string
  againWait: string
  failures: Readonly<Record<CollateralFailure, string>>
}>

export const COLLATERAL_COPY: Copy<CollateralCopy> = {
  en: {
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    depositTitle: 'Deposit to Perps',
    withdrawTitle: 'Withdraw from Perps',
    emptyLine: 'Add USDC collateral to trade Perps.',
    amount: 'Amount, USDC',
    max: 'Max',
    inWallet: (held) => `In wallet: ${held}`,
    canWithdraw: (held) => `Can withdraw: ${held}`,
    review: 'Review',
    preparing: 'Preparing…',
    blocks: {
      minimum: 'From 1 USDC.',
      overWallet: 'More than the wallet holds.',
      overWithdrawable: 'More than the account may withdraw now.',
      canary: 'The first check takes a smaller amount.',
    },
    canaryAmount: (amount) => `The first check takes up to ${amount} USDC.`,
    walletShort: 'A deposit takes USDC from this wallet. Add USDC to the wallet first.',
    buyUsdc: 'Buy USDC',
    receiveUsdc: 'Receive USDC',
    freeNow: (held) => `Available to trade on Phoenix: ${held}. Enough to open a trade.`,
    toTrade: 'Open a trade',
    closed: 'Deposits and withdrawals are not open for this wallet yet.',
    check: 'Review',
    reviewDeposit: (amount) => `Deposit ${amount} USDC to Perps on Phoenix`,
    reviewWithdraw: (amount) => `Withdraw ${amount} USDC from Perps on Phoenix`,
    pay: 'Leaves',
    get: 'Arrives',
    payWallet: (amount) => `${amount} USDC from your wallet`,
    payAccount: (amount) => `${amount} USDC of Phoenix collateral`,
    getAccount: (amount) => `${amount} USDC as collateral on Phoenix`,
    getWallet: (amount) => `${amount} USDC to your wallet`,
    freeAfter: 'Free to withdraw after',
    marginAfter: 'Margin after',
    closerToLiquidation: 'Less collateral brings the account closer to liquidation.',
    costRyntra: 'Ryntra',
    costPhoenix: 'Phoenix',
    costNetwork: 'Network',
    costRent: 'Token account deposit',
    costNone: '0',
    costsTotal: (sol) => `Ryntra takes nothing · ${sol}`,
    whatIs: 'What it is',
    whatDeposit:
      'Your USDC goes into your Phoenix account as collateral for Perps. Phoenix’s program holds it; Ryntra never does.',
    whatWithdraw: 'USDC leaves your Phoenix account back to this wallet. What stays covers your positions.',
    rentNote: 'The token account deposit opens an account for your wallet. It is rent on Solana and stays yours.',
    risk: 'Valid for about 30 seconds. Collateral can be lost to a liquidation.',
    validFor: (left) => `Valid for ${left}`,
    stale: 'Timed out — it is built again when you confirm',
    renewing: 'Building it again — the wallet opens by itself',
    details: 'Details',
    traderAccount: 'Phoenix account',
    program: 'Program',
    wallet: 'Wallet',
    confirm: 'Confirm in wallet',
    receiptDeposit: 'Perps deposit on Phoenix',
    receiptWithdraw: 'Perps withdrawal from Phoenix',
    receiptPending: 'Waiting for the network',
    receiptFailed: 'Did not go through',
    receiptNothing: 'Collateral did not move; the network fee was charged.',
    notSent: 'It was not sent. Nothing moved.',
    expected: 'expected, the network has not shown it yet',
    pendingLine: 'The network has not answered yet. It is not sent again — this screen follows it.',
    pendingStopped: 'The network did not answer in two minutes. It is not sent again — see it in the explorer.',
    network: 'Solana · Phoenix',
    explorer: 'View in explorer',
    again: 'New action',
    againWait: 'A new action opens once the network has answered.',
    failures: {
      ACTIONS_CLOSED: 'Deposits and withdrawals are not open for this wallet yet.',
      CANARY_LIMIT: 'The first check takes a smaller amount.',
      INSUFFICIENT_USDC: 'The wallet holds less USDC than this.',
      OVER_WITHDRAWABLE: 'More than the account may withdraw now.',
      ACCOUNT_NEEDED: 'This wallet has no Phoenix account yet.',
      DEPOSIT_CLOSED: 'Phoenix does not take a deposit on this account now.',
      WITHDRAW_CLOSED: 'Phoenix does not allow a withdrawal on this account now.',
      NEEDS_SOL: 'The wallet needs a little SOL for the network fee.',
      SIMULATION_FAILED:
        'Phoenix would refuse this now: a withdrawal limit, a pause after a deposit or the account’s state. Nothing was signed.',
      PHOENIX_UNAVAILABLE: 'Phoenix did not answer. Nothing was built.',
      RELAY_REFUSED: 'The network refused it before sending. Nothing moved.',
      WALLET_MISMATCH: 'The connected wallet changed. Review again.',
      RATE_LIMITED: 'Too many requests. Try again in a minute.',
      signIn: 'Sign in your wallet again to move collateral.',
      network: 'No connection. Nothing was sent.',
      walletRefused: 'The wallet did not sign. Nothing moved.',
      walletCancelled: 'Wallet approval was cancelled. Nothing was sent.',
      walletTimeout: 'Your wallet did not answer within 90 seconds. Nothing was sent — refresh the Review.',
      walletCannotSign:
        "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
      ledgerBlind:
        'The Ledger did not sign: “Blind signing” is off in its Solana app. Turn it on in the app’s settings and try again.',
      txVersion:
        'This transaction is in a format a Ledger cannot sign yet, so the wallet was not opened. Nothing was sent.',
      reviewAged:
        'The Review was built again — a transaction lives only about 30 seconds. Nothing was sent; check it and confirm.',
      deviceConfirm:
        'A transaction lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — refresh the Review.',
      outcomeUnknown:
        'The answer did not come back, and the transaction may have been sent. Check your Phoenix account before trying again.',
      general: 'Something went wrong. Nothing moved.',
    },
  },
  uk: {
    deposit: 'Поповнити',
    withdraw: 'Вивести',
    depositTitle: 'Поповнення Perps',
    withdrawTitle: 'Виведення з Perps',
    emptyLine: 'Поповни заставу USDC, щоб торгувати Perps.',
    amount: 'Сума, USDC',
    max: 'Макс',
    inWallet: (held) => `У гаманці: ${held}`,
    canWithdraw: (held) => `Можна вивести: ${held}`,
    review: 'Перевірити',
    preparing: 'Готую…',
    blocks: {
      minimum: 'Від 1 USDC.',
      overWallet: 'Більше, ніж у гаманці.',
      overWithdrawable: 'Більше, ніж рахунок може вивести зараз.',
      canary: 'Перша перевірка бере меншу суму.',
    },
    canaryAmount: (amount) => `Перша перевірка — до ${amount} USDC.`,
    walletShort: 'Поповнення бере USDC з цього гаманця. Спершу додай USDC у гаманець.',
    buyUsdc: 'Купити USDC',
    receiveUsdc: 'Отримати USDC',
    freeNow: (held) => `Доступно для угод на Phoenix: ${held}. Цього досить, щоб відкрити угоду.`,
    toTrade: 'Відкрити угоду',
    closed: 'Поповнення й виведення для цього гаманця ще не відкриті.',
    check: 'Перевірка',
    reviewDeposit: (amount) => `Поповнити Perps на Phoenix: ${amount} USDC`,
    reviewWithdraw: (amount) => `Вивести ${amount} USDC з Perps на Phoenix`,
    pay: 'Списується',
    get: 'Надходить',
    payWallet: (amount) => `${amount} USDC з твого гаманця`,
    payAccount: (amount) => `${amount} USDC застави на Phoenix`,
    getAccount: (amount) => `${amount} USDC застави на Phoenix`,
    getWallet: (amount) => `${amount} USDC у твій гаманець`,
    freeAfter: 'Вільно до виведення після',
    marginAfter: 'Маржа після',
    closerToLiquidation: 'Менша застава наближає рахунок до ліквідації.',
    costRyntra: 'Ryntra',
    costPhoenix: 'Phoenix',
    costNetwork: 'Мережа',
    costRent: 'Депозит токен-рахунку',
    costNone: '0',
    costsTotal: (sol) => `Ryntra не бере нічого · ${sol}`,
    whatIs: 'Що це',
    whatDeposit: 'Твої USDC ідуть на рахунок Phoenix заставою для Perps. Їх тримає програма Phoenix, не Ryntra.',
    whatWithdraw: 'USDC повертаються з рахунку Phoenix у цей гаманець. Те, що лишається, покриває твої позиції.',
    rentNote: 'Депозит токен-рахунку відкриває рахунок для твого гаманця. Це рента в Solana, і вона лишається твоєю.',
    risk: 'Дійсно близько 30 секунд. Заставу можна втратити через ліквідацію.',
    validFor: (left) => `Дійсно ще ${left}`,
    stale: 'Час минув — зберемо наново, щойно підтвердиш',
    renewing: 'Збираю наново — гаманець відкриється сам',
    details: 'Деталі',
    traderAccount: 'Рахунок Phoenix',
    program: 'Програма',
    wallet: 'Гаманець',
    confirm: 'Підтвердити в гаманці',
    receiptDeposit: 'Поповнення Perps на Phoenix',
    receiptWithdraw: 'Виведення з Perps на Phoenix',
    receiptPending: 'Чекаємо мережу',
    receiptFailed: 'Не пройшло',
    receiptNothing: 'Застава не рухалась; комісію мережі списано.',
    notSent: 'Не надіслано. Нічого не змінилося.',
    expected: 'очікувано, мережа ще не показала',
    pendingLine: 'Мережа ще не відповіла. Вдруге не надсилається — цей екран стежить за транзакцією.',
    pendingStopped: 'Мережа не відповіла за дві хвилини. Вдруге не надсилається — переглянь транзакцію в оглядачі.',
    network: 'Solana · Phoenix',
    explorer: 'Переглянути в оглядачі',
    again: 'Нова дія',
    againWait: 'Нова дія відкриється, щойно мережа відповість.',
    failures: {
      ACTIONS_CLOSED: 'Поповнення й виведення для цього гаманця ще не відкриті.',
      CANARY_LIMIT: 'Перша перевірка бере меншу суму.',
      INSUFFICIENT_USDC: 'У гаманці менше USDC, ніж ця сума.',
      OVER_WITHDRAWABLE: 'Більше, ніж рахунок може вивести зараз.',
      ACCOUNT_NEEDED: 'У цього гаманця ще немає рахунку Phoenix.',
      DEPOSIT_CLOSED: 'Phoenix зараз не приймає поповнення на цей рахунок.',
      WITHDRAW_CLOSED: 'Phoenix зараз не дозволяє виведення з цього рахунку.',
      NEEDS_SOL: 'Гаманцю потрібно трохи SOL на комісію мережі.',
      SIMULATION_FAILED:
        'Phoenix зараз відмовить: ліміт виведення, пауза після поповнення або стан рахунку. Нічого не підписано.',
      PHOENIX_UNAVAILABLE: 'Phoenix не відповів. Нічого не зібрано.',
      RELAY_REFUSED: 'Мережа відмовила ще до надсилання. Нічого не змінилося.',
      WALLET_MISMATCH: 'Підключений гаманець змінився. Перевір ще раз.',
      RATE_LIMITED: 'Забагато запитів. Спробуй за хвилину.',
      signIn: 'Увійди гаманцем ще раз, щоб рухати заставу.',
      network: "Немає зв'язку. Нічого не надіслано.",
      walletRefused: 'Гаманець не підписав. Нічого не змінилося.',
      walletCancelled: 'Підтвердження в гаманці скасовано. Нічого не надіслано.',
      walletTimeout: 'Гаманець не відповів за 90 секунд. Нічого не надіслано — онови «Перевірку».',
      walletCannotSign:
        'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
      ledgerBlind:
        'Ledger не підписав: у застосунку Solana на Ledger вимкнено «Blind signing». Увімкни його в налаштуваннях застосунку й спробуй знову.',
      txVersion: 'Цю транзакцію Ledger ще не вміє підписати, тож гаманець не відкрито. Нічого не надіслано.',
      reviewAged:
        '«Перевірку» зібрано наново — транзакція живе лише ~30 секунд. Нічого не надіслано; переглянь і підтверди.',
      deviceConfirm:
        'Транзакція живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — онови «Перевірку».',
      outcomeUnknown:
        'Відповідь не повернулася, і транзакція могла піти в мережу. Перевір рахунок Phoenix, перш ніж пробувати знову.',
      general: 'Щось пішло не так. Нічого не змінилося.',
    },
  },
}
