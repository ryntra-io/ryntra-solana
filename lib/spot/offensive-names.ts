/**
 * Hate words in a token's name or ticker (B2b, critic 19.10). Anyone can mint a
 * token on Solana with any name, and the feeds Ryntra reads — Pulse's new
 * tokens above all, open on Home since B2b — carry them as they are. A row
 * whose name or ticker carries a slur or a hate symbol is left out of what
 * Ryntra shows, never masked: the token stays reachable by its address, it is
 * just not offered. A guard on what Ryntra shows, not a judge of the chain.
 *
 * Disguises are read through by reducing a word to its skeleton: letters of
 * other alphabets and small capitals to Latin, then every look-alike to one
 * class — «i l 1 ! | y» are one, «g q 6 9» are one, «o 0», «e 3», «a 4 @»,
 * «s 5 $», «t 7», «b 8». A stem is matched in the same skeleton, each of its
 * letters allowed to repeat, so «Niqqa», «Hltler», «N166ER», «NlGGER» and
 * «niiigga» are what they look like, while «Niger» stays a country. Short
 * stems use a milder skeleton without «q», «y», «6» and «9», so «FAQ» and
 * «600K» stay words. Words are split on spaces and on dashes, dots and underscores
 * between pieces of two letters or more («Neo-Nazi»), and camel case is split
 * («NaziPepe», «SSNazi»); single letters spaced apart are read as one word.
 * Never glued across a space, so «Tran Nyan» is two words.
 *
 * A long stem counts anywhere inside a word; a short one as a word of its own,
 * with a meme word glued on («…Coin», «Baby…»), and «nazi» at a word's start
 * or end too («NAZIFROG», «WOLFNAZI») but not in names that begin so
 * («Nazir», «Nazionale») or in «Ashkenazi».
 * Ordinary words that hold a stem stay: «snigger», «niggardly», «retardant»,
 * «Ashkenazi», «Whittier», «Strannik», «Beanery»; a number is not a word
 * («Born1994»); «kkkk» and «BonKKK» are laughter.
 *
 * Pure: the strings in, a yes or no out.
 */

/* Look-alike classes: every member reads as the first. */
const CLASSES: readonly (readonly [string, string])[] = [
  ["i", "il1!|y"],
  ["g", "gq69"],
  ["o", "o0"],
  ["e", "e3"],
  ["a", "a4@"],
  ["s", "s5$"],
  ["t", "t7"],
  ["b", "b8"],
];
const CLASS_OF: ReadonlyMap<string, string> = new Map(CLASSES.flatMap(([head, members]) => [...members].map((char) => [char, head] as const)));

/* Letters of other alphabets that look Latin, and small capitals. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ї: "i", ј: "j", ı: "i",
  α: "a", β: "b", ε: "e", ζ: "z", η: "h", ι: "i", κ: "k", μ: "m", ν: "n", ο: "o", ρ: "p", τ: "t", υ: "y", χ: "x",
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p",
  ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
};

/** Plain lower-case Latin letters and digits, signs kept: the first step of every reading. */
function latin(text: string): string {
  return [...text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()].map((char) => LOOKALIKE[char] ?? char).join("");
}

/* What the mild skeleton leaves as it is: «q», «y» and the digits that read as «g» — «FAQ», «600K» stay words. */
const MILD_KEEP: ReadonlySet<string> = new Set(["q", "y", "6", "9"]);

/** A word's skeleton: each look-alike to its class, anything else dropped. `mild` leaves `MILD_KEEP` as it is. */
function skeleton(text: string, mild = false): string {
  return [...latin(text)]
    .map((char) => (mild && MILD_KEEP.has(char) ? (/[a-z]/.test(char) ? char : "") : (CLASS_OF.get(char) ?? (/[a-z]/.test(char) ? char : ""))))
    .join("");
}

/*
 * Every letter of a stem may repeat («niiigga», «Hittler», «Wettback»), and a letter the stem doubles needs two at
 * least («Niger» stays a country); the ordinary words this would catch are excused by name («Whittier»).
 */
function pattern(stem: string): string {
  const chars = [...stem];
  return chars
    .map((char, index) => {
      if (chars[index + 1] === char) return "";
      return chars[index - 1] === char ? `${char}${char}+` : `${char}+`;
    })
    .join("");
}

