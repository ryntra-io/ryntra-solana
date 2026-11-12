import { readAsk, type AgentAsk } from '../autopilot/read.ts';
import { agentCoins, type Book, type Coin } from '../command/parse.ts';

/**
 * The first sentences (CITY-222): what a newcomer can say to the agent without thinking of words — one tap, and the
 * agent's card opens with the budget and «Sign». The same few sentences stand wherever a sentence is said: the line
 * (⌘K, «Ask Ryntra», the first screen's action) and «Your agents» in the bots window.
 *
 * Each is an ordinary sentence the agent's own reader takes (`../autopilot/read.ts` `readAsk`) — the chip is the person
 * saying it, never a second way in: a sentence the reader does not take is not offered. The amount is the budget a new
 * agent starts with on mainnet (0.1 SOL a day); the coin is a tower of the city the agent may buy, the operator's BONK first.
 * Pure: the line, the bots window and the tests read it as it is. No promise of a result is in any of them.
 */

export type SayKey = 'trade' | 'dip' | 'launch';
export type Say = Readonly<{ key: SayKey; text: string; ask: AgentAsk }>;

/** The towers a first sentence names, best known first; else the city's first tower the agent may buy. */
const KNOWN = ['BONK', 'WIF', 'JUP', 'PUMP'] as const;

export function sayCoin(book: Book): Coin | null {
  const coins = agentCoins(book, 16);
  for (const symbol of KNOWN) {
    const coin = coins.find((c) => c.symbol.toUpperCase() === symbol);
    if (coin) return coin;
  }
  return coins[0] ?? null;
}

const TEXT: Readonly<Record<'en' | 'uk', Readonly<Record<SayKey, (coin: string | null) => string>>>> = {
  en: {
    trade: (coin) => (coin ? `Trade ${coin} for me, 0.1 SOL a day` : 'Trade for me, 0.1 SOL a day'),
    dip: (coin) => (coin ? `Buy ${coin} on dips for me` : 'Buy the dips for me'),
    launch: () => 'Launch me a token',
  },
  uk: {
    // The operator's own sentence (CITY-186, checked on ryntra.io): short enough for a phone's row.
    trade: (coin) => (coin ? `Торгуй ${coin} на 0,1 SOL на день` : 'Торгуй за мене на 0,1 SOL на день'),
    dip: (coin) => (coin ? `Купуй ${coin} на просіданнях за мене` : 'Купуй на просіданнях за мене'),
    launch: () => 'Запусти мені токен',
  },
};

/** What this deployment's agents can take: trading on a budget, and the launch the agent prepares. */
export type SayGates = Readonly<{ trade: boolean; launch: boolean }>;

/**
 * The first sentences in the language on screen, at most three, each with the ask its words read into: the trade on a
 * budget first (the agent's first signature), then a strategy, then a launch when launching is open here.
 */
export function firstSentences(lang: 'en' | 'uk', book: Book, gates: SayGates): readonly Say[] {
  const coin = sayCoin(book)?.symbol ?? null;
  const keys: SayKey[] = [...(gates.trade ? (['trade', 'dip'] as const) : []), ...(gates.launch ? (['launch'] as const) : [])];
  const out: Say[] = [];
  for (const key of keys) {
    const text = TEXT[lang][key](coin);
    const ask = readAsk(text, book);
    if (ask && (key === 'launch' ? ask.kind === 'launch' : ask.kind === 'trade')) out.push({ key, text, ask });
  }
  return out;
}
