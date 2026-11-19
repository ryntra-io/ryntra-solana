import { readAsk, type AgentAsk } from '../autopilot/read.ts';
import { agentCoins, type Book, type Coin } from '../command/parse.ts';

/**
 * The first sentences: what a newcomer can say to the agent without thinking of words — one tap, and the
 * agent's card opens with the budget and «Sign». The same few sentences stand wherever a sentence is said: the line
 * (⌘K, «Ask Ryntra», the first screen's action) and «Your agents» in the bots window.
 *
 * Each is an ordinary sentence the agent's own reader takes (`../autopilot/read.ts` `readAsk`) — the chip is the person
 * saying it, never a second way in: a sentence the reader does not take is not offered. Decision 108: no sum in an example — the budget is the person's, and the card asks her for it — and no coin
 * advertised: only Jupiter's JUP and Meteora's MET, whose data and routes the agent stands on.
 * Pure: the line, the bots window and the tests read it as it is. No promise of a result is in any of them.
 */

export type SayKey = 'trade' | 'dip' | 'launch';
export type Say = Readonly<{ key: SayKey; text: string; ask: AgentAsk }>;

/** The only coins an example or a default names (decision 108): Jupiter's and Meteora's — never the market's best. */
export const SAY_COINS = ['JUP', 'MET'] as const;

/** The coins of `SAY_COINS` the city's book has, in that order. */
export function sayCoins(book: Book): readonly Coin[] {
  const coins = agentCoins(book, Number.MAX_SAFE_INTEGER);
  return SAY_COINS.map((symbol) => coins.find((c) => c.symbol.toUpperCase() === symbol)).filter((c): c is Coin => Boolean(c));
}

/** The coin an example names: JUP, else MET; null when the book has neither — the sentence then names no coin. */
export function sayCoin(book: Book): Coin | null {
  return sayCoins(book)[0] ?? null;
}

const TEXT: Readonly<Record<'en' | 'uk', Readonly<Record<SayKey, (coin: string | null) => string>>>> = {
  en: {
    trade: (coin) => (coin ? `Trade ${coin} for me every day` : 'Trade for me every day'),
    dip: (coin) => (coin ? `Buy ${coin} on dips for me` : 'Buy the dips for me'),
    launch: () => 'Launch me a token',
  },
  uk: {
    // Short enough for a phone's row; the sum is hers to say (decision 108).
    trade: (coin) => (coin ? `Торгуй ${coin} за мене щодня` : 'Торгуй за мене щодня'),
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
  // The trade names JUP, the dips MET — each the book's when it has it, the other one else.
  const coins = sayCoins(book).map((c) => c.symbol);
  const coinOf = (key: SayKey) => (key === 'dip' ? (coins[1] ?? coins[0] ?? null) : (coins[0] ?? null));
  const keys: SayKey[] = [...(gates.trade ? (['trade', 'dip'] as const) : []), ...(gates.launch ? (['launch'] as const) : [])];
  const out: Say[] = [];
  for (const key of keys) {
    const text = TEXT[lang][key](coinOf(key));
    const ask = readAsk(text, book);
    if (ask && (key === 'launch' ? ask.kind === 'launch' : ask.kind === 'trade')) out.push({ key, text, ask });
  }
  return out;
}