/* A star for a letter («N*GGER», «F*GGOT», «H*TLER») — the commonest way the word is written in public. */
function starPattern(stem: string): string {
  const chars = [...stem];
  return chars.map((char, index) => (chars[index + 1] === char ? "" : chars[index - 1] === char ? `(?:${char}|[*]){2,}` : `(?:${char}+|[*])`)).join("");
}

const ANYWHERE = ["nigger", "nigga", "faggot", "wetback", "retard", "hitler", "neonazi", "jigaboo", "rahowa"].map((stem) => pattern(skeleton(stem)));
/* Read in the mild skeleton: «y» stays «y», so «Strannik» is not this word. */
const ANYWHERE_MILD = ["tranny"].map((stem) => pattern(skeleton(stem, true)));
/* Short stems, and ones that sit inside ordinary words («Beanery», «Draghead»): a word of their own, or with a meme word. */
const WHOLE = ["kike", "chink", "spic", "fag", "nazi", "gook", "paki", "kkk", "beaner", "raghead"].map((stem) => (stem === "kkk" ? "kkk" : pattern(skeleton(stem, true))));
/* Ordinary words, and one market, that hold a stem. */
const ORDINARY = ["snigger", "sniggering", "sniggered", "niggard", "niggardly", "niggardliness", "retardant", "retardation", "retardio", "whittier", "shittier", "shittiest"];
/* Names that begin with «nazi» and are not it — whole names only: «Nazir» stays, «NAZIRAT» does not. */
const NAZI_NAMES: ReadonlySet<string> = new Set(["nazir", "nazira", "nazim", "nazif", "nazia", "naziya", "nazionale", "nazione", "nazioni", "nazli", "nazila", "nazilli"]);
/* Meme words glued to a name; a short stem with one of them is still the stem. */
const AFFIXES = ["coin", "token", "inu", "pepe", "baby", "doge", "dog", "cat", "ai", "sol", "moon", "king", "lord", "mr", "the", "gpt", "wif", "pump", "fun", "frog", "club", "army", "boy", "girl", "man", "gang", "face", "squad", "x"].map((word) => skeleton(word, true));
const AFFIX_RE = new RegExp(`^(?:${AFFIXES.join("|")})+|(?:${AFFIXES.join("|")})+$`, "g");
const ANYWHERE_RE = new RegExp(ANYWHERE.join("|"), "g");
const STAR_RE = new RegExp(["nigger", "nigga", "faggot", "wetback", "retard", "hitler", "jigaboo"].map((stem) => starPattern(skeleton(stem))).join("|"), "g");
const ANYWHERE_MILD_RE = new RegExp(ANYWHERE_MILD.join("|"));
const WHOLE_RE = new RegExp(`^(?:${WHOLE.join("|")})s?$`);
/* An ordinary word is excused only when it is the whole word in real letters — «$NIGGER» reads as «snigger» but is not it. */
const ORDINARY_RE = new RegExp(`^(?:${ORDINARY.join("|")})s?$`);

/* Numbers, phrases and signs that are hate symbols by themselves — read on the plain text, words apart. */
const CODES = /(?:^|[^\d.,])(?:1488|14\s*[/|\\-]?\s*88|1[\s.-]+4[\s.-]+8[\s.-]+8)(?![\d.,]\d)|(?:^|[^a-z\d])h[\s.-]*h[\s.-]*8[\s.-]*8(?!\d)/;
const SIGNS = /[卐卍]/;
/* Read on the letters alone, so a meme word glued on («SiegHeilCoin», «BabySiegHeil») is still the phrase. */
const PHRASES = /siegheil|whitepower|kukluxklan|thirdreich|fourthreich|meinkampf|gas(?:the|all)?jews?(?!el)|kill(?:all)?(?:the)?jews?(?!el)/;
/* The slogans once more on the skeleton: «S1EG HE1L», «White P0wer». */
const PHRASES_SKELETON = new RegExp(["siegheil", "whitepower", "kukluxklan", "thirdreich", "fourthreich", "meinkampf"].map((phrase) => skeleton(phrase)).join("|"));

/**
 * The words of a name: split on spaces, and on a dash, a dot or an underscore between pieces of two letters or more
 * («Neo-Nazi», «Nazi_Frog»); a run of single letters spaced or dotted apart is read as one word («n i g …», «N.I.G…»).
 */
