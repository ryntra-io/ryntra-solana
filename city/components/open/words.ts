import { words } from '../../lib/i18n/dict.ts';

/**
 * The city's 404 and 500, in both languages: what happened, in one line, and the one way back.
 * The tab's title says the same as the page.
 */
export const LOST = words(
  {
    missing: 'Nothing stands here',
    broken: 'Something broke on our side',
    missingTitle: 'Not found — Ryntra',
    brokenTitle: 'Something broke — Ryntra',
    toCity: 'To the city',
  },
  {
    missing: 'Тут нічого не стоїть',
    broken: 'У нас щось зламалося',
    missingTitle: 'Не знайдено — Ryntra',
    brokenTitle: 'Щось зламалося — Ryntra',
    toCity: 'До міста',
  },
);
