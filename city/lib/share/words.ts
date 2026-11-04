import type { Words } from '../i18n/dict.ts';

/**
 * The share card's words (`card.server.tsx`): the city's line in two parts, the second in amber, and the picture's alt.
 * A plain table with nothing imported at run time: the site's metadata reads it on every page (`app/seo.ts`).
 */
export type CardLine = { lead: string; accent: string; alt: string };

export const CARD_WORDS: Words<CardLine> = {
  en: {
    lead: 'Say it.',
    accent: 'Your agent does the rest.',
    alt: 'Ryntra — Say it. Your AI agent does the rest: launch coins, trade and earn on Solana on autopilot.',
  },
  uk: {
    lead: 'Скажи.',
    accent: 'Агент зробить решту.',
    alt: 'Ryntra — скажи, і твій AI-агент зробить решту: запуск монет, торгівля й заробіток на Solana на автопілоті.',
  },
};

/** The card of «Launched on Ryntra» (CITY-185, `/launches`): the same frame of the live city, its own line. */
export const LAUNCHES_CARD_WORDS: Words<CardLine> = {
  en: {
    lead: 'Launched on Ryntra.',
    accent: 'Every coin is a tower.',
    alt: 'Ryntra — every coin launched on Ryntra, each a tower of the live city on Solana.',
  },
  uk: {
    lead: 'Запущено на Ryntra.',
    accent: 'Кожна монета — вежа.',
    alt: 'Ryntra — усі монети, запущені на Ryntra, кожна — вежа живого міста на Solana.',
  },
};
