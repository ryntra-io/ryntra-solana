import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { bookOf, type Gates } from '../../city/lib/command/parse.ts';
import { EVERY_GATE, askHref, askRows, type AskRow } from './ask-route.ts';
import { handOff, useAsk } from './ask.ts';
import { engineGates } from './engine.ts';
import { useWhere } from './frame.ts';
import { shelfOn, type ShelfId, type View } from './shelves.ts';
import { useMarket } from './useMarket.ts';

const everyShelf = () => true;
const onShelf = (id: ShelfId) => shelfOn(id);

function gatesOf(view: View): Gates {
  return view === 'preview' ? EVERY_GATE : engineGates();
}

/** The rows under the agent's line for what is typed: the city's reading, on the shelves this view shows. */
export function useAskRows(text: string): AskRow[] {
  const { view } = useWhere();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  const book = useMemo(() => bookOf(towers), [towers]);
  const gates = useMemo(() => gatesOf(view), [view]);
  return useMemo(() => askRows(text, book, { subject }, view === 'preview' ? everyShelf : onShelf, gates), [text, book, subject, view, gates]);
}

/**
 * Says a sentence to the agent: the first reading the terminal can open — or the row the person picked — goes to its
 * shelf with the sentence handed over. False when no shelf that is on can take it.
 */
export function useSay(): (sentence: string, row?: AskRow) => boolean {
  const router = useRouter();
  const { view } = useWhere();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  return useCallback(
    (sentence: string, row?: AskRow) => {
      const chosen = row ?? askRows(sentence, bookOf(towers), { subject }, view === 'preview' ? everyShelf : onShelf, gatesOf(view))[0];
      if (!chosen) return false;
      const href = askHref(chosen.target, view);
      handOff(chosen.target.shelf, href, chosen.command, sentence.trim());
      router.push(href);
      return true;
    },
    [router, view, towers, subject],
  );
}
