import { englishInside, isEnglish } from "./english";
import { MAX_ATTEMPT_CHARS, charCount } from "./size";

/**
 * What an attempt may be before a guard hears it: plain words, at most 280 characters. Text a person encoded —
 * Morse, base64, hex, binary, character codes, letters as numbers, shifted or reversed letters (ROT13, Atbash),
 * escapes, hidden characters, letters borrowed from another script — never reaches the model: in May 2026 a model
 * "read" Morse code and a bot sent its money away (docs/research/ryntra-city-games-2026-10-27/REVIEW.md, «Не робимо»).
 * Lookalike letters that only differ in form (full-width, mathematical bold) are folded to plain letters instead, so
 * the guard reads what a person reads.
 *
 * Any character that is not a letter or a digit separates the pieces the checks read, so a cipher cannot hide behind
 * `|`, `,`, `.`, `;`, a prefix like `b64:` or chunks of a few characters.
 */

export { MAX_ATTEMPT_CHARS, charCount };

export type EncodingKind =
  | "hidden"
  | "braille"
  | "mixed_script"
  | "morse"
  | "binary"
  | "hex"
  | "base64"
  | "char_codes"
  | "letter_numbers"
  | "letter_shift"
  | "scrambled"
  | "percent"
  | "entities"
  | "escapes";

export type Screened =
  /** The text the guard hears, folded and tidied. */
  | { ok: true; text: string }
  /** Nothing to send, or too long: refused before it counts. */
  | { ok: false; reason: "empty" | "too_long" }
  /** Encoded: it counts as an attempt, so the filter is no free oracle, and the guard never hears it. */
  | { ok: false; reason: "encoded"; kind: EncodingKind };

/** Emoji with their joiners and presentation marks, which are ordinary text and not hidden characters. */
const EMOJI = /\p{Extended_Pictographic}(?:[\u{FE0E}\u{FE0F}]|\u{200D}\p{Extended_Pictographic})*/gu;
/**
 * Text a reader does not see: zero-width marks, direction overrides, the soft hyphen, the grapheme joiner, Hangul and
 * Mongolian fillers and separators, Khmer inherent vowels, interlinear marks, musical formatting, the tag block and
 * variation selectors.
 */
