/**
 * The words of the assistant's «Кредити» tab, the purchase of a package and the badge — the web's words
 * (`app/app/ryn/ryn-words.ts`, credits*, entry*, price*, buy*, order*), shortened where a phone has the room of a
 * line. Credits are the service's own units: never a token, never paid out.
 */

import type { AssistantCreditEntry, AssistantCreditOrder, AssistantCredits } from '../../lib/api/v1/types.ts'
import type { Copy } from '../../lib/i18n.ts'
import type { PayFailure } from '../money/send-flow.ts'

type PriceKey = keyof AssistantCredits['prices']

export type CreditsCopy = Readonly<{
  balance: string
  /** «≈ 12 питань» under the balance. */
  questions: (count: number, figure: string) => string
  freeToday: (left: string, daily: string) => string
  freeNew: (at: string) => string
  dayCap: (used: string, cap: string, at: string) => string
  readAt: (at: string) => string
  topUp: string
  howTitle: string
  what: (count: number, figure: string) => string
  whatNoFree: string
  what2: string
  rate: string
  account: string
  readFailed: string
  welcome: string
  welcomeNote: string
  welcomeDone: (credits: string) => string
  welcomeTaken: string
  welcomeNo: string
  welcomeLater: string
  buyTitle: string
  buyClosed: string
  buyNote: (treasury: string) => string
  buyRules: string
  orderFailed: string
  orderLimit: string
  orderTitle: (usdc: string, credits: string) => string
  amount: string
  to: string
  treasury: string
  validUntil: string
  timeLeft: string
  minutes: (count: number) => string
  sign: string
  preparing: string
  waitingWallet: string
  sending: string
  status: Readonly<Record<AssistantCreditOrder['status'], string>>
  awaitingUntil: (at: string) => string
  checking: string
  underpaid: (received: string, usdc: string, credited: string) => string
  expired: string
  credited: (credits: string) => string
  sent: string
  notConfirmed: string
  unconfirmed: string
  wrongToken: string
  failures: Readonly<Record<PayFailure['key'], string>>
  signIn: string
  receipt: string
  receiptPaid: string
  receiptCredits: string
  receiptOrder: string
  receiptTx: string
  copy: string
  copied: string
  explorer: string
  purchases: string
  openOrder: string
  purchasesLine: (count: number) => string
  noPurchases: string
  ordersFailed: string
  history: string
  historyLine: string
  noHistory: string
  prices: string
  pricesLine: string
  priceRows: Readonly<Record<PriceKey, string>>
  entry: Readonly<Record<AssistantCreditEntry['kind'], string>>
  entryPurchase: string
  entrySecondWelcome: string
  reason: Readonly<Record<NonNullable<AssistantCreditEntry['reason']>, string>>
  close: string
  /** The badge's spoken label: «Кредити: 1 500». */
  badge: (balance: string) => string
}>

/** One, few, many: «1 питання», «3 хвилини», «5 покупок». */
function ukPlural(count: number, one: string, few: string, many: string): string {
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return one
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few
  return many
}

