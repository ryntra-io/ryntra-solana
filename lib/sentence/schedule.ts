/**
 * A regular purchase said in one sentence, read by rules, with no model: «buy TSLAx every week for $50»,
 * «купуй TSLAx щотижня на $50», «buy JUP every day for 0.1 SOL», «купуй акцію щотижня». The agent's line opens
 * «Recurring buys» with it (`terminal/agents/read.ts`): the rhythm, the sum and the coin as said — and never a one-off
 * buy of the same coin, which is what the plain reading of «buy X for $50» is.
 *
 * What it reads, and how (the rules of `./plan.ts` — the person's words are the only source):
 * - **A purchase, on a rhythm.** A buying verb, and how often: every day, week or month, in a word («щотижня», «weekly»),
 *   in two («every week», «кожного тижня», «раз на тиждень», «every Monday») or as a budget's span («$50 a week», «на
 *   тиждень»). «Regularly» with no rhythm is a purchase whose rhythm the card asks for. A sale, a question, a «don't
 *   buy», or two different rhythms — not this reader's, or no rhythm.
 * - **The sum: the person's own digits, with their unit.** Dollars («$50», «50$», «50 dollars», «50 доларів») or SOL
 *   («0.5 SOL», «0,5 сол»). A number with no unit is no sum — the card asks, it never guesses dollars or SOL. «1,000»
 *   is a thousand dollars (a dollar has two places) and no sum in SOL (a thousand or one?). Two different sums — none.
 * - **The coin: one of the book the person named**, by its ticker or a name the engine knows for it (`COIN_NAMES`). SOL
 *   and USDC are what the bot pays with: named as the sum's unit they are no coin, and a rhythm of buying SOL itself is
 *   not this bot's — the reader answers null and the line reads the sentence as before. Two coins — none: the card asks.
 * - **Someone else's text is data**: what stands in quotes is not read.
 *
 * Pure: no clock, no network, no model. Relative imports only: `node --test` imports this module directly.
 */

import { COIN_NAMES, SOL_MINT, USDC_MINT, sentenceOf, unquoted, type BookCoin } from "./plan.ts";

export type ScheduleCadence = "daily" | "weekly" | "monthly";

/** A sum as the person typed it: the unit, and the digits (a point for decimals, no leading zeros). */
export type ScheduleAmount = Readonly<{ unit: "usd" | "sol"; text: string }>;

export type Schedule<C extends BookCoin = BookCoin> = Readonly<{
  said: string;
  /** The coin bought — never SOL or USDC; null when none, or two, were named. */
  coin: C | null;
  /** How often; null — «regularly» without a rhythm, or two rhythms said. */
  cadence: ScheduleCadence | null;
  amount: ScheduleAmount | null;
}>;

/* ------------------------------------------------------------------------------------------------ the words */

const W = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "u");
const WG = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");

/** «Buy», as a person tells it to a bot: English, Ukrainian, and the Russian a Ukrainian phone types. */
const BUY = "buy|buying|purchase|accumulate|stack|dca|купуй|купуйте|купи|купіть|купити|купувати|докупай|докупляй|докуповуй|закуповуй|накопичуй|покупай|покупайте|покупать|купить|докупай";
/** A sale anywhere in the sentence: not a purchase. */
const SELL = W("sell|selling|продай|продайте|продавай|продати|продавати|продать|продавать");
/** «Don't buy», «не купуй», «stop buying». */
const NOT_BUY = new RegExp(`(?<![\\p{L}\\p{N}])(?:don['’]?t|do not|never|stop|не|ні|никогда|перестань|припини|хватит)\\s+(?:\\p{L}+\\s+)?(?:${BUY})(?![\\p{L}\\p{N}])`, "u");
/** A question: Ryntra answers it, no bot opens. */
const QUESTION = /^(?:should|shall|can|could|would|is|are|do|does|how|what|why|when|which|чи|як|що|чому|коли|скільки|навіщо|варто|стоит|стоїть|почему|зачем)(?![\p{L}\p{N}])/u;
/** «Regularly», without how often. */
const REGULAR = W("regularly|recurring|dca|регулярно|постійно|регулярно");

const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays";
const WEEKDAY_UK = "понеділ\\p{L}*|вівтор\\p{L}*|серед[аиуі]|середам|середах|четвер\\p{L}*|п['’ʼ]?ятниц\\p{L}*|субот\\p{L}*|неділ\\p{L}*|понедельник\\p{L}*|вторник\\p{L}*|сред[аыу]|средам|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*";

