import type { Words } from '../../city/lib/i18n/dict.ts';
import type { ShareCardId } from './cards.ts';

/**
 * The share cards' words (`card.server.tsx`): the section's name above, its line in two parts — the second in lilac — and
 * the picture's alt. Short, what the section does, in the first rule's voice (decision 91): no promise of profit, no
 * safety talk on the card. A plain table with nothing imported at run time: the site's metadata reads it on every page.
 */
export type CardLine = { kick: string; lead: string; accent: string; alt: string };

export const SHARE_WORDS: Readonly<Record<ShareCardId, Words<CardLine>>> = {
  home: {
    en: { kick: 'AI terminal on Solana', lead: 'Say it.', accent: 'Your agent does the rest.', alt: 'Ryntra — say it, your AI agent does the rest: trade, launch coins and earn on Solana in one pro terminal.' },
    uk: { kick: 'AI-термінал на Solana', lead: 'Скажи.', accent: 'Агент зробить решту.', alt: 'Ryntra — скажи, і твій AI-агент зробить решту: торгівля, запуск монет і заробіток на Solana в одному терміналі.' },
  },
  swap: {
    en: { kick: 'Swap', lead: 'Any coin.', accent: 'One signature.', alt: 'Ryntra Swap — swap any coin on Solana by the best route, with one signature in your own wallet.' },
    uk: { kick: 'Обмін', lead: 'Будь-яка монета.', accent: 'Один підпис.', alt: 'Обмін у Ryntra — будь-яка монета Solana найкращим маршрутом, один підпис у твоєму гаманці.' },
  },
  launch: {
    en: { kick: 'Launch', lead: 'Your own coin,', accent: 'in a minute.', alt: 'Ryntra Launch — your own coin on Solana in a minute, trading on a Meteora pool from the first second.' },
    uk: { kick: 'Запуск', lead: 'Своя монета', accent: 'за хвилину.', alt: 'Запуск у Ryntra — твоя монета на Solana за хвилину, торгується в пулі Meteora з першої секунди.' },
  },
  earn: {
    en: { kick: 'Earn', lead: 'Pools, staking', accent: 'and lending.', alt: 'Ryntra Earn — Meteora pools, SOL staking and lending on Solana, from your own wallet.' },
    uk: { kick: 'Заробіток', lead: 'Пули, стейкінг', accent: 'і кредитування.', alt: 'Заробіток у Ryntra — пули Meteora, стейкінг SOL і кредитування на Solana з твого гаманця.' },
  },
  bots: {
    en: { kick: 'Bots', lead: 'Your rules,', accent: 'on autopilot.', alt: 'Ryntra Bots — grid, recurring buys, order ladders and signals that trade by your rules on Solana.' },
    uk: { kick: 'Боти', lead: 'Твої правила', accent: 'на автопілоті.', alt: 'Боти Ryntra — сітка, регулярні покупки, драбина ордерів і сигнали, що торгують за твоїми правилами на Solana.' },
  },
  agents: {
    en: { kick: 'Agents', lead: 'Your AI agent,', accent: 'your budget.', alt: 'Ryntra Agents — an AI agent that trades on Solana within the budget you set. Stop it any time.' },
    uk: { kick: 'Агенти', lead: 'Твій AI-агент,', accent: 'твій бюджет.', alt: 'Агенти Ryntra — AI-агент, що торгує на Solana в межах бюджету, який ти задаєш. Зупиниш будь-коли.' },
  },
  portfolio: {
    en: { kick: 'Portfolio', lead: 'All you hold,', accent: 'in one place.', alt: 'Ryntra Portfolio — every coin, pool and position of a Solana wallet in one place.' },
    uk: { kick: 'Портфель', lead: 'Усе твоє', accent: 'в одному місці.', alt: 'Портфель Ryntra — кожна монета, пул і позиція гаманця Solana в одному місці.' },
  },
  pool: {
    en: { kick: 'Meteora pool', lead: 'Swap it,', accent: 'or earn on it.', alt: 'A Meteora pool on Ryntra — its price, liquidity and a one-tap swap or position.' },
    uk: { kick: 'Пул Meteora', lead: 'Обмінюй', accent: 'або заробляй.', alt: 'Пул Meteora в Ryntra — його ціна, ліквідність і обмін чи позиція в один дотик.' },
  },
  docs: {
    en: { kick: 'Docs', lead: 'Every feature,', accent: 'explained.', alt: 'Ryntra Docs — how the AI terminal on Solana works: swap, launch, earn, bots, agents and every fee.' },
    uk: { kick: 'Документація', lead: 'Кожна функція', accent: 'простими словами.', alt: 'Документація Ryntra — як працює AI-термінал на Solana: обмін, запуск, заробіток, боти, агенти й кожна комісія.' },
  },
  help: {
    en: { kick: 'Help', lead: 'Ask anything.', accent: 'One form.', alt: 'Ryntra Help — ask a question, report a problem or share an idea in one form.' },
    uk: { kick: 'Допомога', lead: 'Питай будь-що.', accent: 'Одна форма.', alt: 'Допомога Ryntra — питання, проблема чи ідея в одній формі.' },
  },
};

/** The words a coin's and a pool's card draw beside the engine's figures (`coin.server.tsx`, `pool.server.tsx`). */
export const CARD_UI: Words<{
  network: string;
  price: string;
  change: string;
  marketCap: string;
  volume: string;
  liquidity: string;
  fees: string;
  swapFee: string;
  launch: string;
  verified: string;
  notVerified: string;
  fee: (pct: string) => string;
  trade: (symbol: string) => string;
  openPool: string;
  coinData: string;
  poolData: string;
}> = {
  en: {
    network: 'Solana',
    price: 'Price',
    change: '24h',
    marketCap: 'Market cap',
    volume: 'Volume 24h',
    liquidity: 'Liquidity',
    fees: 'Fees 24h',
    swapFee: 'Swap fee',
    launch: 'Ryntra Launch',
    verified: 'Verified by Jupiter',
    notVerified: 'Not verified by Jupiter',
    fee: (pct) => `Fee ${pct}`,
    trade: (symbol) => `Trade ${symbol} on ryntra.io`,
    openPool: 'Open the pool on ryntra.io',
    coinData: 'Market data: Jupiter',
    poolData: 'Pool data: Meteora',
  },
  uk: {
    network: 'Solana',
    price: 'Ціна',
    change: '24 год',
    marketCap: 'Капіталізація',
    volume: 'Обсяг за 24 год',
    liquidity: 'Ліквідність',
    fees: 'Комісії за 24 год',
    swapFee: 'Комісія обміну',
    launch: 'Ryntra Launch',
    verified: 'Перевірено Jupiter',
    notVerified: 'Не перевірено Jupiter',
    fee: (pct) => `Комісія ${pct}`,
    trade: (symbol) => `Торгуй ${symbol} на ryntra.io`,
    openPool: 'Відкрий пул на ryntra.io',
    coinData: 'Дані ринку: Jupiter',
    poolData: 'Дані пулу: Meteora',
  },
};
