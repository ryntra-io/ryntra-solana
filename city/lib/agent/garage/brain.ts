import type { AgentTurn } from '@/lib/api/v1/contract';
import { cleanSymbol, shownText } from '../../../../lib/world/text-safety/clean.ts';
import { detailsOf, pickTowers, shortLine } from '../../assistant/answer.ts';
import { guestBody, turnOf } from '../../assistant/ask.ts';
import type { Tower } from '../../market/types.ts';
import type { MyTower } from './mine.ts';
import type { Change } from './report.ts';

/**
 * The garage agent's advice (CITY-29): one question to Ryntra's assistant (CITY-10) through its guest seam — the same
 * intent, reads, verifier, model and day's allowance as a person's own question; the city adds no tool. The question is
 * built from your towers and what the report found, every foreign word cleaned on its way (CITY-73), and the answer
 * comes back as towers: only towers of yours, the camera flies to them and they light up.
 *
 * Advice only. The agent cannot sign, trade or hold a key: nothing here prepares, signs or sends a transaction.
 */

const ROUTE = '/api/v1/assistant/guest';
const HEADERS = { 'content-type': 'application/json', 'X-Ryntra-API': '1' } as const;
/** Towers named in one question: the lead and a few beside it. */
export const ASK_TOWERS = 4;
/** Lines behind «Details». */
const MORE = 3;

/** A tower's symbol fit for a question to the model, or null when the city's cleaning holds it back. */
export function askSymbol(symbol: string): string | null {
  const cleaned = cleanSymbol(symbol.replace(/^\$/, ''));
  return cleaned.ok && /^[\p{L}\p{N}._-]+$/u.test(cleaned.text) ? cleaned.text : null;
}

/** What the agent asks about: the tower that changed the most, else your first; and the rest beside it. */
export function subjectOf(mine: readonly MyTower[], changes: readonly Change[]): Tower | null {
  return changes[0]?.tower ?? mine[0]?.tower ?? null;
}

/** The question: your towers by symbol, each with what changed when the report found it, and what to watch. */
export function question(mine: readonly MyTower[], changes: readonly Change[]): string | null {
  const subject = subjectOf(mine, changes);
  if (!subject) return null;
  const changed = new Map(changes.map((c) => [c.tower.id, c]));
  const order = [subject, ...mine.map((m) => m.tower).filter((t) => t.id !== subject.id)];
  const named: string[] = [];
  for (const t of order) {
    const sym = askSymbol(t.symbol);
    if (!sym) continue;
    const c = changed.get(t.id);
    named.push(c ? `$${sym} (${c.value} ${c.window === '24H' ? 'today' : 'since I last looked'})` : `$${sym}`);
    if (named.length >= ASK_TOWERS) break;
  }
  if (!named.length) return null;
  return `I watch ${named.join(', ')} in the city. What should I keep an eye on with these today, and why?`;
}

export type Advice =
  | Readonly<{ ok: true; line: string; more: readonly string[]; towers: readonly Tower[]; seam: Readonly<{ used: number; allowance: number; resetsAt: string | null }> | null }>
  | Readonly<{ ok: false; busy: boolean }>;

/** The answer as the agent shows it: one short line, a few lines behind «Details», and only your towers. */
export function adviceOf(turn: AgentTurn, mine: readonly MyTower[], subject: Tower | null): Readonly<{ line: string | null; more: string[]; towers: Tower[] }> {
  const yours = mine.map((m) => m.tower);
  // The subject as the city stands it now: the report's tower may be an older read of the same coin, and the seam
  // compares towers as objects — the same coin must not come back twice.
  const asked = subject ? (yours.find((t) => t.id === subject.id) ?? null) : null;
  const seen = new Set<string>();
  const towers = pickTowers(turn, yours, 'tower', asked).filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
  const line = shownText(shortLine(turn), 'prose', 240);
  const d = detailsOf(turn);
  const more = [...d.checks, ...d.risks]
    .map((t) => shownText(t, 'prose', 240))
    .filter((t): t is string => !!t && t !== line)
    .slice(0, MORE);
  return { line, more, towers };
}

/** One question to Ryntra for the agent. Never throws: a failed or refused call reads as no advice. */
export async function askAdvice(
  mine: readonly MyTower[],
  changes: readonly Change[],
  signal?: AbortSignal,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): Promise<Advice> {
  const text = question(mine, changes);
  const subject = subjectOf(mine, changes);
  if (!text) return { ok: false, busy: false };
  try {
    const response = await fetcher(ROUTE, { method: 'POST', headers: HEADERS, credentials: 'omit', signal, body: JSON.stringify(guestBody(text, subject)) });
    if (!response.ok) return { ok: false, busy: response.status === 429 };
    const body = (await response.json()) as { guest?: { day?: { resetsAt?: unknown } } } | null;
    const read = turnOf(body);
    if (!read) return { ok: false, busy: false };
    const shown = adviceOf(read.turn, mine, subject);
    if (!shown.line) return { ok: false, busy: false };
    const resetsAt = typeof body?.guest?.day?.resetsAt === 'string' ? body.guest.day.resetsAt : null;
    return { ok: true, line: shown.line, more: shown.more, towers: shown.towers, seam: read.day ? { ...read.day, resetsAt } : null };
  } catch {
    return { ok: false, busy: false };
  }
}
