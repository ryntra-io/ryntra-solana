/**
 * Launch moderation — a token may not borrow the name of a known brand or a
 * known person.
 *
 * A token's name and ticker are written into its mint for ever: once launched
 * they cannot be changed by anyone, Ryntra included. So the check runs before
 * anything is built, on what the creator typed, and refuses a name or ticker
 * that reads as a protected one — also when it is disguised: other letters
 * that look the same (Cyrillic «а» for Latin «a»), digits for letters
 * («T3SLA»), spaces, dots and dashes between letters («E.L.O.N»), a meme
 * prefix or suffix («ElonMuskInu», «BabyTrump») — and when it is written in
 * Cyrillic («Трамп», «Ілон Маск»).
 *
 * What it does not judge: whether a picture shows a brand or a face — no
 * automatic check here reads images — and whether a description is true. The
 * page tells the creator what is refused and why, never «your token is
 * approved».
 *
 * Pure and client-safe: the form runs it as the creator types, the server
 * runs it again before it stores or builds anything.
 */

/**
 * A protected name: how it is written, and the tickers it trades under.
 *
 * A name is matched by its length unless marked: six letters or more anywhere
 * in the field; shorter — as a whole word, the whole field, or with a meme
 * affix («ElonInu»). `=word` — only as a whole word or with an affix, for a
 * long name that is also part of ordinary words («tether» in «Tethered»).
 * `==word` — only as the whole field, for a brand that is an ordinary word
 * («Phantom», «Kraken», «Jupiter»). A ticker counts only in the ticker field,
 * and only whole: «SOL» is refused, «SOLCAT» is a ticker of its own.
 */
type Protected = Readonly<{ kind: "brand" | "person"; label: string; names: readonly string[]; tickers?: readonly string[] }>;

