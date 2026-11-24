import { isOffensiveName } from '../../lib/spot/offensive-names.ts';

/**
 * The Launch screen's showcase of new coins
 * shows no crude names. The market's own lists are not changed by this: a hate word is left out everywhere by
 * `lib/spot/offensive-names.ts`; a crude word — the toilet, sex, swearing — is left out here only, where the screen
 * shows what a launch looks like next to the others. A coin stays reachable by its address; it is just not offered.
 *
 * Disguises are read through as the market's guard does the simple ones: other alphabets' look-alikes and the digits
 * that stand for letters («SH1T», «FΛRT»), words split on spaces, signs and camel case («ShitCoin», «fart_inu»), and
 * the whole name glued together («F A R T»).
 *
 * Pure: a name in, a yes or no out.
 */

/* A word that is crude wherever it stands inside a word: none of them hides in an ordinary one. */
const ANYWHERE = ['fuck', 'shit', 'shidd', 'paypig', 'findom', 'looksmax', 'orgasm', 'masturb', 'hentai', 'nipple', 'testic', 'scrot', 'schlong', 'ballsack', 'nutsack', 'onlyfans', 'pedophil', 'paedo', 'cumshot', 'cumrocket', 'cummies', 'peepee', 'poopy', 'pooping', 'deeznuts', 'cunt', 'porn', 'pussy', 'dildo', 'jizz', 'whore', 'slut', 'bitch', 'boob', 'titty', 'titties', 'vagina', 'retard', 'nsfw', 'xxx', 'groyper', 'хуй', 'хуе', 'хуя', 'пизд', 'пізд', 'бляд', 'блят', 'їба', 'ебан', 'ебат', 'ебл', 'йоб', 'сран', 'срак', 'гівн', 'говн', 'жоп', 'мудак', 'дроч', 'перд', 'сука', 'шлюх'];
/* A word that is crude only as the whole word, or with a meme word glued on: «ass» is in «class», «cum» in «cucumber»,
   «rape» in «grape», «pedo» in «torpedo», «semen» in «basement». */
const WHOLE = ['fart', 'farts', 'farting', 'farted', 'ass', 'asses', 'asshole', 'assholes', 'arse', 'butt', 'butthole', 'poop', 'poo', 'poopoo', 'pee', 'piss', 'turd', 'crap', 'cum', 'cock', 'dick', 'dicks', 'tits', 'tit', 'sex', 'sexy', 'anal', 'nude', 'nudes', 'milf', 'twat', 'bollocks', 'scat', 'toilet', 'diarrhea', 'diarrhoea', 'vomit', 'puke', 'penis', 'semen', 'horny', 'rape', 'pedo', 'wank', 'wanker', 'goy', 'goyim', 'dih', 'coom', 'coomer', 'freak', 'freaky', 'goon', 'gooner', 'gooning', 'buckme', 'shart', 'vag', 'vagoo', 'boner', 'erection', 'butthurt', 'deez', 'doobie', 'shid', 'mog', 'mogging', 'дупа', 'срака', 'пісюн', 'член'];
const AFFIXES = ['coin', 'token', 'inu', 'baby', 'big', 'super', 'mega', 'mr', 'the', 'my', 'sol', 'pump', 'fun', 'ai', 'dog', 'cat', 'frog', 'pepe', 'doge', 'king', 'lord', 'boy', 'girl', 'man', 'lady', 'x', 'og', 'wif', 'hat', 'moon', 'city'];

/* Look-alikes: other alphabets' letters that read as Latin, and the digits and signs that stand for letters. */
const LOOK: Readonly<Record<string, string>> = {
  α: 'a', λ: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', μ: 'm', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', σ: 's',
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'i',
};
/* Latin look-alikes of Cyrillic letters, for a name written in Cyrillic: the Cyrillic stems are read in Cyrillic. */
const CYR: Readonly<Record<string, string>> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', i: 'і', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в' };

/** A name's letters, lower case, accents dropped, look-alikes read as letters; anything else a space. */
function letters(text: string): string {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return [...plain].map((char) => LOOK[char] ?? (/[\p{L}]/u.test(char) ? char : ' ')).join('');
}

/** The words of a name: split on what is not a letter and on camel case («ShitCoin» → «shit», «coin»). */
function words(text: string): string[] {
  // A ticker's own «$» is not a letter: «$FART» is «FART», while «$HIT» inside a word still reads as «SHIT».
  const camel = text.trim().replace(/^\$+/, '').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  return letters(camel).split(/\s+/).filter(Boolean);
}

const AFFIX_RE = new RegExp(`^(?:${AFFIXES.join('|')})+|(?:${AFFIXES.join('|')})+$`, 'g');
/* The stems read the way a name is read: «й» and «ї» lose their marks as a name's letters do. */
const ANYWHERE_READ: readonly string[] = ANYWHERE.map((stem) => letters(stem));
const WHOLE_SET: ReadonlySet<string> = new Set(WHOLE.map((word) => letters(word)));

/** A word with a meme word glued on is the word inside («BabyFart», «poopcoin»); the word itself is never emptied. */
function bare(word: string): string {
  const cut = word.replace(AFFIX_RE, '');
  return cut.length >= 2 ? cut : word;
}

/* «-tard» as a word's end is a slur («ROCKTARD»); the cooking words that end so stay. */
const TARD_OK: ReadonlySet<string> = new Set(['mustard', 'custard', 'bustard']);

function crudeWord(word: string): boolean {
  if (ANYWHERE_READ.some((stem) => word.includes(stem))) return true;
  if (word.length > 4 && word.endsWith('tard') && !TARD_OK.has(word)) return true;
  return WHOLE_SET.has(word) || WHOLE_SET.has(bare(word));
}

/** Whether a coin's name or ticker is crude or hateful: such a coin is not shown in the Launch screen's lists. */
/* Signs a showcase does not show in a coin's name: a warning, a turd, and the invisible marks that turn text around
   (U+202E before \u00ABkrowteNaroneZ\u00BB shows it backwards: a disguise, never a coin's own). */
const SIGNS = /[\u26A0\u{1F4A9}\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

export function rudeName(...names: readonly (string | null | undefined)[]): boolean {
  for (const name of names) {
    if (!name) continue;
    if (isOffensiveName(name) || SIGNS.test(name)) return true;
    const split = words(name);
    // Letters spaced or dotted apart are one word: «F A R T», «s.h.i.t» — never two words glued («Push It»).
    const read = split.length > 1 && split.every((word) => [...word].length === 1) ? [split.join('')] : split;
    // A Cyrillic word typed in Latin look-alikes («CYKA») is read in Cyrillic too.
    const cyrillic = read.map((word) => [...word].map((char) => CYR[char] ?? char).join(''));
    if ([...read, ...cyrillic].some(crudeWord)) return true;
  }
  return false;
}
