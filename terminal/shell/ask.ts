import { create } from 'zustand';
import type { Coin, Command } from '../../city/lib/command/parse.ts';
import type { ShelfId } from './shelves.ts';

/**
 * A sentence handed from the agent's line to the screen it opens. The line reads the sentence with the city's own
 * reader, moves to the address of the screen that does it, and leaves the reading here for that address; the screen
 * standing there takes it once and fills its own fields — for instance by running the city's runner
 * (`city/lib/command/run.ts`) on doors of its own. Keyed by the address, not the shelf: the Market's list and a coin's
 * screen are one shelf, and only the screen the person lands on takes the sentence. Nothing here signs or sends: the
 * person reads the filled screen and confirms there.
 *
 * `subject` is the coin the screen in front is about: a coin's own screen names it, so «buy 50» means that coin, as it
 * does over a coin's window in the city.
 */
export type Ask = Readonly<{ id: number; shelf: ShelfId; href: string; command: Command; said: string }>;

/**
 * The model's question back — «Уточни: …» — with the sentence it was about, kept in the line for the person to
 * say again; `need` is which (`lib/sentence/plan.ts`), `word` the coin as written when it is the coin.
 */
export type Clarify = Readonly<{ said: string; need: 'action' | 'coin' | 'other'; word?: string }>;

type AskState = {
  ask: Ask | null;
  subject: Coin | null;
  /** The sentence the model is reading now, or null; `reading` is its turn, so a newer sentence wins. */
  reading: Readonly<{ id: number; said: string }> | null;
  clarify: Clarify | null;
  /** A sentence's start a screen put into the line for the person to finish there; the line takes it once. */
  begun: Readonly<{ said: string }> | null;
};

export const useAsk = create<AskState>(() => ({ ask: null, subject: null, reading: null, clarify: null, begun: null }));

/** Puts a sentence's start into the agent's line, the keyboard with it: «Launch me a token …» — the person finishes it. */
export function beginSentence(said: string): void {
  useAsk.setState({ begun: { said } });
}

let next = 1;

/** An address as the router shows it: no query, no fragment, no trailing slash. */
export function addressOf(href: string): string {
  const path = href.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/';
}

/** Leaves a reading for the screen at `href`; a newer one replaces any that was not taken. */
export function handOff(shelf: ShelfId, href: string, command: Command, said: string): Ask {
  const ask: Ask = { id: next++, shelf, href: addressOf(href), command, said };
  useAsk.setState({ ask });
  return ask;
}

/** Takes the reading waiting for this address, once; null when there is none for it. */
export function takeAsk(href: string): Ask | null {
  const ask = useAsk.getState().ask;
  if (!ask || ask.href !== addressOf(href)) return null;
  useAsk.setState({ ask: null });
  return ask;
}

/** The coin the screen in front is about, or null when it is about none; a screen clears it as it closes. */
export function setAskSubject(subject: Coin | null): void {
  if (useAsk.getState().subject?.mint !== subject?.mint) useAsk.setState({ subject });
}
