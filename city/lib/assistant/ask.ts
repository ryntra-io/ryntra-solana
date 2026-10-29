import type { AgentGuestResponse, AgentTurn } from '@/lib/api/v1/contract';
import type { Tower } from '../market/types.ts';
import { questionSymbol } from './clean.ts';

/**
 * One question to Ryntra from the city: the assistant's market question without a wallet (the guest seam of the
 * assistant line — its intent, tools, verifier, model and day's allowance, untouched). Nothing of anyone's own is read
 * and nothing is stored but the meter; past the day's allowance the answer is still written, from the reads alone.
 */

const ROUTE = '/api/v1/assistant/guest';
const HEADERS = { 'content-type': 'application/json', 'X-Ryntra-API': '1' } as const;
/** The contract's ceiling on a question. */
export const QUESTION_MAX = 2000;

export type Asked =
  | Readonly<{ ok: true; turn: AgentTurn; day: { used: number; allowance: number } | null }>
  | Readonly<{ ok: false; busy: boolean }>;

/** A Solana address as the contract takes it; anything else never travels as the question's context. */
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The body of a question: the person's words, and the tower asked about as its context — its symbol cleaned (CITY-73). */
export function guestBody(text: string, subject: Pick<Tower, 'id' | 'symbol'> | null) {
  const symbol = subject ? questionSymbol(subject.symbol) : null;
  const context = subject && MINT.test(subject.id) ? { kind: 'asset' as const, mint: subject.id, ...(symbol ? { symbol: symbol.slice(0, 32) } : {}) } : null;
  return { text: text.trim().slice(0, QUESTION_MAX), locale: 'en' as const, context };
}

/** Ryntra's turn out of a response, when the response is one: anything else reads as no answer. */
export function turnOf(body: unknown): { turn: AgentTurn; day: { used: number; allowance: number } | null } | null {
  const b = body as Partial<AgentGuestResponse> | null;
  const turn = b?.ryn;
  if (!turn || typeof turn !== 'object' || typeof turn.text !== 'string' || !Array.isArray(turn.cards) || !Array.isArray(turn.citations)) return null;
  const day = b?.guest?.day;
  return { turn, day: day && Number.isFinite(day.used) && Number.isFinite(day.allowance) ? { used: day.used, allowance: day.allowance } : null };
}

export async function askGuest(
  text: string,
  subject: Pick<Tower, 'id' | 'symbol'> | null,
  signal?: AbortSignal,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): Promise<Asked> {
  try {
    const response = await fetcher(ROUTE, { method: 'POST', headers: HEADERS, credentials: 'omit', signal, body: JSON.stringify(guestBody(text, subject)) });
    if (!response.ok) return { ok: false, busy: response.status === 429 };
    const read = turnOf(await response.json());
    return read ? { ok: true, ...read } : { ok: false, busy: false };
  } catch {
    return { ok: false, busy: false };
  }
}
