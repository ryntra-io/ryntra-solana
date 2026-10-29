import type { ConnectionCopy } from "./connection-control";
import type { WorkspaceLocale } from "./locale";
import { DEFAULT_COPY } from "./connection-control";

const UK_COPY: ConnectionCopy = {
  panelTitle: "Підключення",
  connect: "Підключити",
  connectShort: "Гаманець",
  connecting: "Підключення…",
  waiting: "Очікування…",
  unavailableTitle: "Гаманець не виявлено",
  unavailableBody:
    "Ця сторінка не знайшла гаманця. Відкрий її в браузері з розширенням гаманця або користуйся поверхнями лише для читання.",
  disconnectedTitle: "Не підключено",
  chooseTitle: "Обери гаманець",
  disconnectedBody: "Підключення читає баланси. Нічого не підписується, доки ти цього не дозволиш.",
  address: "Адреса",
  network: "Мережа",
  capability: "Це підключення може",
  wrongNetwork: "Не та мережа",
  wrongNetworkBody: (network) => `Цей робочий простір працює в ${network}. Перемкни мережу, щоб продовжити.`,
  switchNetwork: (network) => (network ? `Перемкнути на ${network}` : "Перемкнути мережу"),
  pendingTitle: "Чекає на тебе",
  pendingBody: "У гаманці відкрито авторизацію. Нічого не відбувається, доки ти не відповіси.",
  copy: "Копіювати адресу",
  copied: "Скопійовано",
  explorer: "Відкрити в оглядачі",
  manage: "Керувати підключеннями",
  disconnect: "Відключити",
  errorTitle: "Гаманець не підключився",
  errorTitles: {
    REFUSED: "Гаманець відмовив",
    PENDING: "Гаманець уже питає",
    FAILED: "Гаманець не підключився",
  },
  pendingInWalletBody:
    "Відкрий розширення гаманця й дай відповідь на запит, який там уже чекає. Новий запит не піде, доки той не закрито.",
  retry: "Спробувати знову",
  reading: "Читання…",
  unavailable: "Недоступно",
  unknown: "Невідомо",
  capRead: "Читати баланси",
  capOwnership: "Підтвердити володіння",
  capSignMessage: "Підписувати авторизації",
  capSignTx: "Підписувати й надсилати транзакції",
  states: {
    UNAVAILABLE: "гаманець не виявлено",
    DISCONNECTED: "не підключено",
    CONNECTING: "підключення",
    CONNECTED: "підключено",
    WRONG_NETWORK: "підключено до іншої мережі",
    ACTION_PENDING: "очікує твоєї авторизації",
    ERROR: "гаманець не підключився",
  },
};

/**
 * The Ryntra **account**, which is not the wallet.
 *
 * A Ryntra account and a Solana wallet are two
 * security principals and stay that way — connecting Phantom authorizes nothing
 * in Control. This copy said `Connect wallet`, so on Control it asked a person
 * to connect a wallet they had plainly already connected. That reads as a
 * defect, and it teaches distrust of the one chip that must be believed.
 *
 * It now asks for what it actually wants, and says what the account is for. The
 * wallet has its own chip beside it and its own words.
 */
const RYNTRA_EN: Partial<ConnectionCopy> = {
  /* The panel's own name, and the short label a narrow viewport swaps in. Both
     were left on the wallet's words while only `connect` was corrected, so the
     control announced itself as "Connection — not connected" to a screen reader
     and rendered the single word "Wallet" on a phone. Same defect as the one
     this overlay was written for, in the two places it was not looked at. */
  panelTitle: "Ryntra account",
  connect: "Sign in",
  connectShort: "Sign in",
  unavailableTitle: "Signing in needs a browser wallet",
  unavailableBody:
    "Your Ryntra account is proved by a signature. Everything you can read here works without an account.",
  disconnectedTitle: "Not signed in to Ryntra",
  disconnectedBody:
    "Sign in to manage agents, policies and approvals. It is separate from your wallet: signing in moves nothing and authorizes no transfer.",
  capability: "This account has proved",
  manage: "Account",
};

const RYNTRA_UK: Partial<ConnectionCopy> = {
  panelTitle: "Акаунт Ryntra",
  connect: "Увійти",
  connectShort: "Увійти",
  unavailableTitle: "Щоб увійти, потрібен браузерний гаманець",
  unavailableBody:
    "Твій акаунт Ryntra підтверджується підписом. Усе, що можна прочитати тут, працює і без акаунта.",
  disconnectedTitle: "Вхід у Ryntra не виконано",
  disconnectedBody:
    "Увійди, щоб керувати агентами, політиками й підтвердженнями. Це окреме від гаманця: вхід нічого не переміщує і не авторизує жодного переказу.",
  capability: "Цей акаунт підтвердив",
  manage: "Акаунт",
};

export function connectionCopyFor(locale: WorkspaceLocale): ConnectionCopy {
  const base = locale === "uk" ? UK_COPY : DEFAULT_COPY;
  const overlay = locale === "uk" ? RYNTRA_UK : RYNTRA_EN;
  return { ...base, ...overlay };
}
