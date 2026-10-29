/**
 * The words Rewards uses when it needs the wallet (Ріст 18). One sign-in, the header's own words — «Sign in with
 * wallet» — so a person recognises the signature they already know, and nothing that sounds like a second step.
 * Ukrainian speaks as the rest of Rewards does («ви»), so one panel never mixes the two.
 */
export type WalletCopy = Readonly<{
  /** The one action: the sign-in. */
  signIn: string;
  signing: string;
  /** What a signature is, in one line: one for all of Ryntra, no funds move. */
  once: string;
  checking: string;
  /** Per page: what the sign-in opens. */
  lead: Readonly<{ overview: string; boards: string; season: string; partners: string; kit: string }>;
  /** The invitation, when somebody tries to set it before signing in. */
  inviterFirst: string;
}>;

const EN: WalletCopy = {
  signIn: "Sign in with wallet",
  signing: "Confirm in your wallet…",
  once: "One signature for all of Ryntra. No funds move.",
  checking: "Checking your sign-in…",
  lead: {
    overview: "Sign in with your wallet to see your rewards.",
    boards: "Sign in with your wallet to see your place.",
    season: "Sign in with your wallet to see your tasks.",
    partners: "Sign in with your wallet to see your creator partners.",
    kit: "Sign in with your wallet to get your personal link.",
  },
  inviterFirst: "Sign in with your wallet first, then set your inviter.",
};

const UK: WalletCopy = {
  signIn: "Увійти гаманцем",
  signing: "Підтвердьте в гаманці…",
  once: "Один підпис для всієї Ryntra. Кошти не рухаються.",
  checking: "Перевіряємо вхід…",
  lead: {
    overview: "Увійдіть гаманцем, щоб побачити свої винагороди.",
    boards: "Увійдіть гаманцем, щоб побачити своє місце.",
    season: "Увійдіть гаманцем, щоб побачити свої завдання.",
    partners: "Увійдіть гаманцем, щоб побачити своїх творців.",
    kit: "Увійдіть гаманцем, щоб отримати особисте посилання.",
  },
  inviterFirst: "Спершу увійдіть гаманцем, потім вкажіть запрошувача.",
};

export function walletCopy(locale: string): WalletCopy {
  return locale === "uk" ? UK : EN;
}
