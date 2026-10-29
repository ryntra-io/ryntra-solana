import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of «З іншої мережі» — money from another network or an exchange,
 * sent to an address, with no second wallet (SOL-W1). Their own file, so the
 * money flows that share `invest-words.ts` are not edited for them.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const DEPOSIT_WORDS = {
  wayTitle: bi("From another network", "З іншої мережі"),
  waySub: bi("USDC from Base, Ethereum and more", "USDC з Base, Ethereum та інших"),
  pick: bi("Where is your USDC?", "Де твої USDC?"),
  addressLabel: bi("Send USDC to this address", "Надішли USDC на цю адресу"),
  scan: bi("Scan to send USDC", "Скануй, щоб надіслати USDC"),
  loading: bi("Getting your address…", "Готуємо твою адресу…"),
  failed: bi("The address is not available right now.", "Адреса зараз недоступна."),
  retry: bi("Try again", "Спробувати ще раз"),
  onTheWay: bi("Money is on the way — it arrives in your Solana wallet by itself.", "Гроші в дорозі — прийдуть у гаманець Solana самі."),
  refunded: bi("Relay could not deliver this deposit and returned it.", "Relay не зміг доставити це поповнення й повернув його."),
  failedFill: bi("Relay could not deliver this deposit. Write to support and add this address.", "Relay не зміг доставити це поповнення. Напиши в підтримку й додай цю адресу."),
  exchangeOther: bi("No Solana on your exchange? Withdraw USDC on another network — “From another network”.", "На біржі немає Solana? Виведи USDC в іншій мережі — «З іншої мережі»."),
  /* B18: the guest's page, the side column and where-and-how-long in each way's row. */
  needsTitle: bi("What a purchase needs", "Що потрібно для покупок"),
  addressLater: bi("Your Solana address appears here once a wallet is connected.", "Твоя адреса Solana з'явиться тут, щойно підключиш гаманець."),
  addressTitle: bi("Your Solana address", "Твоя адреса Solana"),
  recentIncoming: bi("Recent incoming", "Останні надходження"),
  walletTime: bi("seconds", "за секунди"),
  exchangeTime: bi("1–30 min", "1–30 хв"),
  networkTime: bi("about a minute", "≈ 1 хв"),
} as const satisfies Record<string, Bi>;

export type DepositWord = keyof typeof DEPOSIT_WORDS;

export function depositWords(locale: WorkspaceLocale): (word: DepositWord) => string {
  return (word) => DEPOSIT_WORDS[word][locale];
}

/** «Лише USDC у мережі Base, від $1 — інші монети можна втратити.» */
export function depositNote(locale: WorkspaceLocale, network: string, minUsd: number): string {
  return locale === "uk"
    ? `Лише USDC у мережі ${network}, від $${minUsd} — інші монети можна втратити.`
    : `Only USDC on ${network}, from $${minUsd} — other coins can be lost.`;
}

/** «Прийде як USDC за хвилину · плата за доставку ≈ $0.03 з $10 (Relay)» — what the quote named, on the sum it was asked for. */
export function depositFee(locale: WorkspaceLocale, feeUsd: number | null, referenceUsd: number): string {
  const fee = feeUsd === null ? null : feeUsd < 0.01 ? "< $0.01" : `≈ $${feeUsd.toFixed(2)}`;
  if (locale === "uk") return fee ? `Прийде як USDC за хвилину · плата за доставку ${fee} з $${referenceUsd} (Relay).` : "Прийде як USDC за хвилину (Relay).";
  return fee ? `Arrives as USDC in about a minute · delivery fee ${fee} on $${referenceUsd} (Relay).` : "Arrives as USDC in about a minute (Relay).";
}

/** «У гаманці +9.97 USDC» — the wallet's USDC rose while the address was on screen, or Relay filled the deposit. */
export function depositArrived(locale: WorkspaceLocale, amount: string | null): string {
  if (amount === null) return locale === "uk" ? "USDC прийшли в гаманець Solana." : "USDC arrived in your Solana wallet.";
  return locale === "uk" ? `У гаманці Solana +${amount} USDC.` : `Your Solana wallet: +${amount} USDC.`;
}
