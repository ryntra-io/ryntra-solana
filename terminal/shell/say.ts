import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { bookOf, type Gates } from '../../city/lib/command/parse.ts';
import { useLang } from '../../city/lib/i18n/lang.ts';
import { askSentence } from '../../lib/sentence/client.ts';
import { EVERY_GATE, askHref, askRows, modelWanted, planAnswer, type AskRow } from './ask-route.ts';
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

let turn = 0;

/**
 * Says a sentence to the agent: the first reading the terminal can open — or the row the person picked — goes to its
 * shelf with the sentence handed over. False when no shelf that is on can take it.
 *
 * Where the line's own rules did not understand the sentence (`modelWanted`), the model sorts it into a plan
 * (`lib/sentence/**`) and the plan's card opens filled; a plan the engine cannot take is «Уточни: …» in the line. The
 * model off, past its day, late or wrong — the line's own reading goes, as before. A row the person picked is theirs:
 * no model is asked for it.
 */
export function useSay(): (sentence: string, row?: AskRow) => boolean {
  const router = useRouter();
  const { view } = useWhere();
  const lang = useLang();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  return useCallback(
    (sentence: string, row?: AskRow) => {
      const said = sentence.trim();
      const on = view === 'preview' ? everyShelf : onShelf;
      const book = bookOf(towers);
      const first = askRows(sentence, book, { subject }, on, gatesOf(view))[0] ?? null;
      const chosen = row ?? first;
      const go = (target: AskRow) => {
        const href = askHref(target.target, view);
        handOff(target.target.shelf, href, target.command, said);
        router.push(href);
      };
      const picked = row !== undefined && row.key !== first?.key;
      if (!picked && view !== 'preview' && modelWanted(said, first)) {
        const id = (turn += 1);
        useAsk.setState({ reading: { id, said }, clarify: null });
        void askSentence(said, lang === 'uk' ? 'uk' : 'en').then((draft) => {
          if (useAsk.getState().reading?.id !== id) return;
          useAsk.setState({ reading: null });
          const answer = draft ? planAnswer(draft, said, book, on, gatesOf(view)) : null;
          if (answer?.kind === 'row') return go(answer.row);
          // Which coin is always asked back; anything else only where the line's own rules read nothing it can open.
          const ownRow = chosen && chosen.command.kind !== 'ask' ? chosen : null;
          if (answer?.kind === 'clarify' && (answer.need === 'coin' || !ownRow) && !(answer.need === 'other' && chosen)) {
            return useAsk.setState({ clarify: { said, need: answer.need, ...(answer.word ? { word: answer.word } : {}) } });
          }
          if (chosen) go(chosen);
        });
        return true;
      }
      if (!chosen) return false;
      useAsk.setState({ clarify: null });
      go(chosen);
      return true;
    },
    [router, view, lang, towers, subject],
  );
}
