import type { AgentCard, AgentSentence, AgentTurn } from '@/lib/api/v1/contract';
import type { Tower } from '../market/types.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { questionSymbol } from './clean.ts';
import { ASSISTANT_TEXT } from './words.ts';

/**
 * Ryntra in the city (CITY-10): a question goes to the assistant's engine, and the answer comes back as towers — the
 * camera flies to them and they light up — with a short line of words. Everything here is pure: which towers an answer
 * is about, the line a person reads, what waits behind «Details», and the city's own read when the engine is away.
 * Advice only: nothing here prepares, signs or sends anything.
 */

export type Intent = 'rising' | 'falling' | 'tower' | 'other';

/** How many towers one answer lights at most: more and the camera sees a district, not an answer. */
export const TOWERS_MAX = 5;

/** A mover the city names on its own read: a vetted coin with a real market under it (the trends lane's floor). */
const MOVER_LIQUIDITY = 50_000;

const RISING = /\b(ris\w*|up|gain\w*|grow\w*|pump\w*|green|trend\w*)\b|ріст|рост|зрост/iu;
const FALLING = /\b(fall\w*|drop\w*|down|los(e|er|ers|ing)|dump\w*|red|sink\w*|crash\w*)\b|пада|падін/iu;

/** What a question asks the city to show. A question about the picked tower is about that tower, whatever its words. */
export function intentOf(text: string, subject: Tower | null): Intent {
  if (subject) return 'tower';
  if (FALLING.test(text)) return 'falling';
  if (RISING.test(text)) return 'rising';
  return 'other';
}

/** A move as the city prints it everywhere: sign, one decimal and the window, in the language on screen. */
export function moveOf(change: number, window = wordsNow(ASSISTANT_TEXT).h24): string | null {
  if (!Number.isFinite(change)) return null;
  return digits(`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% · ${window}`);
}

/** A tower's light follows its own move, never the question's words: mint for a rise, red for a fall, amber when flat. */
export type Tone = 'up' | 'down' | 'flat';
export const FLAT_MOVE = 1;
export function toneOf(tower: Pick<Tower, 'change24h'>): Tone {
  if (!Number.isFinite(tower.change24h) || Math.abs(tower.change24h) < FLAT_MOVE) return 'flat';
  return tower.change24h > 0 ? 'up' : 'down';
}

/** The city's own movers: vetted towers with a real market, the biggest moves of the day in the asked direction. */
export function movers(towers: readonly Tower[], direction: 'rising' | 'falling', count = 3): Tower[] {
  const sign = direction === 'rising' ? 1 : -1;
  return towers
    .filter((t) => t.verified && t.liquidity >= MOVER_LIQUIDITY && Number.isFinite(t.change24h) && t.change24h * sign > 0)
    .sort((a, b) => (b.change24h - a.change24h) * sign)
    .slice(0, count);
}

/** The mints an answer's cards are about, in the order the cards stand. */
function cardMints(cards: readonly AgentCard[]): string[] {
  const out: string[] = [];
  for (const card of cards) if ('mint' in card && typeof card.mint === 'string') out.push(card.mint);
  return out;
}

