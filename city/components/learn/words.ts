import { words } from '../../lib/i18n/dict.ts';

/**
 * The words of «Learn» (CITY-202): the window's own few — the chapters themselves are the guide's
 * (`docs/learn/{en,uk}/`, read through `city/lib/learn/guide.generated.ts`).
 */
export const LEARN_WORDS = words(
  {
    title: 'Learn',
    kicker: 'Ryntra from A to Z',
    chapters: 'Chapters',
    allChapters: 'All chapters',
    chapter: (n: number) => `Chapter ${n}`,
    minutes: (n: number) => `${n} min read`,
    steps: 'What you press',
    flow: 'In one row',
    inside: 'How it works inside',
    honest: 'Honest notes',
    back: 'Back',
    next: (title: string) => `Next: ${title}`,
    done: 'Back to the city',
    shot: (title: string) => `${title} — a frame of the live city`,
  },
  {
    title: 'Навчання',
    kicker: 'Ryntra від А до Я',
    chapters: 'Глави',
    allChapters: 'Усі глави',
    chapter: (n: number) => `Глава ${n}`,
    minutes: (n: number) => `${n} хв читання`,
    steps: 'Що натискаєш',
    flow: 'Одним рядком',
    inside: 'Як це працює всередині',
    honest: 'Чесно',
    back: 'Назад',
    next: (title: string) => `Далі: ${title}`,
    done: 'Назад у місто',
    shot: (title: string) => `${title} — кадр живого міста`,
  },
);
