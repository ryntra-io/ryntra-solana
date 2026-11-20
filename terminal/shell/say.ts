import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { bookOf, type Gates } from '../../city/lib/command/parse.ts';
import { useLang } from '../../city/lib/i18n/lang.ts';
import { askSentence } from '../../lib/sentence/client.ts';
import { lookalikeOf } from '../../lib/world/text-safety/lookalike.ts';
import { searchCatalog } from '../../city/lib/search/sources.ts';
import { readShelf, shelfNow, useDepth } from '../market/depth.ts';
import { EVERY_GATE, askHref, askRows, foundCoin, modelWanted, planAnswer, stayOn, withShelf, type AskRow } from './ask-route.ts';
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
  const { view, shelf } = useWhere();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  // The engine's shelf of verified stocks joins the market's coins: a share out of the top is still a coin to the line.
  const reads = useDepth((st) => st.reads);
  useEffect(() => void readShelf(), []);
  const book = useMemo(() => withShelf(bookOf(towers), shelfNow(reads)), [towers, reads]);
  const gates = useMemo(() => gatesOf(view), [view]);
  return useMemo(() => {
    const on = view === 'preview' ? everyShelf : onShelf;
    return stayOn(askRows(text, book, { subject }, on, gates), shelf, on);
  }, [text, book, subject, view, shelf, gates]);
}

let turn = 0;

/** How long the line waits for the shelf before the model is asked, and for a token search, ms. */
const SHELF_MS = 1_500;
const FIND_MS = 3_000;

/** The token search's one verified coin of this ticker (`foundCoin`), or null — a failed search is none. */
async function findCoin(word: string) {
  try {
    const rows = await searchCatalog(word, { signal: AbortSignal.timeout(FIND_MS) });
    return foundCoin(word, rows.map((row) => ({ ...row, ownTicker: row.symbol ? lookalikeOf(row.symbol, row.mint) === null : false })));
  } catch {
    return null;
  }
}

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
  const { view, shelf } = useWhere();
  const lang = useLang();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  return useCallback(
    (sentence: string, row?: AskRow) => {
      const said = sentence.trim();
      const on = view === 'preview' ? everyShelf : onShelf;
      const gates = gatesOf(view);
      const book = withShelf(bookOf(towers), shelfNow());
      const first = stayOn(askRows(sentence, book, { subject }, on, gates), shelf, on)[0] ?? null;
      const chosen = row ?? first;
      const go = (target: AskRow) => {
        const href = askHref(target.target, view);
        handOff(target.target.shelf, href, target.command, said);
        router.push(href);
      };
      const picked = row !== undefined && row.key !== first?.key;
      if (!picked && view !== 'preview' && modelWanted(said, first)) {
        const id = (turn += 1);
        const stale = () => useAsk.getState().reading?.id !== id;
        useAsk.setState({ reading: { id, said }, clarify: null });
        void (async () => {
          // The shelf first (release 20.11: «buy ANT for 1 SOL» — a share out of the market's top): read, it may be
          // all the line's own rules were missing, and then no model is asked.
          await Promise.race([readShelf(), new Promise((done) => setTimeout(done, SHELF_MS))]);
          if (stale()) return;
          let known = withShelf(bookOf(towers), shelfNow());
          const again = stayOn(askRows(said, known, { subject }, on, gates), shelf, on)[0] ?? null;
          if (again && !modelWanted(said, again)) {
            useAsk.setState({ reading: null });
            return go(again);
          }
          const draft = await askSentence(said, lang === 'uk' ? 'uk' : 'en');
          if (stale()) return;
          // The shelf may have come while the model read.
          known = withShelf(bookOf(towers), shelfNow());
          let answer = draft ? planAnswer(draft, said, known, on, gates) : null;
          // A coin the market and the shelf do not hold: the token search's one verified coin of that ticker, if any.
          if (answer?.kind === 'clarify' && answer.need === 'coin' && answer.word) {
            const found = await findCoin(answer.word);
            if (stale()) return;
            if (found) {
              known = { coins: [...known.coins, found] };
              // The line's own reading goes first, as for any coin it knows: «buy X for 1 SOL» is X's page, filled.
              const own = stayOn(askRows(said, known, { subject }, on, gates), shelf, on)[0] ?? null;
              if (own && !modelWanted(said, own)) {
                useAsk.setState({ reading: null });
                return go(own);
              }
              answer = planAnswer(draft, said, known, on, gates);
            }
          }
          useAsk.setState({ reading: null });
          if (answer?.kind === 'row') return go(stayOn([answer.row], shelf, on)[0] ?? answer.row);
          // Which coin is always asked back; anything else only where the line's own rules read nothing it can open.
          const ownRow = chosen && chosen.command.kind !== 'ask' ? chosen : null;
          if (answer?.kind === 'clarify' && (answer.need === 'coin' || !ownRow) && !(answer.need === 'other' && chosen)) {
            return useAsk.setState({ clarify: { said, need: answer.need, ...(answer.word ? { word: answer.word } : {}) } });
          }
          if (chosen) go(chosen);
        })();
        return true;
      }
      if (!chosen) return false;
      useAsk.setState({ clarify: null });
      go(chosen);
      return true;
    },
    [router, view, shelf, lang, towers, subject],
  );
}
