import { pl, words } from '../../city/lib/i18n/dict.ts';
import type { DailyTaskKind } from '../world/contract.ts';

/**
 * The words of the day's panel over your quarter, in the city's languages (CITY-150, the operator's pass on the Seeker of
 * 29.10: «TODAY» and «PTS» in English on a Ukrainian screen). Points are «очки», as the product's dictionary says
 * (lib/words/dictionary.ts). The task lines follow the server's kinds.
 */
export const DAY_WORDS = words(
  {
    region: "Today's tasks and points",
    today: 'Today',
    pointsUnit: (points: number): string => (points === 1 ? 'point' : 'points'),
    head: (done: number, all: number, points: number) => `Today: ${done} of ${all} tasks done, ${points} points`,
    level: 'Level',
    levelLine: (level: number, toGo: number, next: number) => `Level ${level}, ${toGo} points to level ${next}`,
    levelTop: (level: number) => `Level ${level}, the top level`,
    toNext: (toGo: string, next: number) => `${toGo} to ${next}`,
    top: 'Top',
    add_floor: 'Add a floor',
    light_street: 'Light your street',
    visit_quarters: 'Visit 3 quarters',
    run: 'Run the skyline',
    coop_build: 'Build with your crew',
  },
  {
    region: 'Завдання дня й очки',
    today: 'Сьогодні',
    pointsUnit: (points: number) => pl(points, 'очко', 'очки', 'очок'),
    head: (done: number, all: number, points: number) => `Сьогодні: виконано ${done} з ${all}, ${points} ${pl(points, 'очко', 'очки', 'очок')}`,
    level: 'Рівень',
    levelLine: (level: number, toGo: number, next: number) => `Рівень ${level}, до рівня ${next} — ${toGo} ${pl(toGo, 'очко', 'очки', 'очок')}`,
    levelTop: (level: number) => `Рівень ${level}, найвищий`,
    toNext: (toGo: string, next: number) => `${toGo} до ${next}`,
    top: 'Найвищий',
    add_floor: 'Додай поверх',
    light_street: 'Освітли свою вулицю',
    visit_quarters: 'Відвідай 3 квартали',
    run: 'Пробіжи небосхил',
    coop_build: 'Будуй зі своєю командою',
  },
);

/** A task's line in the language on screen. */
export function taskWord(w: (typeof DAY_WORDS)['en'], kind: DailyTaskKind, fallback: string): string {
  const line = (w as Readonly<Record<string, unknown>>)[kind];
  return typeof line === 'string' ? line : fallback;
}