const PROTECTED: readonly Protected[] = [
  { kind: "brand", label: "Ryntra", names: ["ryntra", "райнтра", "рінтра", "ринтра"], tickers: ["RYNTRA", "RYN"] },
  { kind: "brand", label: "Apple", names: ["==apple", "епл", "эпл"], tickers: ["AAPL"] },
  { kind: "brand", label: "Google", names: ["google", "alphabet", "гугл"], tickers: ["GOOG", "GOOGL"] },
  { kind: "brand", label: "Microsoft", names: ["microsoft", "майкрософт"], tickers: ["MSFT"] },
  { kind: "brand", label: "Amazon", names: ["=amazon", "амазон"], tickers: ["AMZN"] },
  { kind: "brand", label: "Meta", names: ["==meta", "facebook", "instagram", "whatsapp", "фейсбук", "інстаграм"] },
  { kind: "brand", label: "Tesla", names: ["tesla", "тесла"], tickers: ["TSLA"] },
  { kind: "brand", label: "SpaceX", names: ["spacex", "спейсікс"] },
  { kind: "brand", label: "Nvidia", names: ["nvidia", "нвідіа", "нвидиа"], tickers: ["NVDA"] },
  { kind: "brand", label: "Netflix", names: ["netflix", "нетфлікс"], tickers: ["NFLX"] },
  { kind: "brand", label: "Disney", names: ["disney", "дісней", "дисней"] },
  { kind: "brand", label: "Nike", names: ["==nike", "найк"] },
  { kind: "brand", label: "Coca-Cola", names: ["cocacola", "coca cola", "кока кола"] },
  { kind: "brand", label: "McDonald's", names: ["mcdonalds", "mcdonald", "макдональдс"] },
  { kind: "brand", label: "Starbucks", names: ["starbucks", "старбакс"] },
  { kind: "brand", label: "OpenAI", names: ["openai", "chatgpt"] },
  { kind: "brand", label: "Anthropic", names: ["anthropic"] },
  { kind: "brand", label: "xAI", names: ["==xai", "=grok"], tickers: ["XAI", "GROK"] },
  { kind: "brand", label: "X", names: ["twitter", "твіттер"] },
  { kind: "brand", label: "TikTok", names: ["tiktok", "тікток", "тикток"] },
  { kind: "brand", label: "Telegram", names: ["telegram", "телеграм"] },
  { kind: "brand", label: "YouTube", names: ["youtube", "ютуб"] },
  { kind: "brand", label: "PayPal", names: ["paypal"], tickers: ["PYPL", "PYUSD"] },
  { kind: "brand", label: "Visa", names: ["==visa"] },
  { kind: "brand", label: "Mastercard", names: ["mastercard"] },
  { kind: "brand", label: "Robinhood", names: ["robinhood"], tickers: ["HOOD"] },
  { kind: "brand", label: "BlackRock", names: ["blackrock"], tickers: ["BUIDL"] },
  { kind: "brand", label: "Solana", names: ["solana", "солана"], tickers: ["SOL", "WSOL"] },
  { kind: "brand", label: "Bitcoin", names: ["bitcoin", "біткоїн", "биткоин"], tickers: ["BTC", "WBTC", "CBBTC"] },
  { kind: "brand", label: "Ethereum", names: ["ethereum", "ефіріум", "эфириум"], tickers: ["ETH", "WETH"] },
  { kind: "brand", label: "USDC", names: ["usd coin"], tickers: ["USDC"] },
  { kind: "brand", label: "Tether", names: ["=tether"], tickers: ["USDT"] },
  { kind: "brand", label: "World Liberty", names: ["world liberty"], tickers: ["WLFI", "USD1"] },
  { kind: "brand", label: "Jupiter", names: ["==jupiter"], tickers: ["JUP", "JLP"] },
  { kind: "brand", label: "Meteora", names: ["meteora"], tickers: ["MET"] },
  { kind: "brand", label: "Raydium", names: ["raydium"], tickers: ["RAY"] },
  { kind: "brand", label: "Pump.fun", names: ["pumpfun", "pump fun"], tickers: ["PUMP"] },
  { kind: "brand", label: "Phantom", names: ["==phantom"] },
  { kind: "brand", label: "Solflare", names: ["solflare"] },
  { kind: "brand", label: "Backpack", names: ["==backpack"] },
  { kind: "brand", label: "Binance", names: ["binance", "бінанс", "бинанс"], tickers: ["BNB"] },
  { kind: "brand", label: "Coinbase", names: ["coinbase"], tickers: ["COIN"] },
  { kind: "brand", label: "Kraken", names: ["==kraken"] },
  { kind: "brand", label: "Bonk", names: ["=bonk"], tickers: ["BONK"] },
  { kind: "brand", label: "dogwifhat", names: ["dogwifhat"], tickers: ["WIF"] },
  { kind: "brand", label: "Dogecoin", names: ["dogecoin"], tickers: ["DOGE"] },
  { kind: "brand", label: "Shiba Inu", names: ["shiba inu"], tickers: ["SHIB"] },
  { kind: "brand", label: "Pepe", names: [], tickers: ["PEPE"] },
  { kind: "brand", label: "Hyperliquid", names: ["hyperliquid"], tickers: ["HYPE"] },
  { kind: "person", label: "Elon Musk", names: ["elon musk", "elonmusk", "elon", "musk", "ілон маск", "илон маск", "елон маск", "маск", "ілон", "елон", "илон"] },
  { kind: "person", label: "Donald Trump", names: ["donald trump", "trump", "melania", "barron", "трамп", "меланія", "мелания"] },
  { kind: "person", label: "Joe Biden", names: ["joe biden", "biden", "байден"] },
  { kind: "person", label: "Kamala Harris", names: ["kamala harris", "kamala", "камала"] },
  { kind: "person", label: "Barack Obama", names: ["obama", "обама"] },
  { kind: "person", label: "Volodymyr Zelensky", names: ["zelensky", "zelenskyy", "zelenskiy", "зеленський", "зеленский"] },
  { kind: "person", label: "Vladimir Putin", names: ["putin", "путін", "путин"] },
  { kind: "person", label: "Javier Milei", names: ["milei", "мілей", "милей"] },
  { kind: "person", label: "Vitalik Buterin", names: ["vitalik", "buterin", "віталік", "виталик", "бутерін", "бутерин"] },
  { kind: "person", label: "Changpeng Zhao", names: ["changpeng zhao", "changpeng", "cz"] },
  { kind: "person", label: "Anatoly Yakovenko", names: ["yakovenko", "anatoly yakovenko", "яковенко"] },
  { kind: "person", label: "Michael Saylor", names: ["saylor", "сейлор"] },
  { kind: "person", label: "Satoshi Nakamoto", names: ["satoshi nakamoto", "nakamoto", "накамото"] },
  { kind: "person", label: "Mark Zuckerberg", names: ["zuckerberg", "цукерберг"] },
  { kind: "person", label: "Jeff Bezos", names: ["bezos", "безос"] },
  { kind: "person", label: "Bill Gates", names: ["bill gates", "білл гейтс"] },
  { kind: "person", label: "Sam Altman", names: ["sam altman", "altman", "альтман"] },
  { kind: "person", label: "Jensen Huang", names: ["jensen huang"] },
  { kind: "person", label: "Taylor Swift", names: ["taylor swift", "taylorswift", "тейлор свіфт"] },
  { kind: "person", label: "Kanye West", names: ["kanye", "ye west", "каньє"] },
  { kind: "person", label: "Cristiano Ronaldo", names: ["cristiano ronaldo", "=ronaldo", "роналду"] },
  { kind: "person", label: "Lionel Messi", names: ["lionel messi", "messi", "мессі", "месси"] },
  { kind: "person", label: "MrBeast", names: ["mrbeast", "mr beast"] },
  { kind: "person", label: "Pope Leo", names: ["pope leo", "pope"] },
];