/** How often, said outright: «щотижня», «every week», «раз на тиждень», «every Monday». */
const STRONG: readonly (readonly [ScheduleCadence, RegExp])[] = [
  ["daily", W("daily|everyday|every\\s+day|each\\s+day|once\\s+a\\s+day|щодня|щоденно|щодень|кожен\\s+день|кожного\\s+дня|кожний\\s+день|раз\\s+на\\s+день|ежедневно|каждый\\s+день|раз\\s+в\\s+день")],
  [
    "weekly",
    W(
      `weekly|every\\s+week|each\\s+week|once\\s+a\\s+week|щотижня|щотижнево|кожен\\s+тиждень|кожного\\s+тижня|кожний\\s+тиждень|раз\\s+на\\s+тиждень|еженедельно|каждую\\s+неделю|раз\\s+в\\s+неделю|(?:every|each|on)\\s+(?:${WEEKDAY})|що(?:понеділ|вівтор|серед|четвер|п['’ʼ]?ятниц|субот|неділ)\\p{L}*|(?:по|кожн\\p{L}*|каждый|каждую|каждое)\\s+(?:${WEEKDAY_UK})`,
    ),
  ],
  ["monthly", W("monthly|every\\s+month|each\\s+month|once\\s+a\\s+month|щомісяця|щомісячно|кожен\\s+місяць|кожного\\s+місяця|кожний\\s+місяць|раз\\s+на\\s+місяць|ежемесячно|каждый\\s+месяц|раз\\s+в\\s+месяц")],
];

/** How often, as a budget's span: «$50 a week», «0,1 SOL на день». */
const WEAK: readonly (readonly [ScheduleCadence, RegExp])[] = [
  ["daily", W("(?:a|per)\\s+day|на\\s+день|в\\s+день|за\\s+день|на\\s+добу|в\\s+сутки")],
  ["weekly", W("(?:a|per)\\s+week|на\\s+тиждень|в\\s+неделю|на\\s+неделю")],
  ["monthly", W("(?:a|per)\\s+month|на\\s+місяць|в\\s+месяц|на\\s+месяц")],
];

/** «Every 2 weeks», «кожні 3 дні»: a rhythm the bot has no field for — no rhythm, and its figure is no sum. */
const EVERY_N = WG("(?:every|each|кожні|кожних|каждые)\\s+\\d+\\s+\\p{L}+");

const NUMBER = "\\d{1,12}(?:[.,]\\d{1,12})?";
/** Dollars: «$50», «$ 12.5», «50$», «50 dollars», «50 доларів», «50 usd». */
const USD_BEFORE = new RegExp(`\\$\\s?(${NUMBER})(?![\\p{L}\\p{N}]|[.,]\\d)`, "gu");
const USD_AFTER = new RegExp(`(?<![\\p{L}\\p{N}.,$])(${NUMBER})\\s?(?:\\$|usd|usdc|dollars?|доларів|долари|долар|дол|баксів|бакси|бакс|долларов|доллара|доллар)(?![\\p{L}\\p{N}])`, "gu");
/** SOL: «0.5 SOL», «0,5 сол», «1sol». */
const SOL_AFTER = new RegExp(`(?<![\\p{L}\\p{N}.,$])(${NUMBER})\\s?(?:sol|сол|соли|солів|солани|солана)(?![\\p{L}\\p{N}])`, "gu");

/**
 * A typed number as a sum: the ways it may be read, kept to the places the unit has (a dollar two, SOL nine) — one
 * reading left is the sum, more or none is no sum. «1,000» is a thousand dollars and nothing in SOL.
 */
function sumOf(raw: string, places: number): string | null {
  const texts = new Set<string>([raw.replace(",", "."), ...(/^\d{1,3},\d{3}$/u.test(raw) ? [raw.replace(",", "")] : [])]);
  const kept = [...texts].filter((text) => (text.split(".")[1]?.length ?? 0) <= places && Number(text) > 0);
  return kept.length === 1 ? kept[0]!.replace(/^0+(?=\d)/u, "") : null;
}

/** The one sum the sentence names with its unit, or null: none, or two different ones. */
function amountOf(text: string): ScheduleAmount | null {
  const found = new Map<string, ScheduleAmount | null>();
  const add = (unit: ScheduleAmount["unit"], raw: string) => {
    const sum = sumOf(raw, unit === "usd" ? 2 : 9);
    found.set(`${unit}:${sum ?? raw}`, sum === null ? null : { unit, text: sum });
  };
  for (const match of text.matchAll(USD_BEFORE)) add("usd", match[1]!);
  for (const match of text.matchAll(USD_AFTER)) add("usd", match[1]!);
  for (const match of text.matchAll(SOL_AFTER)) add("sol", match[1]!);
  const sums = [...found.values()];
  return sums.length === 1 ? sums[0]! : null;
}

