/**
 * The deployment's switch for the agent's one-sentence instructions (CITY-176), read once from the build's environment:
 * `NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE=open` lets the command line and «Ask Ryntra» read a sentence into a regular
 * purchase, a limit or a stop, with its card and «My instructions». Anything else keeps them shut: the line reads every
 * sentence as before. It moves money through the engines' existing paths, so it opens only with a release decision.
 */
export function oneSentenceOpen(value: string | undefined): boolean {
  return value === 'open';
}

export const ONE_SENTENCE_OPEN = oneSentenceOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE);