/* Letters that look like Latin ones, digits and signs used as letters — all read as the Latin letter they show. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", ё: "e", є: "e", з: "3", и: "u", і: "i", ї: "i", й: "u", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ь: "b",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", $: "s", "!": "i", "|": "i", "€": "e",
};

/* Cyrillic as it sounds — one table for Ukrainian and Russian, used the same way on both sides of a comparison. */
const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ё: "io", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "iu", я: "ia", "'": "", "’": "",
};

const CYRILLIC = /[а-яіїєґё]/i;

/** Lower case, accents dropped, look-alike letters read as the Latin they show, «l» and «i» as one letter; digits and signs read as letters only when asked. */
function skeleton(text: string, digitsAsLetters: boolean): string {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let out = "";
  for (const char of plain) out += /[a-zа-яіїєґα-ω]/.test(char) || digitsAsLetters ? (LOOKALIKE[char] ?? char) : char;
  return out.replace(/l/g, "i");
}

/** Cyrillic spelled out in Latin by sound; everything else lower case as it is. */
function transliterated(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC").toLowerCase()) out += TRANSLIT[char] ?? char;
  return out;
}

type Reading = Readonly<{ letters: string; words: readonly string[] }>;

const readingOf = (form: string): Reading => ({
  letters: form.replace(/[^a-z]/g, ""),
  words: form.split(/[^a-z0-9]+/).map((word) => word.replace(/[^a-z]/g, "")).filter(Boolean),
});

/**
 * The ways a field can be read: its digits as the letters they imitate
 * («T3SLA» → «tesia»), its digits and signs dropped («$TRUMP2025» → «trump»),
 * and — when it is written in Cyrillic — by sound («Трамп» → «tramp»).
 */