const EN: CreditsCopy = {
  balance: 'Balance',
  questions: (count, figure) => `≈ ${figure} ${count === 1 ? 'question' : 'questions'} with the model`,
  freeToday: (left, daily) => `Free today: ${left} of ${daily}`,
  freeNew: (at) => `new ones ${at}`,
  dayCap: (used, cap, at) => `Day’s limit: ${used} of ${cap} · resets ${at}`,
  readAt: (at) => `Read ${at}`,
  topUp: 'Top up',
  howTitle: 'What credits are',
  what: (count, figure) =>
    `Credits pay for the model’s answers: ${figure} ${count === 1 ? 'question' : 'questions'} free every day, then the balance.`,
  whatNoFree: 'Credits pay for the model’s answers.',
  what2: 'An answer from the data Ryntra read is always free; credits are never a token and are not paid out.',
  rate: '1,000 credits = 1 USDC',
  account: 'Shared with your account.',
  readFailed: 'The credits could not be read right now',
  welcome: 'Get the welcome credits',
  welcomeNote: 'Once per wallet and account, for a wallet older than 30 days with 10 transactions.',
  welcomeDone: (credits) => `Welcome credits added: +${credits}`,
  welcomeTaken: 'The welcome credits were already given.',
  welcomeNo: 'This wallet does not meet the welcome terms yet; the free credits of every day are yours.',
  welcomeLater: 'The welcome credits cannot be given right now — try again in a minute.',
  buyTitle: 'Buy credits',
  buyClosed: 'Buying credits for USDC is not open here yet.',
  buyNote: (treasury) => `Paid in USDC on Solana to Ryntra’s treasury ${treasury}; credits never expire.`,
  buyRules:
    'Less than the price: credits for what arrived, without the bonus. More: the package and the rest at 1,000 for 1 USDC.',
  orderFailed: 'The order could not be opened — try again in a minute.',
  orderLimit: 'Too many orders this hour; an open one can still be paid.',
  orderTitle: (usdc, credits) => `${usdc} USDC — ${credits}`,
  amount: 'Amount',
  to: 'To',
  treasury: 'Ryntra’s treasury',
  validUntil: 'Valid until',
  timeLeft: 'Time left',
  minutes: (count) => `${count} min`,
  sign: 'Sign with your wallet',
  preparing: 'Preparing the payment…',
  waitingWallet: 'Waiting for the wallet…',
  sending: 'Sending…',
  status: { awaiting: 'Waiting', checking: 'Checking', underpaid: 'Short', paid: 'Paid', expired: 'Time is up' },
  awaitingUntil: (at) => `Waiting for the payment · until ${at}`,
  checking: 'The network did not answer — checking again.',
  underpaid: (received, usdc, credited) =>
    `${received} of ${usdc} USDC arrived — ${credited} added at the base rate, without the bonus.`,
  expired: 'The order’s time is up and nothing has arrived; a late payment is credited when it lands.',
  credited: (credits) => `Credited ${credits}`,
  sent: 'Sent. Waiting for the network to confirm.',
  notConfirmed: 'Not confirmed',
  unconfirmed: 'The payment is not confirmed yet. The order updates on its own — do not pay it again.',
  wrongToken: 'Another token arrived — no credits for it; write to Ryntra’s support to have it returned.',
  failures: {
    payFailed: 'The payment could not be prepared.',
    payRefused: 'The wallet did not sign. Nothing was sent.',
    paySelf: 'This order is paid to the wallet you connected.',
    payPending: 'A payment for this order is already on its way.',
    payLate:
      'A payment lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — sign again.',
    payCannotSign:
      "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
    network: 'No connection. Nothing was sent.',
    signIn: 'Sign in with your wallet to pay this order.',
  },
  signIn: 'Sign in with the wallet',
  receipt: 'Receipt',
  receiptPaid: 'Paid',
  receiptCredits: 'Credits',
  receiptOrder: 'Order',
  receiptTx: 'Transaction',
  copy: 'Copy',
  copied: 'Copied',
  explorer: 'Open in Solscan',
  purchases: 'Purchases',
  openOrder: 'Open the order',
  purchasesLine: (count) => `${count} ${count === 1 ? 'order' : 'orders'} · receipts`,
  noPurchases: 'No purchases yet',
  ordersFailed: 'The purchases could not be read right now',
  history: 'History',
  historyLine: 'Added and spent',
  noHistory: 'Nothing spent yet.',
  prices: 'Prices',
  pricesLine: 'What each answer costs',
  priceRows: {
    question: 'Question',
    alertExplain: 'Alert explained',
    tokenReport: 'Token report',
    priceMove: 'What moved the price?',
    voice: 'Voice, per 30 s',
    deep: 'Deep analysis',
    plan: 'Plan with critic',
  },
  entry: {
    grant: 'Added',
    hold: 'Held',
    capture: 'Spent',
    release: 'Returned',
    expire: 'Returned',
    'merge-out': 'Moved to the account',
    'merge-in': 'From the wallet',
  },
  entryPurchase: 'Bought',
  entrySecondWelcome: 'A second welcome — not carried to the account',
  reason: { welcome: 'welcome', purchase: 'purchase', adjust: 'adjustment' },
  close: 'Close',
  badge: (balance) => `Credits: ${balance}`,
}

