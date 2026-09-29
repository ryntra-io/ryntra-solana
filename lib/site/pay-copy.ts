import type { PublicLocale } from "./locale.ts";

/**
 * Copy for the public payer page at `/pay/:id`.
 *
 * A person who opens this link may never have heard of Ryntra. Every line
 * says what they are looking at and what will happen, in their words: no
 * protocol names where a plain one exists, no internal state names, and the
 * status vocabulary is exactly the owner's — awaiting, paid, expired, and an
 * honest "checking" or "unknown" when the chain could not be read.
 */
export type PayCopy = Readonly<{
  eyebrow: string;
  title: string;
  requestFrom: string;
  amountAny: string;
  forLabel: string;
  toLabel: string;
  expiresLabel: string;
  expiredLabel: string;
  networkLabel: string;
  network: string;

  statusAwaiting: string;
  statusPaid: string;
  statusExpired: string;
  statusChecking: string;
  statusUnknown: string;
  statusPending: string;
  noteUnderpaid: string;
  noteWrongToken: string;
  noteOverpaid: string;
  paidOn: string;
  viewTransaction: string;

  scanTitle: string;
  scanBody: string;
  openInWallet: string;
  openInApp: string;
  openInPhantom: string;
  openInSolflare: string;
  otherWallet: string;
  mobileHint: string;
  pageLinkLabel: string;

  payWithWallet: string;
  amountLabel: string;
  amountPlaceholder: string;
  chooseWallet: string;
  noWallet: string;
  connecting: string;
  connectedAs: string;
  change: string;
  preparing: string;
  confirmInWallet: string;
  sending: string;
  sent: string;
  payButton: string;
  payAgainHint: string;
  feeNote: string;
  createsAccountNote: string;
  errorGeneric: string;
  errorSelf: string;
  errorRefused: string;
  errorAmount: string;
  tryAgain: string;

  notFoundTitle: string;
  notFoundBody: string;
  poweredBy: string;
  aboutRyntra: string;
  language: string;
  detailsToggle: string;
  detailsHide: string;
  walletLinkLabel: string;
  referenceLabel: string;
}>;

const EN: PayCopy = {
  eyebrow: "PAYMENT REQUEST",
  title: "Payment request",
  requestFrom: "Pay to",
  amountAny: "Any amount",
  forLabel: "For",
  toLabel: "To",
  expiresLabel: "Valid until",
  expiredLabel: "Expired on",
  networkLabel: "Network",
  network: "Solana",

  statusAwaiting: "Awaiting payment",
  statusPaid: "Paid",
  statusExpired: "Expired",
  statusChecking: "Checking",
  statusUnknown: "Unknown",
  statusPending: "Payment sent, waiting for the network",
  noteUnderpaid: "A payment arrived, but less than this request asks for.",
  noteWrongToken: "A payment arrived in a different token than this request asks for.",
  noteOverpaid: "More arrived than this request asked for.",
  paidOn: "Paid on",
  viewTransaction: "View transaction",

  scanTitle: "Pay from your phone",
  scanBody: "Point your phone camera at the code. This page opens there and hands the payment to your wallet app.",
  openInWallet: "Open in wallet app",
  openInApp: "Open in a wallet app",
  openInPhantom: "Open in Phantom",
  openInSolflare: "Open in Solflare",
  otherWallet: "Other Solana wallet",
  mobileHint: "Open this page in your wallet app to pay. Phantom and Solflare open it inside the app.",
  pageLinkLabel: "Page link",

  payWithWallet: "Pay with wallet",
  amountLabel: "Amount",
  amountPlaceholder: "0.00",
  chooseWallet: "Choose a wallet in this browser",
  noWallet: "No Solana wallet found in this browser. Pay from your phone with the code, or install Phantom, Solflare or Backpack here.",
  connecting: "Check your wallet…",
  connectedAs: "Paying from",
  change: "Change",
  preparing: "Preparing the transaction…",
  confirmInWallet: "Confirm in your wallet.",
  sending: "Sending…",
  sent: "Sent. Waiting for the network to confirm.",
  payButton: "Pay",
  payAgainHint: "The page updates on its own once the payment is confirmed.",
  feeNote: "Your wallet pays the network fee.",
  createsAccountNote: "The recipient's account for this token does not exist yet; this payment creates it and covers its rent.",
  errorGeneric: "The payment could not be prepared.",
  errorSelf: "This request is addressed to the wallet you connected.",
  errorRefused: "The wallet did not sign. Nothing was sent.",
  errorAmount: "Enter an amount to pay.",
  tryAgain: "Try again",

  notFoundTitle: "This payment link does not exist",
  notFoundBody: "Check the link you were sent, or ask the person who sent it for a new one.",
  poweredBy: "Payment request by Ryntra",
  aboutRyntra: "What is Ryntra",
  language: "Language",
  detailsToggle: "Details",
  detailsHide: "Hide details",
  walletLinkLabel: "Wallet link",
  referenceLabel: "Request reference",
};

