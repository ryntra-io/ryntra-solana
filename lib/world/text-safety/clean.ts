/**
 * Somebody else's text in the city — a coin's name and ticker, a launch's name, a quarter's sign, an island's name, a
 * crew's name, a resident's name — cut to what a reader sees, with the reason for every cut (CITY-73, decision 74).
 *
 * The rules, the same as for any text an agent catalogue shows a model: characters a reader
 * does not see but a model reads are deleted, direction overrides are deleted, markup and control characters become
 * spaces, a word of Latin letters with a Greek, Cyrillic, Armenian or Cherokee look-alike in it is a disguised word,
 * and words that read as orders to a model are held back.
 *
 * What happens to a finding depends on what the text is:
 *   - removed and said: invisible characters, direction marks in a name, control characters, markup, a cut length —
 *     the text stays, `reasons` lists what was taken out;
 *   - held back: a disguised word, an order to a model, a direction override in a ticker — `ok: false`, the caller
 *     shows the thing without its words (an anonymous tower, a blank sign), never the words.
 *
 * Pure: no network, no clock. Relative imports with their extension only — `node --test` and the city load it as is.
 */

export type TextKind = "symbol" | "name" | "sign" | "island" | "crew" | "resident" | "prose";

export type TextReason =
  /** Not a string at all. */
  | "not-text"
  /** Nothing a reader would see. */
  | "empty"
  /** Zero-width, joiner, filler, variation and tag characters: deleted. */
  | "invisible"
  /** Direction overrides, embeddings, isolates and marks: deleted (a ticker with one is held). */
  | "bidi"
  /** Control characters and line breaks: turned into spaces. */
  | "control"
  /** Markup and chat-template tokens: taken out. */
  | "markup"
  /** Longer than the place it stands in: cut. */
  | "cut"
  /** A word of Latin letters with a look-alike from another script in it. */
  | "mixed-script"
  /** A ticker that reads as a known coin's but is not it (look-alike letters or digits). */
  | "lookalike"
  /** A known coin's exact ticker on another mint. */
  | "impersonation"
  /** Words that read as orders to a model, or that ask for a key or a seed phrase. */
  | "instruction";

export type Cleaned =
  | Readonly<{ ok: true; text: string; reasons: readonly TextReason[] }>
  | Readonly<{ ok: false; reason: TextReason; reasons: readonly TextReason[] }>;

/** How long each kind may be on screen, in characters a reader counts. */
export const TEXT_LIMITS: Readonly<Record<TextKind, number>> = Object.freeze({
  symbol: 12,
  name: 40,
  sign: 48,
  island: 32,
  crew: 32,
  resident: 32,
  prose: 2000,
});

/**
 * Characters a reader does not see but a model reads: the soft hyphen, the grapheme joiner, zero-width spaces and
 * joiners, word joiners and invisible operators, Mongolian selectors, variation selectors, the byte-order mark,
 * interlinear annotation marks, musical formatting, shorthand format controls and the tag block an «ASCII smuggled»
 * order hides in. Deleted, not turned into spaces, so a word split by one reads whole again.
 */
const INVISIBLE =
  /[­͏᠋-᠏​-‍⁠-⁤⁪-⁯︀-️﻿￹-￻\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu;
/** Direction marks, embeddings, overrides and isolates: they reorder what a reader sees («‮CDSU» shows as USDC). */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/gu;
/** Blank letters (Hangul and Khmer fillers): they stand where a space would, so they become one — a word never fuses. */
const FILLERS = /[ᅟᅠ឴឵ㅤﾠ]/gu;
/** Emoji with their joiners and presentation marks: ordinary text, not hidden characters. */
const EMOJI = /\p{Extended_Pictographic}(?:[\u{fe0e}\u{fe0f}]|\u{200d}\p{Extended_Pictographic})*/gu;
/** The tag block itself: no name has a reason to carry it. */
const TAGS = /[\u{e0000}-\u{e007f}]/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const MARKUP = /<[^>]*>/g;
const TEMPLATE = /<\|[a-z_]+\|>|\[\/?INST\]|<\/?(system|assistant|tool|user)>/gi;

/**
 * Letters of other scripts that pass for Latin ones. A Latin word with one of them in it is a disguised word; a Latin
 * word with «µ» or «Δ» in it is just a unit or a sign, and a whole Cyrillic or Greek word is just a language.
 */
const LOOK_ALIKES = /[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧαιονρτυκАВЕКМНОРСТУХЅІЈҮаеорсухүѕіјԁһԛԝӏօոսհւցզլյՕՍᎪᎬᎻᎥᏆᏞᎷᏒᏚᎢᏙᎳᏴᏟᎠᏀᎩ]/u;
const isDisguisedWord = (word: string): boolean => /\p{Script=Latin}/u.test(word) && LOOK_ALIKES.test(word);

/** Words that read as orders to a model, or ask for its secrets. Judged on what a reader sees. */
const INSTRUCTION_LIKE: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(instructions?|prompts?|rules|guardrails|guidelines|messages?)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /\byou\s+(are\s+now|must\s+now|must\s+(send|transfer|pay|approve|sign|buy|sell)|will\s+now)\b/i,
  /\b(new|updated)\s+instructions?\b/i,
  /\b(act|pretend|behave)\s+as\s+(if|an?|the)\b/i,
  /\b(send|share|enter|paste|reveal|provide|give|type|submit|export|print|show)\b[^.]{0,30}\b(private\s+key|seed\s+phrase|mnemonic|secret\s+recovery\s+phrase|api\s+key|password|passphrase)\b/i,
  /\b(private\s+key|seed\s+phrase|mnemonic|secret\s+recovery\s+phrase)\b[^.]{0,30}\b(here|below|to\s+(us|verify|continue|unlock|claim))\b/i,
  /(?<![\p{L}\p{N}])(ігноруй|ігноруйте|забудь|забудьте)(?![\p{L}\p{N}])[^.]{0,40}(?<![\p{L}\p{N}])(інструкці\p{L}*|правил\p{L}*|вказівк\p{L}*)/iu,
  /(?<![\p{L}\p{N}])(игнорируй|забудь)(?![\p{L}\p{N}])[^.]{0,40}(?<![\p{L}\p{N}])(инструкци\p{L}*|правил\p{L}*)/iu,
  /(?<![\p{L}\p{N}])(сід-?фраз\p{L}*|приватн\p{L}*\s+ключ\p{L}*)/iu,
  /<\|[a-z_]+\|>|\[\/?INST\]|<\/?(system|assistant|tool)>/i,
];

