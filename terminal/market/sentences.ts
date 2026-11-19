import type { Kind } from '../../city/lib/command/parse.ts';

/**
 * The ready sentences under «Your agent does it for you». Each stands only when the agent's line would read it as
 * what it says and a shelf that is on would take it: «Trade JUP every day» is offered once the Agents shelf
 * is on, «Launch me a token» once Launch is — until then the block offers the sentences this screen's own shelf does.
 * A sentence the line would read as something else is never offered under its own words.
 *
 * Pure: the screen gives it the line's reading; the tests hold the rule.
 */

export const SENTENCES = ['scout', 'tradeDaily', 'dips', 'launch', 'earn', 'buy', 'limit', 'chart'] as const;
export type SentenceId = (typeof SENTENCES)[number];

/** What the agent's line must read each sentence as, for the sentence to say what it does. */
export const READ_AS: Readonly<Record<SentenceId, readonly Kind[]>> = {
  // «Find new coins for me»: the agent's analyst answers it until the scout does.
  scout: ['ask'],
  tradeDaily: ['autopilot'],
  dips: ['instruct'],
  launch: ['launch', 'autopilot'],
  earn: ['earn'],
  buy: ['buy'],
  limit: ['order'],
  chart: ['chart'],
};

/** The block shows this many, as the approved design does. */
export const SENTENCES_SHOWN = 3;

export type Sentence = Readonly<{ id: SentenceId; text: string }>;

/**
 * The sentences to offer, in the block's order. `read` is the agent's line: what the terminal would do with the
 * sentence now — the kind of its first row — or null when no shelf that is on takes it.
 */
export function readySentences(candidates: readonly Sentence[], read: (text: string) => Kind | null, shown: number = SENTENCES_SHOWN): Sentence[] {
  const ready: Sentence[] = [];
  for (const id of SENTENCES) {
    const sentence = candidates.find((candidate) => candidate.id === id);
    if (!sentence) continue;
    const kind = read(sentence.text);
    if (kind !== null && READ_AS[id].includes(kind)) ready.push(sentence);
    if (ready.length === shown) break;
  }
  return ready;
}

/** A limit a little under the market, as a sentence says it: the price cut to a figure a person would type. */
export function dipPrice(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const under = price * 0.95;
  const places = under >= 100 ? 0 : under >= 1 ? 2 : Math.min(10, Math.max(4, -Math.floor(Math.log10(under)) + 2));
  const text = under.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return Number(text) > 0 ? text : null;
}

/**
 * The first screen's sentences: the agent finding new coins, the agent trading every day
 * on the person's own budget, a token launched. The side panel beside the list keeps the coin's own sentences, never these again.
 */
export const HERO: readonly SentenceId[] = ['scout', 'tradeDaily', 'launch'];

/**
 * The coin «Trade … every day» names: JUP, else MET, when the agent
 * offers it; none of them offered — no such sentence.
 */
export const HERO_COINS = ['JUP', 'MET'] as const;

export function heroCoin<T extends Readonly<{ symbol: string }>>(offered: readonly T[]): T | null {
  for (const symbol of HERO_COINS) {
    const coin = offered.find((one) => one.symbol.replace(/^\$+/, '').toUpperCase() === symbol);
    if (coin) return coin;
  }
  return null;
}
