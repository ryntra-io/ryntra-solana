import { useWords } from '../../city/lib/i18n/dict.ts';
import { useAsk } from './ask.ts';
import { SHELL } from './words.ts';

/**
 * The agent's line's one quiet word — «reading…» while the model sorts a sentence, or its «Уточни: …» — for
 * every field a sentence is said in (the header's line, the Market's own). Null when there is nothing to say.
 */
export function useAskNote(): string | null {
  const w = useWords(SHELL);
  const reading = useAsk((st) => st.reading);
  const clarify = useAsk((st) => st.clarify);
  if (reading) return w.reading;
  if (!clarify) return null;
  if (clarify.need === 'coin' && clarify.word) return w.clarifyCoin(clarify.word);
  return clarify.need === 'action' ? w.clarifyAction : w.clarifyOther;
}

/** The person types again: the question back is answered, it goes. */
export function clearClarify(): void {
  if (useAsk.getState().clarify) useAsk.setState({ clarify: null });
}
