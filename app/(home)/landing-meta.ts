/**
 * What a search result, a shared link and the browser's tab say about the
 * landing — the plan of `RYN-SITE-V5-001` §3, word for word: the title within
 * 60 characters and the description within 160, so neither is cut in a result;
 * the Owner's line of 2026-09-26 on the share card, where there is room for it
 * (plan decision 5). Kept apart from the page's words so `app/seo.ts`, which
 * every route reads, carries nothing else of the landing.
 */

export type LandingMeta = Readonly<{ title: string; description: string; ogTitle: string; ogAlt: string }>;

export const LANDING_META: Readonly<Record<"en" | "uk", LandingMeta>> = {
  en: {
    title: "Ryntra — tokenized stocks from $1, in your own wallet",
    description: "Buy a piece of a company from $1 on Solana, or turn on Autoinvest by your own rule. It stays in your own wallet, and you sign every purchase.",
    ogTitle: "Ryntra — invest in tokenized stocks from $1, in your own wallet, on Solana",
    ogAlt: "Ryntra — invest in tokenized stocks from $1, in your own wallet, on Solana.",
  },
  uk: {
    title: "Ryntra — токенізовані акції від $1, у твоєму гаманці",
    description: "Купи частинку компанії від $1 на Solana або ввімкни «Автоінвест» за своїм правилом. Куплене лишається у твоєму гаманці, кожну купівлю підписуєш ти.",
    ogTitle: "Ryntra — інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana",
    ogAlt: "Ryntra — інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana.",
  },
};