/** How often, from the words that say it outright, else from a budget's span; two different — none. */
function cadenceOf(text: string): ScheduleCadence | null | undefined {
  for (const list of [STRONG, WEAK]) {
    const said = [...new Set(list.filter(([, re]) => re.test(text)).map(([cadence]) => cadence))];
    if (said.length === 1) return said[0]!;
    if (said.length > 1) return null;
  }
  return undefined;
}

/** Words that are the reader's own and never a coin: «for», «на», «every», «week», «dollars»… */
const OWN = W(
  `${BUY}|for|of|with|worth|me|my|please|every|each|once|a|an|the|per|on|day|days|week|weeks|month|months|daily|weekly|monthly|regularly|stock|stocks|share|shares|dollars?|usd|за|на|по|з|із|мені|мене|будь|ласка|кожен|кожного|кожний|кожну|раз|день|дня|тиждень|тижня|місяць|місяця|щодня|щотижня|щомісяця|регулярно|акцію|акції|акція|доларів|долари|долар|сол`,
);

/** The book's coins the sentence names, outside quotes, by their ticker or a name the engine knows — never the reader's own words. */
function namedCoins<C extends BookCoin>(text: string, coins: readonly C[]): C[] {
  const named: C[] = [];
  for (const match of text.matchAll(/\$?[\p{L}\p{N}]+/gu)) {
    const word = match[0].replace(/^\$/u, "");
    if (!word || /^\d+$/u.test(word) || OWN.test(word)) continue;
    const known = Object.entries(COIN_NAMES).find(([, names]) => names.some((name) => word === name || (word.startsWith(name) && word.length - name.length <= 3)))?.[0] ?? null;
    const symbol = (known ?? word).toUpperCase();
    const coin = coins.find((one) => one.symbol.replace(/^\$/u, "").toUpperCase() === symbol);
    if (coin && !named.includes(coin)) named.push(coin);
  }
  return named;
}

/**
 * A regular purchase the sentence says, or null when it says none: no buying verb, no rhythm and no «regularly», a sale,
 * a question, a «don't buy», or a rhythm of buying SOL or USDC themselves.
 */
export function readSchedule<C extends BookCoin>(input: string, coins: readonly C[]): Schedule<C> | null {
  const sentence = sentenceOf(input);
  if (sentence === null || /\?\s*$/u.test(sentence)) return null;
  const text = unquoted(sentence).toLowerCase().replace(/\s+/gu, " ").trim();
  if (!W(BUY).test(text) || SELL.test(text) || NOT_BUY.test(text) || QUESTION.test(text)) return null;
  const everyN = EVERY_N.test(text);
  const plain = text.replace(EVERY_N, " ");
  const cadence = everyN ? null : cadenceOf(plain);
  if (cadence === undefined && !everyN && !REGULAR.test(plain)) return null;

  const amount = amountOf(plain);
  const named = namedCoins(plain, coins);
  const bought = named.filter((coin) => coin.symbol.toUpperCase() !== "SOL" && coin.symbol.toUpperCase() !== "USDC" && coin.mint !== SOL_MINT && coin.mint !== USDC_MINT);
  /* SOL or USDC named as what is bought — «buy SOL every week» — is not this bot's: it pays with SOL. Named as the sum's
     unit («for 0.5 SOL»), SOL is no coin of the sentence. */
  const paid = named.length - bought.length;
  const asUnit = amount?.unit === "sol" ? 1 : 0;
  if (bought.length === 0 && paid > asUnit) return null;
  return { said: sentence, coin: bought.length === 1 ? bought[0]! : null, cadence: cadence ?? null, amount };
}

/**
 * A sum in dollars as lamports of SOL at SOL's price now, cut down to 0.0001 SOL — the dollars the person said, never
 * more; null without a price, or when the sum is less than that step.
 */
export function lamportsOfUsd(usd: string, solUsd: number | null): bigint | null {
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0 || !/^\d{1,9}(\.\d{1,2})?$/u.test(usd)) return null;
  const [whole = "0", cents = ""] = usd.split(".");
  const usdCents = BigInt(whole) * 100n + BigInt((cents + "00").slice(0, 2));
  // Micro-dollars a SOL, rounded up: a price read a hair high gives a hair less SOL, never more than the dollars said.
  const microsPerSol = BigInt(Math.ceil(solUsd * 1_000_000));
  const lamports = (usdCents * 10_000n * 1_000_000_000n) / microsPerSol;
  const step = 100_000n;
  const cut = (lamports / step) * step;
  return cut > 0n ? cut : null;
}
