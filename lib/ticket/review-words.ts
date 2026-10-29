/**
 * The words a Review before a wallet's signature says the same way in every flow that has no quote of its own (SOL-C14,
 * audit UX 21.10 theme T5): a payment link, a limit's cancellation, a pool position's permission. «Комісія мережі» on
 * `/pay` reads as it does under «Мої ордери» and on a launch's pool. The frame — «Ти платиш», «Отримуєш», «Усі витрати»,
 * «Що це», «Підписати в гаманці» — is the core's `Review`; these are only its lines.
 *
 * These Reviews come before anything is built (the bytes are built after «Підписати в гаманці», their blockhash last,
 * as in SOL-S1), so the network's figure is the protocol's floor and the wallet shows the exact sum before it signs.
 */

export type ReviewLang = "en" | "uk";

/** The protocol's base fee for one signature. A wallet may add a priority fee on top; it shows the sum before signing. */
export const BASE_FEE_LAMPORTS = 5_000n;
/**
 * The rent of a classic SPL token account (165 bytes): paid once by whoever opens it, and it stays in the account. A
 * Token-2022 account is larger (170 bytes and more with the mint's extensions), so for a mint not known to be classic
 * this is a floor, never a ceiling.
 */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/** Mints known to be classic SPL tokens with no transfer fee: their new account costs exactly the classic rent. */
export const CLASSIC_MINTS: ReadonlySet<string> = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const WORDS = {
  en: {
    network: "Network fee",
    ryntra: "Ryntra",
    none: "0",
    from: "from {x}",
    upTo: "up to {x}",
    plus: "{a} + {b}",
    onlyNetwork: "Nothing — only the network fee",
    walletShowsFee: "Your wallet shows the exact network fee before you sign.",
    recipientAccount: "Recipient's token account, if they have none yet",
    tokenFee: "The token's own transfer fee",
    tokenFeeIfAny: "if it has one — it comes off what the recipient gets",
  },
  uk: {
    network: "Комісія мережі",
    ryntra: "Ryntra",
    none: "0",
    from: "від {x}",
    upTo: "до {x}",
    plus: "{a} + {b}",
    onlyNetwork: "Нічого — лише комісія мережі",
    walletShowsFee: "Точну комісію мережі гаманець покаже перед підписом.",
    recipientAccount: "Токен-рахунок отримувача, якщо його ще немає",
    tokenFee: "Власна комісія токена за переказ",
    tokenFeeIfAny: "якщо є — її віднімуть від того, що отримає отримувач",
  },
} as const satisfies Record<ReviewLang, Record<string, string>>;

export type ReviewWordKey = keyof (typeof WORDS)["en"];

export function reviewWord(lang: ReviewLang, key: ReviewWordKey, values: Readonly<Record<string, string>> = {}): string {
  return WORDS[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

/** Lamports as SOL, every digit kept: «0.000005 SOL», in Ukrainian «0,000005 SOL». */
export function reviewSol(lamports: bigint, lang: ReviewLang): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const fraction = (abs % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  const separator = lang === "uk" ? "," : ".";
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === "uk" ? " " : ",");
  return `${negative ? "−" : ""}${grouped}${fraction ? `${separator}${fraction}` : ""} SOL`;
}

/** The network's line of such a Review: the floor, said as a floor. */
export function reviewNetworkFrom(lang: ReviewLang, signatures = 1): string {
  return reviewWord(lang, "from", { x: reviewSol(BASE_FEE_LAMPORTS * BigInt(signatures), lang) });
}
