import { words } from '../i18n/dict.ts';

/**
 * The words Ryntra's city library writes for the screen (CITY-79): the ready questions and the city's own line while
 * Ryntra is away. The questions go to the assistant as written, so it answers in the same language.
 */
export const ASSISTANT_TEXT = words(
  {
    h24: '24H',
    risingLabel: 'What’s rising and why?',
    risingQuestion: 'What is rising on Solana today, and why?',
    fallingLabel: 'What’s falling?',
    fallingQuestion: 'What is falling on Solana today, and why?',
    towerLabel: (symbol: string) => `What’s with ${symbol}?`,
    towerQuestion: (symbol: string) => `What is happening with ${symbol} today, and why?`,
    nothingRising: 'Nothing is rising hard right now.',
    nothingFalling: 'Nothing is falling hard right now.',
    cannotAnswer: 'Ryntra can’t answer right now.',
    then: (symbols: string) => `, then ${symbols}`,
    noMove: (symbol: string) => `${symbol} has no move to show right now.`,
    leadsRise: (symbol: string, move: string, others: string) => `${symbol} leads the rise at ${move}${others}.`,
    fallsMost: (symbol: string, move: string, others: string) => `${symbol} falls the most at ${move}${others}.`,
    isAt: (symbol: string, move: string) => `${symbol} is at ${move}.`,
  },
  {
    h24: '24 год',
    risingLabel: 'Що росте і чому?',
    risingQuestion: 'Що сьогодні зростає на Solana і чому?',
    fallingLabel: 'Що падає?',
    fallingQuestion: 'Що сьогодні падає на Solana і чому?',
    towerLabel: (symbol: string) => `Що з ${symbol}?`,
    towerQuestion: (symbol: string) => `Що сьогодні відбувається з ${symbol} і чому?`,
    nothingRising: 'Зараз нічого різко не росте.',
    nothingFalling: 'Зараз нічого різко не падає.',
    cannotAnswer: 'Ryntra зараз не може відповісти.',
    then: (symbols: string) => `, далі ${symbols}`,
    noMove: (symbol: string) => `Для ${symbol} зараз немає руху, щоб показати.`,
    leadsRise: (symbol: string, move: string, others: string) => `${symbol} веде зростання: ${move}${others}.`,
    fallsMost: (symbol: string, move: string, others: string) => `${symbol} падає найбільше: ${move}${others}.`,
    isAt: (symbol: string, move: string) => `${symbol}: ${move}.`,
  },
);
