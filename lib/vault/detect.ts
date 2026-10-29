import { WORDS } from "./phrase";

/**
 * The phrase detector: which words of the phrase a guard's reply gives away, and a public copy of a text without them.
 * It looks for each word as a word, spelled out letter by letter ("s-t-o-n-e", "S T O N E"), written backwards,
 * and glued to the next one, in any case. The vault never reads a verdict from a reply: a guard that "opens the door"
 * in words opens nothing, and only the phrase typed by a person cracks a vault.
 *
 * Nothing public may tell the phrase's words from the other words of the dictionary. So a public copy masks every word
 * of the dictionary (`WORDS`), not only the phrase's — otherwise a visitor who sends the whole list and reads which
 * words came back masked would read the phrase — and the pressure counts only words the visitor did not bring: a guard
 * that repeats what it was told gives nothing away.
 */

/** What stands where a word was. Always the same length, so the copy tells nothing about the word. */
export const MASK = "•••••";

type Span = { from: number; to: number; word: number };

const reverse = (word: string) => [...word].reverse().join("");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A word and its plural, possessive and reversed forms as whole words, compiled once per word. */
const FORMS = new Map<string, RegExp[]>();
function formsOf(word: string): RegExp[] {
  let forms = FORMS.get(word);
  if (!forms) {
    forms = [...new Set([word, reverse(word)])].map((form) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?:'?s)?(?![\\p{L}\\p{N}])`, "giu"));
    FORMS.set(word, forms);
  }
  return forms;
}

/**
 * Every place in a text where a word of the list shows, by the word's index. The text is already folded (NFKC);
 * matching ignores case without changing the text, so the places are places in the text itself.
 */
function spans(text: string, words: readonly string[]): Span[] {
  const found: Span[] = [];
  const has = (run: string, word: string) => run.includes(word) || run.includes(reverse(word));
  words.forEach((word, i) => {
    for (const re of formsOf(word)) {
      for (const m of text.matchAll(re)) found.push({ from: m.index, to: m.index + m[0].length, word: i });
    }
  });
  // Letters spelled out one by one, with anything but letters between them.
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])\p{L}(?:[^\p{L}\p{N}\n]{1,3}\p{L}(?![\p{L}\p{N}])){2,}/gu)) {
    const letters = m[0].replace(/[^\p{L}]/gu, "").toLowerCase();
    words.forEach((word, i) => {
      if (has(letters, word)) found.push({ from: m.index, to: m.index + m[0].length, word: i });
    });
  }
  // Words glued together: two words of the list in one run of letters, or one with barely anything around it.
  for (const m of text.matchAll(/\p{L}{10,}/gu)) {
    const run = m[0].toLowerCase();
    const hits = words.map((word, i) => (has(run, word) ? i : -1)).filter((i) => i >= 0);
    if (hits.length >= 2 || (hits.length === 1 && run.length <= words[hits[0]!]!.length + 3)) {
      for (const i of hits) found.push({ from: m.index, to: m.index + m[0].length, word: i });
    }
  }
  return found;
}

export type Exposure = {
  /** For each word of the phrase: whether the reply gives it away. */
  exposed: boolean[];
  /** The share of the phrase given away, 0 to 1: the "pressure" the city shows. */
  pressure: number;
};

/**
 * Which words of the phrase a reply gives away. Words the visitor brought themselves (`brought`, from `named`) are
 * never counted: echoing them back tells nothing, and counting them would tell the visitor which of their words are in
 * the phrase. The share is always out of the whole phrase, so the number never depends on what was brought.
 */
export function exposure(text: string, words: readonly string[], brought: readonly boolean[] = []): Exposure {
  const exposed = words.map(() => false);
  for (const span of spans(text.normalize("NFKC"), words)) if (!brought[span.word]) exposed[span.word] = true;
  const count = exposed.filter(Boolean).length;
  return { exposed, pressure: words.length ? count / words.length : 0 };
}

/**
 * Which words of the phrase a visitor's own text names: in any form the detector reads, or with its letters anywhere
 * in the text's run of letters ("am ber", "a.m.b.e.r", "chamber"). Only ever used to leave words out of the pressure,
 * so naming too many costs the visitor nothing and the vault nothing.
 */
export function named(text: string, words: readonly string[]): boolean[] {
  const folded = text.normalize("NFKC");
  const marked = words.map(() => false);
  for (const span of spans(folded, words)) marked[span.word] = true;
  const letters = folded.toLowerCase().replace(/[^\p{L}]/gu, "");
  return marked.map((seen, i) => seen || letters.includes(words[i]!) || letters.includes(reverse(words[i]!)));
}

/**
 * A text as anyone may read it: every place any word of the dictionary shows is masked, the same way for every word,
 * so the copy is the same whatever today's phrase is.
 */
export function publicCopy(text: string): string {
  const folded = text.normalize("NFKC");
  const found = spans(folded, WORDS).sort((a, b) => a.from - b.from || b.to - a.to);
  if (!found.length) return folded;
  let out = "";
  let at = 0;
  for (const span of found) {
    if (span.to <= at) continue;
    out += folded.slice(at, Math.max(at, span.from)) + (span.from >= at ? MASK : "");
    at = span.to;
  }
  return out + folded.slice(at);
}
