import { words } from '../../city/lib/i18n/dict.ts';

/**
 * The words of «Сітка» and «Сигнали» on the budget, in English and Ukrainian: the way the grid trades, a
 * grid's step and levels, a signal's condition and its number. A few choices and the budget card; nothing here promises a
 * result, and what is still being opened says «coming».
 */
export const BOT_BUDGET = words(
  {
    modeLabel: 'How the grid trades',
    modeOrders: 'Orders',
    modeBudget: 'Budget',
    stepLabel: 'Step',
    levelsLabel: 'Levels',
    signalLabel: 'Signal',
    numberLabel: 'How much',
    cross: 'Trend',
    above: 'Up',
    below: 'Down',
    move: 'Move',
    volume: 'Volume',
    pct: (n: string) => `${n}%`,
    times: (n: string) => `${n}×`,
    moneyComing: 'With money — coming · the week on paper is open',
  },
  {
    modeLabel: 'Як торгує сітка',
    modeOrders: 'Ордери',
    modeBudget: 'Бюджет',
    stepLabel: 'Крок',
    levelsLabel: 'Рівні',
    signalLabel: 'Сигнал',
    numberLabel: 'Наскільки',
    cross: 'Тренд',
    above: 'Вгору',
    below: 'Вниз',
    move: 'Рух',
    volume: 'Обіг',
    pct: (n) => `${n}%`,
    times: (n) => `${n}×`,
    moneyComing: 'З грошима — coming · тиждень на папері відкритий',
  },
);
