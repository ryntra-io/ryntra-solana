import { SHARE_CARD_SIZE } from '../../../terminal/share/cards.ts';

/**
 * The size of every share card, 1200 × 630, by the name the Growth line's card page still imports
 * (`app/r/[code]/c/[card]/page.tsx`, a path of that line). The cards themselves are the terminal's (`terminal/share/`,
 * decision 105): no card shows the city. Once that page imports `SHARE_CARD_SIZE` from `terminal/share/cards.ts`, this
 * file goes.
 */
export const CITY_CARD_SIZE = SHARE_CARD_SIZE;