function readings(text: string): Readonly<{ shapes: readonly Reading[]; sound: Reading | null }> {
  return {
    shapes: [true, false].map((digitsAsLetters) => readingOf(skeleton(text, digitsAsLetters))),
    sound: CYRILLIC.test(text) ? readingOf(transliterated(text).replace(/[^a-z0-9\s.\-_]/g, " ")) : null,
  };
}

/* What meme names put before or after a borrowed one: «BabyTrump», «ElonInu», «TeslaCoin» (in the skeleton's «l» → «i»). */
const AFFIXES = new Set(["inu", "coin", "token", "cat", "dog", "ai", "soi", "baby", "mini", "moon", "officiai", "reai", "the", "wif", "hat", "pepe", "doge", "x", "fi", "verse"]);

type Mode = "auto" | "word" | "field";

function matches(reading: Reading, target: string, mode: Mode): boolean {
  if (!target) return false;
  const { letters, words } = reading;
  if (letters === target) return true;
  if (mode === "field") return false;
  if (mode === "auto" && target.length >= 6) return letters.includes(target);
  if (words.includes(target)) return true;
  if (letters.startsWith(target) && AFFIXES.has(letters.slice(target.length))) return true;
  return letters.endsWith(target) && AFFIXES.has(letters.slice(0, letters.length - target.length));
}

/**
 * Whether a protected name shows in a field: a Cyrillic name by sound, a Latin one by the shapes of its letters.
 * `wholeWords`: a long name counts only as a whole word or with a meme affix, never inside another word — for marking
 * tokens already on the market, where a false mark misleads (Pulse, SOL-C5), unlike a refusal the creator can answer.
 */
function hits(field: string, name: string, wholeWords = false): boolean {
  const declared: Mode = name.startsWith("==") ? "field" : name.startsWith("=") ? "word" : "auto";
  const mode: Mode = wholeWords && declared === "auto" ? "word" : declared;
  const term = name.replace(/^=+/, "");
  const read = readings(field);
  if (CYRILLIC.test(term)) return read.sound !== null && matches(read.sound, transliterated(term).replace(/[^a-z]/g, ""), mode);
  const target = skeleton(term, true).replace(/[^a-z]/g, "");
  return read.shapes.some((reading) => matches(reading, target, mode));
}

/** Whether a ticker field is a protected ticker, whole. */
function isTicker(field: string, ticker: string): boolean {
  const target = skeleton(ticker, true).replace(/[^a-z]/g, "");
  return readings(field).shapes.some((reading) => reading.letters === target);
}

export type ModerationHit = Readonly<{ field: "name" | "symbol"; kind: "brand" | "person"; label: string }>;

/**
 * What a name and ticker borrow from a known brand or person; an empty list
 * means nothing is borrowed. Each hit names the field and the brand or person,
 * so the page can say exactly what to change.
 */
export function launchNameHits(input: Readonly<{ name: string; symbol: string }>, options: Readonly<{ wholeWords?: boolean }> = {}): readonly ModerationHit[] {
  const whole = options.wholeWords === true;
  const found: ModerationHit[] = [];
  const add = (field: ModerationHit["field"], entry: Protected) => {
    if (!found.some((hit) => hit.field === field && hit.label === entry.label)) found.push({ field, kind: entry.kind, label: entry.label });
  };
  for (const entry of PROTECTED) {
    if (input.name.trim() && entry.names.some((name) => hits(input.name, name, whole))) add("name", entry);
    /* A ticker already trading is matched as written — «WLF» is not «WIF» read through look-alike letters. */
    const ticker = (value: string) => (whole ? input.symbol.trim().replace(/^\$/, "").toUpperCase() === value : isTicker(input.symbol, value));
    if (input.symbol.trim() && (entry.names.some((name) => hits(input.symbol, name, whole)) || (entry.tickers ?? []).some(ticker))) add("symbol", entry);
  }
  return found;
}

/** The number of protected brands and people the check knows. */
export const PROTECTED_NAME_COUNT = PROTECTED.length;