const unique = (reasons: readonly TextReason[]): TextReason[] => [...new Set(reasons)];

/** `fn` over the text between emoji, the emoji themselves kept whole. */
function outsideEmoji(text: string, fn: (part: string) => string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(EMOJI)) {
    out += fn(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fn(text.slice(last));
}

/** What a reader sees: compatibility forms folded, hidden characters deleted, markup and control characters out. */
function visible(raw: string, found: TextReason[]): string {
  let text = raw.normalize("NFKC");
  const strip = (pattern: RegExp, reason: TextReason, by: string) => {
    const next = text.replace(pattern, by);
    if (next !== text) found.push(reason);
    text = next;
  };
  const hidden = outsideEmoji(text, (part) => part.replace(INVISIBLE, ""));
  if (hidden !== text) found.push("invisible");
  text = hidden;
  strip(BIDI, "bidi", "");
  strip(FILLERS, "invisible", " ");
  strip(TEMPLATE, "markup", " ");
  strip(MARKUP, "markup", " ");
  strip(CONTROL, "control", " ");
  return text.replace(/\s+/g, " ").trim();
}

/** Whether somebody else's words read as orders to a model — judged with invisible characters gone and markup kept. */
export function instructionLike(raw: string): boolean {
  const seen = visible(raw, []);
  const marked = outsideEmoji(raw.normalize("NFKC"), (part) => part.replace(INVISIBLE, "")).replace(BIDI, "").replace(FILLERS, " ");
  return INSTRUCTION_LIKE.some((pattern) => pattern.test(seen) || pattern.test(marked));
}

/** Whether somebody else's words hide something: tag characters, or a word mixing Latin with a look-alike letter. */
export function disguised(raw: string): boolean {
  return TAGS.test(raw) || visible(raw, []).split(/[\s\p{P}\p{S}]+/u).some(isDisguisedWord);
}

/** At most `max` characters a reader counts, never cutting a character in two. */
function cut(text: string, max: number, found: TextReason[]): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  found.push("cut");
  return `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}

/**
 * Somebody else's text, as the city may show or pass it on. Every kind deletes what a reader cannot see and holds back
 * a disguised word or an order to a model; a ticker is also held for a direction override, since a ticker has no
 * reason to carry one. Prose for a model keeps its words — a caller hands it on marked untrusted (`forModel`).
 */
export function cleanText(raw: unknown, kind: TextKind, max: number = TEXT_LIMITS[kind]): Cleaned {
  if (typeof raw !== "string") return { ok: false, reason: "not-text", reasons: ["not-text"] };
  const found: TextReason[] = [];
  /* A long text is read only so far: past eight times the place it stands in, nothing more is shown anyway. */
  const head = raw.length > max * 8 ? raw.slice(0, max * 8) : raw;
  const text = visible(head, found);
  if (kind === "symbol" && found.includes("bidi")) return { ok: false, reason: "bidi", reasons: unique(found) };
  if (TAGS.test(head)) return { ok: false, reason: "invisible", reasons: unique(found) };
  if (text.split(/[\s\p{P}\p{S}]+/u).some(isDisguisedWord)) {
    found.push("mixed-script");
    return { ok: false, reason: "mixed-script", reasons: unique(found) };
  }
  if (kind !== "prose" && instructionLike(head)) {
    found.push("instruction");
    return { ok: false, reason: "instruction", reasons: unique(found) };
  }
  if (!text) {
    found.push("empty");
    return { ok: false, reason: "empty", reasons: unique(found) };
  }
  return { ok: true, text: cut(text, max, found), reasons: unique(found) };
}

/** The text when it may be shown, otherwise `null`: for callers that only need the words. */
export const shownText = (raw: unknown, kind: TextKind, max?: number): string | null => {
  const cleaned = cleanText(raw, kind, max);
  return cleaned.ok ? cleaned.text : null;
};

export const cleanSymbol = (raw: unknown, max?: number): Cleaned => cleanText(raw, "symbol", max);
export const cleanName = (raw: unknown, max?: number): Cleaned => cleanText(raw, "name", max);
/** A quarter's sign (CITY-55): shown only after this and the moderation queue. */
export const cleanSign = (raw: unknown): Cleaned => cleanText(raw, "sign");
/** An island's name (CITY-54) — ready for the islands; nothing calls it until they are built. */
export const cleanIslandName = (raw: unknown): Cleaned => cleanText(raw, "island");
/** A crew's name (CITY-20, CITY-54). */
export const cleanCrewName = (raw: unknown): Cleaned => cleanText(raw, "crew");
/** A resident's display name on the world. */
export const cleanResidentName = (raw: unknown): Cleaned => cleanText(raw, "resident");
