import { words } from '../../../city/lib/i18n/dict.ts';

/**
 * The words of a position in a stock's DLMM pool put in with two coins, beside the Earn ticket's own
 * (`terminal/earn/words.ts`, read only): the second field, what the wallet lacks, the pool's space that does not come
 * back, the issuer's pause, and what stands behind «i». A person's words, never the token program's; no promise of income.
 */
export const DLMM_STOCK = words(
  {
    together: 'Together with',
    follows: 'The second amount follows the pool’s price: the same worth of each.',
    noSwap: 'Nothing swapped',
    twoCoins: 'Both coins go in as they are, from your wallet — nothing is swapped and Ryntra adds no fee.',
    short: (symbol: string) => `Not enough ${symbol} in the wallet.`,
    shortSol: 'Keep some SOL aside for the position’s deposit and the network.',
    get: (symbol: string) => `Buy ${symbol}`,
    kept: 'Pool space',
    keptBack: 'does not come back',
    paused: 'The issuer paused this token. Deposits wait until it resumes.',
    closed: 'Adding to this pool is not open to this wallet yet.',
    exitWhy: 'Take the fees, leave or close the position in Earn → My positions, whenever you want.',
    standTitle: 'ANT · USDC · DLMM',
    standPool: 'ANT · USDC',
  },
  {
    together: 'Разом із',
    follows: 'Друга сума йде за ціною пулу: однаково вартості кожної монети.',
    noSwap: 'Без обміну',
    twoCoins: 'Обидві монети лягають як є, з твого гаманця — нічого не обмінюється, і Ryntra не бере комісії.',
    short: (symbol: string) => `Бракує ${symbol} у гаманці.`,
    shortSol: 'Залиш трохи SOL на депозит позиції й мережу.',
    get: (symbol: string) => `Купити ${symbol}`,
    kept: 'Місце в пулі',
    keptBack: 'не повертається',
    paused: 'Емітент зупинив цей токен. Внески чекають, доки він не відновить.',
    closed: 'Додавання в цей пул для цього гаманця ще не відкрите.',
    exitWhy: 'Забрати комісії, вийти чи закрити позицію — у «Заробіток» → «Мої позиції», коли захочеш.',
    standTitle: 'ANT · USDC · DLMM',
    standPool: 'ANT · USDC',
  },
);
