import { words } from '../../city/lib/i18n/dict.ts';

/**
 * The coin page's own words for its head's second row, its «About the coin» block and the phone's one screen: the
 * views a phone switches between, the quick sums over Buy and Sell, the one sentence about the coin. Facts and verbs
 * only — no advice to buy or sell.
 */
export const HEAD = words(
  {
    // The phone's views of the coin.
    views: 'Coin views',
    chart: 'Chart',
    trades: 'Trades',
    holders: 'Holders',
    pools: 'Pools',
    about: 'About',
    mine: 'Mine',
    // The quick sums over Buy and Sell on a phone: a tap fills the ticket; the person still confirms there.
    quick: 'Quick amount',
    quickBuy: (sum: string) => `Buy for ${sum}`,
    // «About the coin».
    inShort: 'In short',
  },
  {
    views: 'Вкладки монети',
    chart: 'Графік',
    trades: 'Угоди',
    holders: 'Власники',
    pools: 'Пули',
    about: 'Про монету',
    mine: 'Мої',
    quick: 'Швидка сума',
    quickBuy: (sum: string) => `Купити на ${sum}`,
    inShort: 'Коротко',
  },
);