function chunks(text: string): string[] {
  const parts = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((part) => {
      const pieces = part.split(/[-_.]+/).filter(Boolean);
      return pieces.length > 1 && pieces.every((piece) => [...piece].length >= 2) ? [part, ...pieces] : [part];
    });
  const out: string[] = [];
  let run = "";
  for (const part of parts) {
    if ([...part.replace(/^[$#@]+/, "")].length === 1) {
      run += part;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(part);
  }
  if (run) out.push(run);
  return out;
}

/**
 * A long stem in a word's skeleton, read from letters: a span with fewer than two different real letters is a number
 * («Born1994» — «n1994»), while «N166ER» and «F4660T» are what they look like.
 */
function stemIn(chunk: string): boolean {
  const chars = [...latin(chunk)].filter((char) => CLASS_OF.has(char) || /[a-z]/.test(char));
  const word = chars.map((char) => CLASS_OF.get(char) ?? char).join("");
  for (const match of word.matchAll(ANYWHERE_RE)) {
    const letters = chars.slice(match.index, match.index + match[0].length).filter((char) => /[a-z]/.test(char));
    if (new Set(letters).size >= 2) return true;
  }
  /* One or two stars for letters, three real letters at least, the word beginning with a letter: «N*GGA», not «M*A*S*H». */
  const starred = [...latin(chunk)].filter((char) => char === "*" || CLASS_OF.has(char) || /[a-z]/.test(char));
  const starWord = starred.map((char) => CLASS_OF.get(char) ?? char).join("");
  for (const match of starWord.matchAll(STAR_RE)) {
    const span = starred.slice(match.index, match.index + match[0].length);
    const stars = span.filter((char) => char === "*").length;
    if (stars >= 1 && stars <= 2 && span.filter((char) => /[a-z]/.test(char)).length >= 3 && /^[a-z0-9!|@$]/.test(span[0] ?? "")) return true;
  }
  return false;
}

function offensiveWord(raw: string): boolean {
  /* A ticker's sign is not a letter: «$NIGGER», «#KIKE», «@FAG». */
  const chunk = raw.replace(/^[$#@]+/, "");
  if (!chunk) return false;
  const real = latin(chunk).replace(/[^a-z]/g, "");
  if (!ORDINARY_RE.test(real) && (stemIn(chunk) || ANYWHERE_MILD_RE.test(skeleton(chunk, true)))) return true;
  /* Camel case parts: «NaziPepe», «BabyNazi», «SSNazi». */
  const parts = [chunk, ...chunk.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)];
  for (const part of parts) {
    const plain = latin(part).replace(/[^a-z]/g, "");
    const bare = skeleton(part, true);
    /* «nazi» at a word's start, read through look-alikes («N4ZIWOLF»), unless the word is a name that begins so. */
    if (/^nazi/.test(bare) && !NAZI_NAMES.has(bare.replace(AFFIX_RE, "")) && !NAZI_NAMES.has(plain)) return true;
    /* And past its start («SSNAZI», «SSNAZIWOLF», «THENAZIPARTY»), but not «Ashkenazi», «Internazionale», «Benazir»,
       «Monazite», «Anazi». */
    const core = bare.replace(AFFIX_RE, "");
    /* The names are excused only where a name ends — «Abdulnazir», not «SSNAZIREICH». */
    if (/.nazi/.test(bare.replace(/ashkenazi|nazio(?:n|s?$)|nazi[rm]s?$|benazir|ignazi[ao]|monazit|gymnazi/g, "")) && !/^[ae]nazis?$/.test(core)) return true;
    if ((part !== chunk && /^k+$/.test(bare)) || NAZI_NAMES.has(plain)) continue;
    if (bare && (WHOLE_RE.test(bare) || WHOLE_RE.test(bare.replace(AFFIX_RE, "")))) return true;
  }
  return false;
}

/** True when any of the strings — a name, a ticker — carries a hate word or symbol. */
export function isOffensiveName(...texts: readonly (string | null | undefined)[]): boolean {
  for (const text of texts) {
    if (!text) continue;
    const plain = latin(text);
    if (CODES.test(plain) || SIGNS.test(text) || PHRASES.test(plain.replace(/[^a-z]/g, "")) || PHRASES_SKELETON.test(skeleton(text))) return true;
    for (const chunk of chunks(text)) if (offensiveWord(chunk)) return true;
  }
  return false;
}

/** The rows whose name and ticker carry no hate word. */
export function withoutOffensiveNames<Row extends Readonly<{ name?: string | null; symbol?: string | null }>>(rows: readonly Row[]): Row[] {
  return rows.filter((row) => !isOffensiveName(row.name, row.symbol));
}