/** The words of an answer that name coins: what it observed and what that means, and the lines of a move's explanation. */
function answerWords(turn: AgentTurn): string[] {
  const words: string[] = [];
  const said = (rows: readonly AgentSentence[] | undefined) => rows?.forEach((row) => words.push(row.text));
  said(turn.answer?.observation);
  said(turn.answer?.meaning);
  for (const card of turn.cards) if (card.kind === 'move') card.rows.forEach((row) => words.push(row.text));
  return words;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A sentence about the day's moves: «over 24 h», «за 24 год». */
const DAY_SPAN = /\b24\s?(h|hours?|год)/iu;

/**
 * The move an answer states right after a coin's name — «AMD −73.36 % (vol. …)», «AMD −73,36 %», «HIGH +2,615.17 %» —
 * in percent, or null when no move follows the name.
 */
export function statedMove(after: string): number | null {
  const m = /^\s*([+\-−])\s?([\d\s ,.]*\d)\s?%/u.exec(after);
  if (!m) return null;
  let digits = m[2]!.replace(/[\s ]/g, '');
  if (digits.includes('.')) digits = digits.replace(/,/g, '');
  else digits = /,\d{3}$/.test(digits) ? digits.replace(/,/g, '') : digits.replace(',', '.');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return m[1] === '+' ? value : -value;
}

/**
 * Whether a tower moved the way the answer says the named coin moved: the same direction and about as far. No stated
 * move keeps the tower; a tower without a figure is not that coin.
 */
export function sameMove(stated: number | null, change: number): boolean {
  if (stated === null) return true;
  if (!Number.isFinite(change)) return false;
  if (Math.sign(stated) !== Math.sign(change) && Math.abs(stated - change) > 1) return false;
  return Math.abs(stated - change) <= Math.max(5, Math.abs(stated) * 0.5);
}

/** The towers an answer names, by its cards' mints first and then by the vetted symbols its words mention, in order. */
export function towersOf(turn: AgentTurn, towers: readonly Tower[], limit = TOWERS_MAX): Tower[] {
  const byId = new Map(towers.map((t) => [t.id, t]));
  const picked: Tower[] = [];
  const add = (t: Tower | undefined) => {
    if (t && picked.length < limit && !picked.includes(t)) picked.push(t);
  };
  cardMints(turn.cards).forEach((mint) => add(byId.get(mint)));
  // By symbol only the vetted towers: an unvetted coin may take any symbol, so its name never picks it. A symbol of
  // two letters is a word as often as a coin («AI tokens»): it counts only written as a coin, with its `$`.
  const named = towers.filter((t) => t.verified && t.symbol.length >= 2);
  const words = answerWords(turn);
  const found: { at: number; tower: Tower }[] = [];
  words.forEach((text, line) => {
    const day = DAY_SPAN.test(text);
    for (const t of named) {
      const dollar = t.symbol.length < 3 ? '\\$' : '\\$?';
      const match = new RegExp(`(^|[^\\p{L}\\p{N}$])${dollar}${escape(t.symbol)}(?![\\p{L}\\p{N}])`, 'u').exec(text);
      if (!match) continue;
      // A ticker is not a coin: «AMD −73 %» in a day's movers is another AMD than the stock tower that moved −4 % (CITY-200).
      if (day && !sameMove(statedMove(text.slice(match.index + match[0].length)), t.change24h)) continue;
      found.push({ at: line * 10_000 + match.index, tower: t });
    }
  });
  found.sort((a, b) => a.at - b.at).forEach((f) => add(f.tower));
  return picked;
}

/**
 * The towers to show. Ryntra's answer shows the towers it names, else the asked tower — never towers it did not name,
 * and on a refusal only the asked tower, so a refused «buy the top gainer» never lights a pick. Without Ryntra
 * (`turn` null) the city shows its own read: the asked tower, or its movers for a rise or a fall.
 */
export function pickTowers(turn: AgentTurn | null, towers: readonly Tower[], intent: Intent, subject: Tower | null): Tower[] {
  if (turn) {
    const named = turn.refusal ? [] : towersOf(turn, towers);
    if (subject && !named.includes(subject)) return [subject, ...named].slice(0, TOWERS_MAX);
    return named;
  }
  if (subject) return [subject];
  if (intent === 'rising' || intent === 'falling') return movers(towers, intent);
  return [];
}

/**
 * A rise or a fall is the city's own read, so the city answers it from its towers when Ryntra's turn named no tower and
 * either Ryntra's day of guest answers is spent (CITY-200: «what is rising?» read «come back tomorrow» over an empty
 * city) or the turn read no market at all — no source behind it (CITY-221: «що зараз росте?» read «I have no market
 * data in this answer», and the city showed nothing).
 */
export function cityAnswers(shown: readonly Tower[], intent: Intent, day: Readonly<{ used: number; allowance: number }> | null, read = true): boolean {
  if (shown.length || (intent !== 'rising' && intent !== 'falling')) return false;
  if (!read) return true;
  return Boolean(day && day.allowance > 0 && day.used >= day.allowance);
}

/** At most this many characters of words on the panel: the towers carry the rest. */
export const LINE_MAX = 240;

/** The short line a person reads: a refusal as it was said, else the first observation and what it means — two sentences at most. */
export function shortLine(turn: AgentTurn): string {
  if (turn.refusal) return turn.refusal.reason;
  const first = turn.answer?.observation[0]?.text;
  const then = turn.answer?.meaning[0]?.text;
  const sentences = [first, then].filter((s): s is string => Boolean(s));
  if (!sentences.length) return turn.text;
  let line = sentences[0]!;
  if (sentences[1] && line.length + sentences[1].length + 1 <= LINE_MAX) line = `${line} ${sentences[1]}`;
  return line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1).trimEnd()}…`;
}

export type WhyMark = 'fact' | 'unverified' | 'inference' | 'unknown';

/** What waits behind «Details»: why it moved (each line marked), what could make the reading wrong, what to check, and the sources. */
export type Details = {
  why: { mark: WhyMark; text: string }[];
  risks: string[];
  checks: string[];
  sources: { source: string; at: string | null }[];
};

export function detailsOf(turn: AgentTurn): Details {
  const why = turn.cards.flatMap((card) => (card.kind === 'move' ? card.rows.map((row) => ({ mark: row.mark, text: row.text })) : [])).slice(0, 4);
  const risks = [...(turn.answer?.counter ?? []), ...(turn.answer?.risks ?? [])].map((s) => s.text).slice(0, 3);
  const checks = (turn.answer?.checks ?? []).map((s) => s.text).slice(0, 3);
  const seen = new Set<string>();
  const sources: Details['sources'] = [];
  for (const c of turn.citations) {
    if (seen.has(c.source)) continue;
    seen.add(c.source);
    sources.push({ source: c.source, at: c.observedAt });
  }
  return { why, risks, checks, sources: sources.slice(0, 4) };
}

/** The city's own line when Ryntra cannot answer now: what the towers on the screen are doing, from the city's read. */
export function cityLine(intent: Intent, shown: readonly Tower[]): string {
  const w = wordsNow(ASSISTANT_TEXT);
  const lead = shown[0];
  if (!lead) return intent === 'rising' ? w.nothingRising : intent === 'falling' ? w.nothingFalling : w.cannotAnswer;
  const rest = shown.slice(1).map((t) => t.symbol);
  const others = rest.length ? w.then(rest.join(', ')) : '';
  const move = moveOf(lead.change24h);
  if (!move) return w.noMove(lead.symbol);
  if (intent === 'rising') return w.leadsRise(lead.symbol, move, others);
  if (intent === 'falling') return w.fallsMost(lead.symbol, move, others);
  return w.isAt(lead.symbol, move);
}

/** The ready questions: the day's rise and fall, and the picked tower when there is one. */
export type Starter = { id: 'rising' | 'falling' | 'tower'; label: string; question: string };

/** In the language on screen: the question goes as written, and the answer comes back in that language too. */
export function startersFor(subject: Tower | null): Starter[] {
  const w = wordsNow(ASSISTANT_TEXT);
  const starters: Starter[] = [
    { id: 'rising', label: w.risingLabel, question: w.risingQuestion },
    { id: 'falling', label: w.fallingLabel, question: w.fallingQuestion },
  ];
  const symbol = subject ? questionSymbol(subject.symbol) : null;
  if (subject && symbol) starters.unshift({ id: 'tower', label: w.towerLabel(symbol), question: w.towerQuestion(symbol) });
  return starters;
}
