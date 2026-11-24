import { words } from '../../city/lib/i18n/dict.ts';

/** The coin chart's own words for its layers and marks, in English and Ukrainian with the same keys. */
export const CHART = words(
  {
    layers: 'Chart layers',
    liquidity: 'Liquidity and my positions',
    marks: 'Trade marks',
    youBought: (usd: string) => `You bought ${usd}`,
    youSold: (usd: string) => `You sold ${usd}`,
    creatorBought: (usd: string) => `Creator bought ${usd}`,
    creatorSold: (usd: string) => `Creator sold ${usd}`,
    listed: 'Moved to a DEX',
    entry: 'Avg entry',
  },
  {
    layers: 'Шари графіка',
    liquidity: 'Ліквідність і мої позиції',
    marks: 'Позначки угод',
    youBought: (usd: string) => `Твоя купівля ${usd}`,
    youSold: (usd: string) => `Твій продаж ${usd}`,
    creatorBought: (usd: string) => `Творець купив ${usd}`,
    creatorSold: (usd: string) => `Творець продав ${usd}`,
    listed: 'Вийшла на біржу',
    entry: 'Середній вхід',
  },
);