const HIDDEN =
  /[\u{00AD}\u{034F}\u{061C}\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180B}-\u{180F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{3164}\u{FEFF}\u{FFA0}\u{FFF9}-\u{FFFB}\u{FE00}-\u{FE0F}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
const BRAILLE = /[\u{2800}-\u{28FF}]/u;
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;
/** Morse's dots and dashes in every dress: full stops, middle dots, bullets, hyphens, minus signs and every dash. */
const DOTS = ".·•∙⋅・●";
const DASHES = "\\-−–—‒―‐‑_▬";
const MORSE_TOKEN = new RegExp(`^[${DOTS}${DASHES}]{1,8}$`, "u");
const MORSE_SPLIT = new RegExp(`[^${DOTS}${DASHES}\\p{L}\\p{N}]+`, "u");
const HAS_DOT = new RegExp(`[${DOTS}]`, "u");
const HAS_DASH = new RegExp(`[${DASHES}]`, "u");

/** Folds lookalike forms, drops control characters and keeps at most one blank line. */
export function tidy(text: string): string {
  return text
    .replace(/[�-�](?![�-�])|(?<![�-�])[�-�]/g, "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The share of bytes that are printable ASCII text. */
function printable(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  let n = 0;
  for (const b of bytes) if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x09) n += 1;
  return n / bytes.length;
}

const hasLetters = (bytes: Uint8Array, min: number) => [...bytes].filter((b) => (b | 0x20) >= 0x61 && (b | 0x20) <= 0x7a).length >= min;

/** Whether hex digits spell readable text. */
function hexText(digits: string): boolean {
  if (digits.length < 12 || digits.length % 2) return false;
  const bytes = Uint8Array.from(digits.match(/../g)!.map((pair) => parseInt(pair, 16)));
  return printable(bytes) >= 0.85 && hasLetters(bytes, 4);
}

/**
 * Whether a run of base64 characters is base64 of readable text. A long ordinary word decodes to noise and passes.
 * Pieces joined back together must also decode to English words: ordinary words side by side are many tries, and a
 * try that only looks printable is not enough.
 */
function base64Text(token: string, joined = false): boolean {
  const body = token.replace(/=+$/, "");
  if (body.length < 12 || body.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+$/.test(body)) return false;
  const bytes = Uint8Array.from(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  if (bytes.length < 8 || printable(bytes) < (joined ? 0.95 : 0.9) || !hasLetters(bytes, 5)) return false;
  return !joined || (Buffer.from(bytes).toString("latin1").toLowerCase().match(/[a-z]+/g) ?? []).some(isEnglish);
}

/** Runs of neighbouring pieces that all pass a test. */
function runsOf(pieces: readonly string[], test: (piece: string) => boolean): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const piece of pieces) {
    if (test(piece)) run.push(piece);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Whether any stretch of neighbouring pieces, joined, passes a test: a cipher cut into chunks or behind a prefix. */
function anyStretch(run: readonly string[], test: (joined: string, count: number) => boolean, maxChars = 400): boolean {
  for (let i = 0; i < run.length; i += 1) {
    let joined = "";
    for (let j = i; j < run.length && joined.length <= maxChars; j += 1) {
      joined += run[j];
      if (test(joined, j - i + 1)) return true;
    }
  }
  return false;
}

/** The pieces between characters that are neither letters nor digits. */
const pieces = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function isMorse(text: string): boolean {
  const parts = text.split(MORSE_SPLIT).filter(Boolean);
  return runsOf(parts, (p) => MORSE_TOKEN.test(p)).some((run) => run.length >= 3 && run.some((p) => HAS_DOT.test(p)) && run.some((p) => HAS_DASH.test(p)));
}

function isBinary(parts: readonly string[]): boolean {
  if (parts.some((p) => /^[01]{24,}$/.test(p))) return true;
  return runsOf(parts, (p) => /^[01]{4,8}$/.test(p)).some((run) => (run.length >= 3 && run.every((p) => p.length >= 7)) || run.join("").length >= 24);
}

function isHex(text: string, parts: readonly string[]): boolean {
  if ((text.match(/(?:\\x|0x)[0-9a-f]{2}/gi) ?? []).length >= 3) return true;
  const digits = (p: string) => p.replace(/^(?:0x|x)(?=[0-9a-f])/i, "");
  const hex = (p: string) => /^(?:0x|x)?[0-9a-f]+$/i.test(p) && digits(p).length % 2 === 0;
  return runsOf(parts, hex).some((run) => anyStretch(run.map(digits), hexText));
}

/** Base64 has letters, digits, `+`, `/` and padding; anything else separates it, and its chunks are joined back. */
function isBase64(text: string): boolean {
  const chunks = text.split(/[^A-Za-z0-9+/=_-]+/).filter(Boolean);
  // Only a stretch that looks encoded is decoded: digits, `+` or capitals inside it, not just at its start.
  const looksEncoded = (joined: string) => (joined.slice(1).match(/[A-Z0-9+]/g) ?? []).length >= 3;
  return anyStretch(chunks, (joined, count) => (count === 1 ? base64Text(joined) : looksEncoded(joined) && base64Text(joined, true)));
}

/** Decimal character codes of readable text: "115, 97, 121 …". */
function isCharCodes(parts: readonly string[]): boolean {
  const code = (p: string) => /^\d{2,3}$/.test(p) && Number(p) >= 32 && Number(p) <= 126;
  return runsOf(parts, code).some((run) => run.length >= 5 && hasLetters(Uint8Array.from(run.map(Number)), 4));
}

/** Letters as their places in the alphabet, A1Z26: "19 1 25 / 20 8 5". A zero may stand between words. */
function isLetterNumbers(parts: readonly string[]): boolean {
  const place = (p: string) => /^\d{1,2}$/.test(p) && Number(p) <= 26;
  return runsOf(parts, place).some((run) => {
    const numbers = run.map(Number).filter((n) => n > 0);
    if (numbers.length < 4) return false;
    // A count (1 2 3 4, 2 4 6 8) is a count, not a word.
    const step = numbers[1]! - numbers[0]!;
    if (numbers.every((n, i) => i === 0 || n - numbers[i - 1]! === step)) return false;
    // Numbers that spell no English word are a list of numbers, not a message.
    return englishInside(numbers.map((n) => String.fromCharCode(96 + n)).join("")) > 0;
  });
}

const shift = (word: string, by: number) => word.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + by) % 26) + 97));
const atbash = (word: string) => word.replace(/[a-z]/g, (c) => String.fromCharCode(219 - c.charCodeAt(0)));
const backwards = (word: string) => [...word].reverse().join("");
const TRANSFORMS: ReadonlyArray<(word: string) => string> = [...Array.from({ length: 25 }, (_, i) => (w: string) => shift(w, i + 1)), atbash, backwards];

