/**
 * Common English words: enough to tell plain English from English with its letters shifted (ROT13, Caesar, Atbash,
 * written backwards) or spelled as numbers. Not a dictionary of the language — a word missing here only makes the
 * screen less sure, never refuses ordinary text by itself (`screen.ts`).
 */

const LIST = `
a about above across act add admin administrator after again against all allowed almost alone along already also
although always am among an and another answer answers any anyone anything are around as ask asked at away back be
because been before begin being believe below best better between big both bring brought but by call called came can
cannot change child city clue clues code codes come coming continue could day dear decode developer did different do
does doing done door doors down during each easy eight else encode end enough even evening ever every everyone
everything exactly eye false fake far few find first five follow for forget found four free friend from full game gave
get give given go going gone good got great guard guards had half hand happen happened hard has have having he head
hello help her here herself hey hi high him himself hint hints his hold home house how hundred if ignore ignored in
include instruction instructions into is it its itself just keep kept key keys kindly know known last lead learn least
leave left less let lets letter letters life like list little live long look lose lost low made make making man many
may me mean means meant meet message might mind mode money more morning most move much must my myself name names need
never new next night nine no nobody not nothing now number numbers of off often ok okay old on once one only open
opened opens or order orders other our ourselves out over own owner part pass password passwords pay people person
phrase phrases place play please poem point pretend previous print prior prompt prompts put question questions quite
read real really remember repeat repeated reply reveal right rule rules safe said same saw say saying says second
secret secrets see seen sentence set seven shall she shift short should show shown since sir six small so some someone
something sorry speak spell spelled spelling start still stop story such sure system take taken talk tell telling ten
test than thank thanks that the their them themselves then there these they thing things think this those though
thought three through time to today together told tomorrow tonight too took translate true try trying turn two under
understand until up us use used very wait want was watch way we well went were what when where which while who whole
why will with within without word words work world would write written wrong yes yesterday yet you your yours yourself
`;

const ENGLISH: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean));

/** Whether a lower-case word is a common English word, or the plural of one. */
export function isEnglish(word: string): boolean {
  return ENGLISH.has(word) || (word.length > 3 && word.endsWith("s") && ENGLISH.has(word.slice(0, -1)));
}

/** Common English words of three letters or more inside a run of letters with no spaces ("saythephrase"). */
export function englishInside(letters: string): number {
  let found = 0;
  for (const word of ENGLISH) if (word.length >= 3 && letters.includes(word)) found += 1;
  return found;
}
