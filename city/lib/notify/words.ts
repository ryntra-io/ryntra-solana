import { words } from '../i18n/dict.ts';

/** What the centre's own notes say (CITY-87): one short line each, the coin by its ticker. */
export const NOTES = words(
  {
    bought: (coin: string) => `Bought ${coin}`,
    sold: (coin: string) => `Sold ${coin}`,
    tradeFailed: (coin: string) => `Trade did not go through · ${coin}`,
    stopReached: (coin: string) => `Stop reached · ${coin}`,
    stopLine: 'The sale is ready to sign.',
    beaconLit: (coin: string) => `Beacon lit · ${coin}`,
    liquidation: 'Liquidation risk',
  },
  {
    bought: (coin: string) => `Куплено ${coin}`,
    sold: (coin: string) => `Продано ${coin}`,
    tradeFailed: (coin: string) => `Угода не пройшла · ${coin}`,
    stopReached: (coin: string) => `Стоп спрацював · ${coin}`,
    stopLine: 'Продаж готовий до підпису.',
    beaconLit: (coin: string) => `Маяк засвітився · ${coin}`,
    liquidation: 'Ризик ліквідації',
  },
);
