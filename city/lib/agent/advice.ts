import type { Tower } from '../market/types.ts';
import type { Fact } from './rule.ts';

/**
 * Ryntra's word on a find, only when the person asks for it: the assistant's market question without a wallet. It is
 * advice beside the figures, never a signal and never an order; when the assistant is not there, the card says so
 * and the find stands on its figures alone.
 */

const ROUTE = '/api/v1/assistant/guest';
const HEADERS = { 'content-type': 'application/json', 'X-Ryntra-API': '1' } as const;
/** The few lines the card has room for. */
const LINES = 3;

export type AdviceOutcome = Readonly<{ ok: true; lines: readonly string[] }> | Readonly<{ ok: false; message: string }>;

type Sentence = { text?: unknown };
type Answer = Partial<Record<'observation' | 'risks' | 'checks' | 'counter', Sentence[]>>;

export function adviceQuestion(tower: Pick<Tower, 'symbol'>, facts: readonly Fact[]): string {
  const figures = facts.map((f) => `${f.label} ${f.value}`).join(', ');
  return `My scout in the city found $${tower.symbol.replace(/^\$/, '')}: ${figures}. What should I check before I decide to buy it?`;
}

/** The answer's checks and risks first, then what it observed; plain sentences, at most a few. */
export function adviceLines(body: unknown): string[] {
  const ryn = (body as { ryn?: { answer?: Answer | null; text?: unknown } } | null)?.ryn;
  if (!ryn) return [];
  const answer = ryn.answer;
  const picked: string[] = [];
  for (const part of ['checks', 'risks', 'counter', 'observation'] as const) {
    for (const s of answer?.[part] ?? []) {
      if (typeof s?.text === 'string' && s.text.trim() && !picked.includes(s.text.trim())) picked.push(s.text.trim());
      if (picked.length >= LINES) return picked;
    }
  }
  if (!picked.length && typeof ryn.text === 'string' && ryn.text.trim()) picked.push(ryn.text.trim());
  return picked;
}

export async function askRyntra(
  tower: Pick<Tower, 'id' | 'symbol'>,
  facts: readonly Fact[],
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): Promise<AdviceOutcome> {
  try {
    const response = await fetcher(ROUTE, {
      method: 'POST',
      headers: HEADERS,
      credentials: 'omit',
      body: JSON.stringify({
        text: adviceQuestion(tower, facts),
        locale: 'en',
        context: { kind: 'asset', mint: tower.id, symbol: tower.symbol.replace(/^\$/, '').slice(0, 32) },
      }),
    });
    if (!response.ok) return { ok: false, message: response.status === 429 ? 'Ryntra has had enough questions for now. Try again shortly.' : 'Ryntra is not available here right now.' };
    const lines = adviceLines(await response.json());
    return lines.length ? { ok: true, lines } : { ok: false, message: 'Ryntra had nothing to add on this one.' };
  } catch {
    return { ok: false, message: 'Ryntra could not be reached just now.' };
  }
}
