/**
 * Names the phone never lists: a token whose symbol or name carries a slur or a
 * hate term is left out of every catalogue list it draws — search, Markets and
 * the pickers. A client-side net while the catalogue itself does not filter
 * them; the list is short and factual, nothing more.
 *
 * Two kinds of entry. A stem is distinctive enough to be matched inside a word
 * («…stem…inu»); a word is matched only as a whole symbol or a whole word part
 * (split at spaces, signs and a lower-to-upper case turn), with its plural, so
 * an ordinary word that merely contains it («spicy», «raccoon») stays.
 */

/** Matched anywhere inside a symbol or a name, after the common digit-for-letter swaps are undone. */
export const BLOCKED_STEMS: readonly string[] = ['nigger', 'nigga', 'faggot', 'wetback', 'jigaboo', 'porchmonkey']

/** Matched only as a whole symbol or a whole word part, its plural too. */
export const BLOCKED_WORDS: readonly string[] = ['fag', 'kike', 'spic', 'chink', 'coon', 'gook', 'tranny', 'raghead', 'towelhead']

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', $: 's' }

/** Lower case with the common digit-for-letter swaps undone: «N1GG4» → «nigga». */
function plain(text: string): string {
  return text.toLowerCase().replace(/[01345@$]/g, (mark) => LEET[mark] ?? mark)
}

/** A text's word parts, lower case: spaces and signs split it, and so does a turn from a lower to an upper case letter. */
export function wordParts(text: string): string[] {
  return text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}@$]+/u)
    .filter((part) => part.length > 0)
    .map(plain)
}

/** Whether a text carries one of the given stems (anywhere) or words (a whole part, or its plural). */
export function carriesBlocked(text: string, stems: readonly string[], words: readonly string[]): boolean {
  if (text.length === 0) return false
  const squashed = plain(text).replace(/[^\p{L}\p{N}]+/gu, '')
  if (stems.some((stem) => squashed.includes(stem))) return true
  const parts = wordParts(text)
  return parts.some((part) => words.some((word) => part === word || part === `${word}s` || part === `${word}es`))
}

/** Whether the phone leaves this token out of its lists: its symbol or its name carries a blocked stem or word. */
export function isBlockedToken(token: Readonly<{ symbol?: string | null; name?: string | null }>): boolean {
  const symbol = (token.symbol ?? '').trim().replace(/^\$/, '')
  const name = token.name ?? ''
  return carriesBlocked(symbol, BLOCKED_STEMS, BLOCKED_WORDS) || carriesBlocked(name, BLOCKED_STEMS, BLOCKED_WORDS)
}