const UK: CreditsCopy = {
  balance: 'Баланс',
  questions: (count, figure) => `≈ ${figure} ${ukPlural(count, 'питання', 'питання', 'питань')} з моделлю`,
  freeToday: (left, daily) => `Безкоштовно сьогодні: ${left} з ${daily}`,
  freeNew: (at) => `нові ${at}`,
  dayCap: (used, cap, at) => `Денний ліміт: ${used} з ${cap} · оновиться ${at}`,
  readAt: (at) => `Прочитано ${at}`,
  topUp: 'Поповнити',
  howTitle: 'Що таке кредити',
  what: (count, figure) =>
    `Кредити платять за відповіді моделі: щодня ${figure} ${ukPlural(count, 'питання', 'питання', 'питань')} безкоштовно, далі — баланс.`,
  whatNoFree: 'Кредити платять за відповіді моделі.',
  what2: 'Відповідь із прочитаних даних — завжди безкоштовна; кредити — не токен і не виводяться.',
  rate: '1 000 кредитів = 1 USDC',
  account: 'Спільні з твоїм акаунтом.',
  readFailed: 'Кредити зараз не прочитати',
  welcome: 'Отримати вітальні кредити',
  welcomeNote: 'Раз на гаманець і акаунт — для гаманця від 30 днів і з 10 транзакціями.',
  welcomeDone: (credits) => `Вітальні кредити додано: +${credits}`,
  welcomeTaken: 'Вітальні кредити вже отримано.',
  welcomeNo: 'Гаманець поки не відповідає умовам вітальних; безкоштовні щодня — твої.',
  welcomeLater: 'Вітальні зараз не видати — спробуй за хвилину.',
  buyTitle: 'Купити кредити',
  buyClosed: 'Купівля кредитів за USDC тут ще не відкрита.',
  buyNote: (treasury) => `Оплата в USDC у Solana на казну Ryntra ${treasury}; кредити не згорають.`,
  buyRules: 'Менше за ціну — кредити за те, що прийшло, без бонусу. Більше — пакет і решта по 1 000 за 1 USDC.',
  orderFailed: 'Замовлення не відкрилось — спробуй за хвилину.',
  orderLimit: 'Забагато замовлень за годину; відкрите ще можна оплатити.',
  orderTitle: (usdc, credits) => `${usdc} USDC — ${credits}`,
  amount: 'Сума',
  to: 'Кому',
  treasury: 'Казна Ryntra',
  validUntil: 'Діє до',
  timeLeft: 'Лишилось',
  minutes: (count) => `${count} хв`,
  sign: 'Підписати в гаманці',
  preparing: 'Готуємо платіж…',
  waitingWallet: 'Очікування гаманця…',
  sending: 'Надсилаємо…',
  status: {
    awaiting: 'Чекає оплати',
    checking: 'Перевіряємо',
    underpaid: 'Недоплата',
    paid: 'Оплачено',
    expired: 'Час минув',
  },
  awaitingUntil: (at) => `Чекаємо на оплату · до ${at}`,
  checking: 'Мережа не відповіла — перевіряємо ще раз.',
  underpaid: (received, usdc, credited) =>
    `Прийшло ${received} з ${usdc} USDC — додано ${credited} за базовим курсом, без бонусу.`,
  expired: 'Час замовлення минув, оплати немає; пізня оплата зарахується, щойно надійде.',
  credited: (credits) => `Зараховано ${credits}`,
  sent: 'Надіслано. Чекаємо підтвердження мережі.',
  notConfirmed: 'Не підтверджено',
  unconfirmed: 'Платіж ще не підтверджено. Замовлення оновиться саме — не оплачуй його вдруге.',
  wrongToken: 'Прийшов інший токен — кредитів за нього немає; напиши в підтримку Ryntra, щоб повернути.',
  failures: {
    payFailed: 'Не вдалося підготувати платіж.',
    payRefused: 'Гаманець не підписав. Нічого не надіслано.',
    paySelf: 'Це замовлення оплачується на гаманець, що зараз під’єднаний.',
    payPending: 'Платіж за цим замовленням уже в дорозі.',
    payLate:
      'Оплата живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — підпиши ще раз.',
    payCannotSign:
      'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
    network: 'Немає з’єднання. Нічого не надіслано.',
    signIn: 'Увійди гаманцем, щоб оплатити це замовлення.',
  },
  signIn: 'Увійти гаманцем',
  receipt: 'Квитанція',
  receiptPaid: 'Сплачено',
  receiptCredits: 'Кредити',
  receiptOrder: 'Замовлення',
  receiptTx: 'Транзакція',
  copy: 'Копіювати',
  copied: 'Скопійовано',
  explorer: 'Відкрити в Solscan',
  purchases: 'Покупки',
  openOrder: 'Відкрити замовлення',
  purchasesLine: (count) => `${count} ${ukPlural(count, 'замовлення', 'замовлення', 'замовлень')} · квитанції`,
  noPurchases: 'Покупок ще немає',
  ordersFailed: 'Покупки зараз не прочитати',
  history: 'Історія',
  historyLine: 'Що додано й витрачено',
  noHistory: 'Ще нічого не витрачено.',
  prices: 'Ціни',
  pricesLine: 'Скільки коштує кожна відповідь',
  priceRows: {
    question: 'Питання',
    alertExplain: 'Пояснення сповіщення',
    tokenReport: 'Звіт по токену',
    priceMove: 'Що зрушило ціну?',
    voice: 'Голос, за 30 с',
    deep: 'Глибокий аналіз',
    plan: 'План із критиком',
  },
  entry: {
    grant: 'Додано',
    hold: 'Зарезервовано',
    capture: 'Списано',
    release: 'Повернено',
    expire: 'Повернено',
    'merge-out': 'Перенесено на акаунт',
    'merge-in': 'З гаманця',
  },
  entryPurchase: 'Куплено',
  entrySecondWelcome: 'Другі вітальні — на акаунт не переносяться',
  reason: { welcome: 'вітальні', purchase: 'покупка', adjust: 'коригування' },
  close: 'Закрити',
  badge: (balance) => `Кредити: ${balance}`,
}

export const CREDITS_COPY: Copy<CreditsCopy> = { en: EN, uk: UK }