const UK: PayCopy = {
  eyebrow: "ЗАПИТ НА ОПЛАТУ",
  title: "Запит на оплату",
  requestFrom: "Кому",
  amountAny: "Будь-яка сума",
  forLabel: "За що",
  toLabel: "Кому",
  expiresLabel: "Дійсний до",
  expiredLabel: "Закінчився",
  networkLabel: "Мережа",
  network: "Solana",

  statusAwaiting: "Очікує оплати",
  statusPaid: "Оплачено",
  statusExpired: "Термін минув",
  statusChecking: "Перевіряємо",
  statusUnknown: "Невідомо",
  statusPending: "Платіж надіслано, чекаємо мережу",
  noteUnderpaid: "Платіж надійшов, але менший за суму запиту.",
  noteWrongToken: "Платіж надійшов в іншому токені, ніж просить цей запит.",
  noteOverpaid: "Надійшло більше, ніж просив цей запит.",
  paidOn: "Оплачено",
  viewTransaction: "Переглянути транзакцію",

  scanTitle: "Оплатити з телефона",
  scanBody: "Наведіть камеру телефона на код. Ця сторінка відкриється там і передасть платіж застосунку гаманця.",
  openInWallet: "Відкрити в застосунку гаманця",
  openInApp: "Відкрити в застосунку гаманця",
  openInPhantom: "Відкрити в Phantom",
  openInSolflare: "Відкрити в Solflare",
  otherWallet: "Інший гаманець Solana",
  mobileHint: "Відкрийте цю сторінку в застосунку гаманця, щоб оплатити. Phantom і Solflare відкривають її всередині застосунку.",
  pageLinkLabel: "Посилання на сторінку",

  payWithWallet: "Оплатити гаманцем",
  amountLabel: "Сума",
  amountPlaceholder: "0.00",
  chooseWallet: "Оберіть гаманець у цьому браузері",
  noWallet: "У цьому браузері немає гаманця Solana. Оплатіть з телефона через код або встановіть тут Phantom, Solflare чи Backpack.",
  connecting: "Перевірте гаманець…",
  connectedAs: "Платите з",
  change: "Змінити",
  preparing: "Готуємо транзакцію…",
  confirmInWallet: "Підтвердьте в гаманці.",
  sending: "Надсилаємо…",
  sent: "Надіслано. Чекаємо підтвердження мережі.",
  payButton: "Оплатити",
  payAgainHint: "Сторінка оновиться сама, щойно платіж підтвердиться.",
  feeNote: "Комісію мережі сплачує ваш гаманець.",
  createsAccountNote: "У отримувача ще немає рахунку для цього токена; цей платіж створить його і покриє оренду.",
  errorGeneric: "Не вдалося підготувати платіж.",
  errorSelf: "Цей запит адресований гаманцю, який ви підключили.",
  errorRefused: "Гаманець не підписав. Нічого не надіслано.",
  errorAmount: "Введіть суму для оплати.",
  tryAgain: "Спробувати ще раз",

  notFoundTitle: "Такого посилання на оплату немає",
  notFoundBody: "Перевірте посилання або попросіть у відправника нове.",
  poweredBy: "Запит на оплату від Ryntra",
  aboutRyntra: "Що таке Ryntra",
  language: "Мова",
  detailsToggle: "Деталі",
  detailsHide: "Сховати деталі",
  walletLinkLabel: "Посилання для гаманця",
  referenceLabel: "Ідентифікатор запиту",
};

export function payCopy(locale: PublicLocale): PayCopy {
  return locale === "uk" ? UK : EN;
}
