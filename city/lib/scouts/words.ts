import { words } from '../i18n/dict.ts';

/** The words «Scouts» writes outside the window: how long ago, and the post a scout shares on X (CITY-79). */
export const SCOUTS_LINE = words(
  {
    now: 'now',
    minutes: (n: number) => `${n}m`,
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
    post: 'Every Solana coin is a tower. Come build the city with me.',
  },
  {
    now: 'зараз',
    minutes: (n: number) => `${n} хв`,
    hours: (n: number) => `${n} год`,
    days: (n: number) => `${n} дн`,
    post: 'Кожна монета Solana — вежа. Будуймо місто разом.',
  },
);
