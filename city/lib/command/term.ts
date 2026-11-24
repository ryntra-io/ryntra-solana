/**
 * The term said in a sentence — «for a week», «for 3 days», «на тиждень», «протягом місяця» — read into days, with the
 * sentence that is left without it. English and Ukrainian, with the Russian a Ukrainian phone often types. Pure: no
 * imports, so the line's own readers (`../autopilot/read.ts`) and the engine's check of a model's draft
 * (`lib/sentence/plan.ts`) read a term one way.
 *
 * A term is a span of time the agent works for, never a budget's span: «1 SOL a week» is a budget a week, not a term;
 * «1 SOL a day for a week» is a day's budget for seven days. So:
 * - after «for», «during», «over», «протягом», «впродовж» it is always a term («for a week», «протягом 3 днів»);
 * - after «на», «в», «у» — which also lead a budget's span in Ukrainian («1 SOL на тиждень») — only when the rest of the
 *   sentence says the budget over a day («на 1 SOL на день на тиждень»).
 * A count of days needs its figure («for 3 days»): «на день» is a day's budget, never a term of one day. Two terms, or
 * none, is null: the card asks.
 */

export type Term = Readonly<{ days: number; rest: string }>;

/** Words that lead a term and nothing else. */
const STRONG = /^(for|during|over|throughout|протягом|впродовж|продовж|протязі|втечение|течение)$/u;
/** Words that lead a term or a budget's span alike. */
const WEAK = /^(на|в|у)$/u;
/** Words that may stand between the lead and the count: «for the next 3 days», «на наступні 2 тижні». */
const BETWEEN = /^(the|next|coming|наступн\p{L}*|найближч\p{L}*|следующ\p{L}*|ближайш\p{L}*)$/u;

const DAY = /^(day|days|день|дні|днів|дня|доби|діб|дней|суток)$/u;
const WEEK = /^(week|weeks|тиждень|тижні|тижнів|тижня|неделю|недели|недель|неделя)$/u;
const MONTH = /^(month|months|місяць|місяці|місяців|місяця|месяц|месяца|месяцев)$/u;

/** A count as a word: «a week», «one month», «два тижні». */
const COUNT_WORDS: readonly [RegExp, number][] = [
  [/^(a|an|one|один|одну|одна|одного|одне)$/u, 1],
  [/^(two|два|дві|двох)$/u, 2],
  [/^(three|три|трьох|трех)$/u, 3],
  [/^(four|чотири|чотирьох|четыре)$/u, 4],
];

/** The words that say a budget over a day, in what is left: «a day», «на день», «щодня», «/day». */
const DAILY = /(?<![\p{L}\p{N}])(daily|everyday|щодня|щоденно|ежедневно|per\s+day|a\s+day|each\s+day|every\s+day|на\s+день|в\s+день|у\s+день|за\s+день|кожен\s+день|кожного\s+дня|каждый\s+день)(?![\p{L}\p{N}])|\/\s*(day|день|д)(?![\p{L}\p{N}])/iu;

type Word = Readonly<{ text: string; start: number; end: number }>;

/** The sentence's words with where each stands, lower case, the punctuation around them gone. */
function wordsOf(sentence: string): Word[] {
  const out: Word[] = [];
  for (const match of sentence.matchAll(/\S+/gu)) {
    const raw = match[0];
    const lead = raw.length - raw.replace(/^[«»"'“”„`(),!;:.]+/u, '').length;
    const text = raw.replace(/^[«»"'“”„`(),!;:.]+|[«»"'“”„`(),!;:.?]+$/gu, '').toLowerCase();
    if (!text) continue;
    const start = match.index + lead;
    out.push({ text, start, end: start + text.length });
  }
  return out;
}

function countOf(text: string): number | null {
  if (/^\d{1,4}$/u.test(text)) return Number(text);
  for (const [pattern, value] of COUNT_WORDS) if (pattern.test(text)) return value;
  return null;
}

function unitOf(text: string): number | null {
  if (DAY.test(text)) return 1;
  if (WEEK.test(text)) return 7;
  if (MONTH.test(text)) return 30;
  return null;
}

type Found = Readonly<{ days: number; start: number; end: number; strong: boolean }>;

/** The term said in a sentence and the sentence without it; null when none is said, or two are. */
export function termSaid(sentence: string): Term | null {
  const words = wordsOf(sentence);
  const found: Found[] = [];
  /* A span said with its figure and no lead — «…, 2 weeks» — is a second term the sentence may mean. */
  let loose = false;
  for (let at = 0; at < words.length; at += 1) {
    const lead = words[at]!.text;
    const strong = STRONG.test(lead);
    if (!strong && !WEAK.test(lead)) {
      if (/^\d{1,4}$/u.test(lead) && unitOf(words[at + 1]?.text ?? '') !== null) loose = true;
      continue;
    }
    let next = at + 1;
    while (next < words.length && BETWEEN.test(words[next]!.text) && next - at <= 2) next += 1;
    const counted = countOf(words[next]?.text ?? '');
    const unitAt = counted === null ? next : next + 1;
    const unit = unitOf(words[unitAt]?.text ?? '');
    if (unit === null) continue;
    // Days only with their figure: «на день» is a day's budget; a week or a month alone is one («на тиждень»).
    if (counted === null && unit === 1) continue;
    const count = counted ?? 1;
    if (count < 1) continue;
    found.push({ days: count * unit, start: words[at]!.start, end: words[unitAt]!.end, strong });
    at = unitAt;
  }
  if (found.length !== 1 || loose) return null;
  const term = found[0]!;
  const rest = `${sentence.slice(0, term.start)} ${sentence.slice(term.end)}`.replace(/\s+/gu, ' ').replace(/\s+([,.!?;:])/gu, '$1').trim();
  // A budget's own span is never taken for a term: after «на», only when the rest says the budget over a day.
  if (!term.strong && !DAILY.test(rest)) return null;
  return { days: term.days, rest };
}