/** Latin words of three letters or more, accents dropped, as they were written (case kept). */
const latinWords = (text: string) =>
  (text.normalize("NFKD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => /^[A-Za-z]{3,}$/.test(w));

/**
 * Words with their letters shifted, mirrored or reversed: words that are not English and become English under one
 * and the same change. Ordinary English has few words outside the list and they do not turn into English together.
 */
function isLetterShift(words: readonly string[]): boolean {
  // Each different word once: a name said three times is one name.
  const strange = [...new Set(words.map((w) => w.toLowerCase()))].filter((w) => !isEnglish(w));
  if (strange.length < 2) return false;
  return TRANSFORMS.some((change) => {
    const gained = strange.filter((w) => isEnglish(change(w))).length;
    return (gained >= 2 && gained * 2 >= strange.length) || (gained >= 3 && gained * 10 >= strange.length * 3);
  });
}

/**
 * Text with almost no English words and almost no vowels: what a cipher leaves (Vigenère, a keyboard shift, letters
 * shuffled). Every natural language written in Latin letters has many more vowels, so other languages pass; words in
 * capitals (tickers, acronyms) and short words (lol, brb, idk) are left out.
 */
function isScrambled(words: readonly string[]): boolean {
  const lower = [...new Set(words.filter((w) => w.length >= 4 && w !== w.toUpperCase()).map((w) => w.toLowerCase()))];
  if (lower.length < 6) return false;
  const english = lower.filter(isEnglish).length;
  if (english * 10 > lower.length) return false;
  const letters = lower.join("");
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  return vowels / letters.length < 0.28;
}

/** The first encoding found in a tidied text, or null for plain words. */
export function encodingOf(text: string): EncodingKind | null {
  if (BRAILLE.test(text)) return "braille";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.some((w) => LATIN.test(w) && LOOKALIKE.test(w))) return "mixed_script";

  // Escapes first: their digits would read as hex or codes once the marks between them separate the pieces.
  if ((text.match(/%[0-9a-f]{2}/gi) ?? []).length >= 3) return "percent";
  if ((text.match(/&#x?[0-9a-f]+;/gi) ?? []).length >= 2) return "entities";
  if ((text.match(/\\u\{?[0-9a-f]{4,6}\}?|\\U[0-9a-f]{8}|\bU\+[0-9a-f]{4,6}\b/gi) ?? []).length >= 2) return "escapes";

  if (isMorse(text)) return "morse";
  const parts = pieces(text);
  if (isBinary(parts)) return "binary";
  if (isHex(text, parts)) return "hex";
  if (isBase64(text)) return "base64";
  if (isCharCodes(parts)) return "char_codes";
  if (isLetterNumbers(parts)) return "letter_numbers";

  const latin = latinWords(text);
  if (isLetterShift(latin)) return "letter_shift";
  if (isScrambled(latin)) return "scrambled";
  return null;
}

/** An attempt as the guard may hear it, or why it may not. */
export function screen(raw: string): Screened {
  if (charCount(raw) > MAX_ATTEMPT_CHARS) return { ok: false, reason: "too_long" };
  // Hidden characters are looked for in what was sent: folding would keep most of them and hide the rest.
  if (HIDDEN.test(raw.replace(EMOJI, ""))) return { ok: false, reason: "encoded", kind: "hidden" };
  const text = tidy(raw);
  if (!text) return { ok: false, reason: "empty" };
  if (charCount(text) > MAX_ATTEMPT_CHARS) return { ok: false, reason: "too_long" };
  const kind = encodingOf(text);
  return kind ? { ok: false, reason: "encoded", kind } : { ok: true, text };
}
